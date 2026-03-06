export const BOOTSTRAP_SCRIPT_TEMPLATE = `#!/usr/bin/env bash
set -Eeuo pipefail

readonly PROXMOXCENTER_INSTALL_DIR="\${PROXMOXCENTER_INSTALL_DIR:-/opt/proxmoxcenter}"
readonly PROXMOXCENTER_DATA_DIR="\${PROXMOXCENTER_DATA_DIR:-\${PROXMOXCENTER_INSTALL_DIR}/data}"
readonly PROXMOXCENTER_COMPOSE_FILE="\${PROXMOXCENTER_INSTALL_DIR}/docker-compose.yml"
readonly PROXMOXCENTER_IMAGE="\${PROXMOXCENTER_IMAGE:-ghcr.io/valentinblchd/proxmoxcenter:latest}"
readonly PROXMOXCENTER_PORT="\${PROXMOXCENTER_PORT:-3000}"
readonly PROXMOXCENTER_INSTALL_BASE_URL="\${PROXMOXCENTER_INSTALL_BASE_URL:-__PROXMOXCENTER_INSTALL_BASE_URL__}"
readonly PROXMOXCENTER_PUBLIC_ORIGIN="\${PROXMOXCENTER_PUBLIC_ORIGIN:-}"
readonly PROXMOXCENTER_CLOUD_OAUTH_MODE="\${PROXMOXCENTER_CLOUD_OAUTH_MODE:-local}"
readonly PROXMOXCENTER_CLOUD_OAUTH_BROKER_ORIGIN="\${PROXMOXCENTER_CLOUD_OAUTH_BROKER_ORIGIN:-}"
readonly PROXMOXCENTER_SELF_UPDATE_ENABLED="\${PROXMOXCENTER_SELF_UPDATE_ENABLED:-1}"
readonly PROXMOXCENTER_SELF_UPDATE_BRANCH="\${PROXMOXCENTER_SELF_UPDATE_BRANCH:-main}"
readonly PROXMOXCENTER_SELF_UPDATE_SERVICE="\${PROXMOXCENTER_SELF_UPDATE_SERVICE:-proxmoxcenter}"
readonly PROXMOXCENTER_SELF_UPDATE_RUNNER_IMAGE="\${PROXMOXCENTER_SELF_UPDATE_RUNNER_IMAGE:-docker:27-cli}"

log() {
  printf '\\033[1;34m[proxmoxcenter]\\033[0m %s\\n' "$*"
}

warn() {
  printf '\\033[1;33m[proxmoxcenter]\\033[0m %s\\n' "$*" >&2
}

fail() {
  printf '\\033[1;31m[proxmoxcenter]\\033[0m %s\\n' "$*" >&2
  exit 1
}

require_root() {
  if [[ "\${EUID}" -ne 0 ]]; then
    fail "Exécute ce script en root via sudo."
  fi
}

check_platform() {
  [[ "$(uname -s)" == "Linux" ]] || fail "Installation supportée uniquement sur Linux."

  local arch
  arch="$(uname -m)"
  case "\${arch}" in
    x86_64|amd64) ;;
    *)
      fail "Architecture non supportée: \${arch}. Cible attendue: Linux x86_64."
      ;;
  esac
}

detect_container_runtime() {
  if command -v systemd-detect-virt >/dev/null 2>&1; then
    if systemd-detect-virt --container >/dev/null 2>&1; then
      warn "Conteneur détecté. Pour Docker dans un LXC Proxmox, active nesting=1 et keyctl=1."
    fi
  fi
}

require_apt() {
  command -v apt-get >/dev/null 2>&1 \
    || fail "Installer prévu pour Debian/Ubuntu/Proxmox avec apt-get."
}

apt_install() {
  DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends "$@"
}

install_docker_repo() {
  if [[ ! -f /etc/apt/keyrings/docker.asc ]]; then
    mkdir -p /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
    chmod a+r /etc/apt/keyrings/docker.asc
  fi

  local codename repo_file
  codename="$(
    . /etc/os-release
    printf '%s' "\${VERSION_CODENAME:-bookworm}"
  )"
  repo_file="/etc/apt/sources.list.d/docker.list"

  cat >"\${repo_file}" <<EOF
deb [arch=amd64 signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian \${codename} stable
EOF
}

ensure_docker() {
  if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    return
  fi

  log "Installation de Docker Engine et du plugin compose."
  apt-get update
  apt_install ca-certificates curl gnupg lsb-release
  install_docker_repo
  apt-get update
  apt_install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  systemctl enable --now docker
}

wait_for_docker() {
  local attempt=0
  until docker info >/dev/null 2>&1; do
    attempt=$((attempt + 1))
    if (( attempt >= 20 )); then
      fail "Docker ne répond pas après installation."
    fi
    sleep 2
  done
}

render_compose_template() {
  local template_path="\${PROXMOXCENTER_INSTALL_DIR}/docker-compose.template.yml"
  if curl -fsSL "\${PROXMOXCENTER_INSTALL_BASE_URL}/docker-compose.yml" -o "\${template_path}"; then
    :
  else
    warn "Impossible de télécharger le template distant. Utilisation du template embarqué."
    cat >"\${template_path}" <<'EOF'
name: proxmoxcenter
services:
  proxmoxcenter:
    image: __PROXMOXCENTER_IMAGE__
    container_name: proxmoxcenter
    ports:
      - "__PROXMOXCENTER_PORT__:3000"
    environment:
      PROXMOXCENTER_PUBLIC_ORIGIN: "__PROXMOXCENTER_PUBLIC_ORIGIN__"
      PROXMOXCENTER_CLOUD_OAUTH_MODE: "__PROXMOXCENTER_CLOUD_OAUTH_MODE__"
      PROXMOXCENTER_CLOUD_OAUTH_BROKER_ORIGIN: "__PROXMOXCENTER_CLOUD_OAUTH_BROKER_ORIGIN__"
      PROXMOXCENTER_SELF_UPDATE_ENABLED: "__PROXMOXCENTER_SELF_UPDATE_ENABLED__"
      PROXMOXCENTER_SELF_UPDATE_INSTALL_DIR: "__PROXMOXCENTER_INSTALL_DIR__"
      PROXMOXCENTER_SELF_UPDATE_DATA_DIR: "__PROXMOXCENTER_DATA_DIR__"
      PROXMOXCENTER_SELF_UPDATE_BRANCH: "__PROXMOXCENTER_SELF_UPDATE_BRANCH__"
      PROXMOXCENTER_SELF_UPDATE_SERVICE: "__PROXMOXCENTER_SELF_UPDATE_SERVICE__"
      PROXMOXCENTER_SELF_UPDATE_RUNNER_IMAGE: "__PROXMOXCENTER_SELF_UPDATE_RUNNER_IMAGE__"
    volumes:
      - "__PROXMOXCENTER_DATA_DIR__:/app/data"
      - "/var/run/docker.sock:/var/run/docker.sock"
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-fsS", "http://127.0.0.1:3000/api/health"]
      interval: 30s
      timeout: 5s
      retries: 5
      start_period: 20s
EOF
  fi

  sed \
    -e "s|__PROXMOXCENTER_IMAGE__|\${PROXMOXCENTER_IMAGE}|g" \
    -e "s|__PROXMOXCENTER_PORT__|\${PROXMOXCENTER_PORT}|g" \
    -e "s|__PROXMOXCENTER_DATA_DIR__|\${PROXMOXCENTER_DATA_DIR}|g" \
    -e "s|__PROXMOXCENTER_INSTALL_DIR__|\${PROXMOXCENTER_INSTALL_DIR}|g" \
    -e "s|__PROXMOXCENTER_PUBLIC_ORIGIN__|\${PROXMOXCENTER_PUBLIC_ORIGIN}|g" \
    -e "s|__PROXMOXCENTER_CLOUD_OAUTH_MODE__|\${PROXMOXCENTER_CLOUD_OAUTH_MODE}|g" \
    -e "s|__PROXMOXCENTER_CLOUD_OAUTH_BROKER_ORIGIN__|\${PROXMOXCENTER_CLOUD_OAUTH_BROKER_ORIGIN}|g" \
    -e "s|__PROXMOXCENTER_SELF_UPDATE_ENABLED__|\${PROXMOXCENTER_SELF_UPDATE_ENABLED}|g" \
    -e "s|__PROXMOXCENTER_SELF_UPDATE_BRANCH__|\${PROXMOXCENTER_SELF_UPDATE_BRANCH}|g" \
    -e "s|__PROXMOXCENTER_SELF_UPDATE_SERVICE__|\${PROXMOXCENTER_SELF_UPDATE_SERVICE}|g" \
    -e "s|__PROXMOXCENTER_SELF_UPDATE_RUNNER_IMAGE__|\${PROXMOXCENTER_SELF_UPDATE_RUNNER_IMAGE}|g" \
    "\${template_path}" > "\${PROXMOXCENTER_COMPOSE_FILE}"
  rm -f "\${template_path}"
}

write_helper_scripts() {
  cat >/usr/local/bin/proxmoxcenter-update <<EOF
#!/usr/bin/env bash
set -Eeuo pipefail
docker compose -f "\${PROXMOXCENTER_COMPOSE_FILE}" pull
docker compose -f "\${PROXMOXCENTER_COMPOSE_FILE}" up -d
EOF
  chmod +x /usr/local/bin/proxmoxcenter-update

  cat >/usr/local/bin/proxmoxcenter-logs <<EOF
#!/usr/bin/env bash
set -Eeuo pipefail
docker compose -f "\${PROXMOXCENTER_COMPOSE_FILE}" logs -f --tail=200
EOF
  chmod +x /usr/local/bin/proxmoxcenter-logs

  cat >/usr/local/bin/proxmoxcenter-status <<EOF
#!/usr/bin/env bash
set -Eeuo pipefail
docker compose -f "\${PROXMOXCENTER_COMPOSE_FILE}" ps
curl -fsS "http://127.0.0.1:\${PROXMOXCENTER_PORT}/api/health" || true
EOF
  chmod +x /usr/local/bin/proxmoxcenter-status
}

install_stack() {
  mkdir -p "\${PROXMOXCENTER_INSTALL_DIR}" "\${PROXMOXCENTER_DATA_DIR}"
  render_compose_template
  write_helper_scripts
  log "Démarrage de ProxmoxCenter."
  docker compose -f "\${PROXMOXCENTER_COMPOSE_FILE}" pull
  docker compose -f "\${PROXMOXCENTER_COMPOSE_FILE}" up -d
}

wait_for_health() {
  local attempt=0
  local health_url="http://127.0.0.1:\${PROXMOXCENTER_PORT}/api/health"

  until curl -fsS "\${health_url}" >/dev/null 2>&1; do
    attempt=$((attempt + 1))
    if (( attempt >= 45 )); then
      warn "Le conteneur est démarré mais le healthcheck HTTP n'a pas encore répondu."
      return
    fi
    sleep 2
  done

  log "Healthcheck OK: \${health_url}"
}

print_summary() {
  cat <<EOF

Installation terminée.

- Répertoire: \${PROXMOXCENTER_INSTALL_DIR}
- Données persistées: \${PROXMOXCENTER_DATA_DIR}
- Compose: \${PROXMOXCENTER_COMPOSE_FILE}
- URL locale: http://$(hostname -I 2>/dev/null | awk '{print $1}' || printf 'IP_DU_SERVEUR'):\${PROXMOXCENTER_PORT}
- Origine canonique: \${PROXMOXCENTER_PUBLIC_ORIGIN:-non définie}
- OAuth cloud: \${PROXMOXCENTER_CLOUD_OAUTH_MODE}
- Broker OAuth cloud: \${PROXMOXCENTER_CLOUD_OAUTH_BROKER_ORIGIN:-non défini}

Commandes utiles:
- proxmoxcenter-status
- proxmoxcenter-logs
- proxmoxcenter-update

Étapes suivantes:
1. Ouvre l'interface web.
2. Crée le premier compte local.
3. Configure ensuite la connexion Proxmox et, si besoin, PBS/cloud depuis l'UI.
4. En reverse proxy, définis PROXMOXCENTER_PUBLIC_ORIGIN=https://dns:port.
5. Pour OneDrive/Google Drive en mode central, définis PROXMOXCENTER_CLOUD_OAUTH_BROKER_ORIGIN=https://ton-service-proxmoxcenter.
EOF
}

main() {
  require_root
  check_platform
  detect_container_runtime
  require_apt
  ensure_docker
  wait_for_docker
  install_stack
  wait_for_health
  print_summary
}

main "$@"
`;
