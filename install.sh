#!/usr/bin/env bash
set -Eeuo pipefail

readonly PROXMOXCENTER_INSTALL_DIR="${PROXMOXCENTER_INSTALL_DIR:-/opt/proxmoxcenter}"
readonly PROXMOXCENTER_DATA_DIR="${PROXMOXCENTER_DATA_DIR:-${PROXMOXCENTER_INSTALL_DIR}/data}"
readonly PROXMOXCENTER_COMPOSE_FILE="${PROXMOXCENTER_INSTALL_DIR}/docker-compose.yml"
readonly PROXMOXCENTER_PORT="${PROXMOXCENTER_PORT:-3000}"
readonly PROXMOXCENTER_PUBLIC_ORIGIN="${PROXMOXCENTER_PUBLIC_ORIGIN:-}"
readonly PROXMOXCENTER_CLOUD_OAUTH_MODE="${PROXMOXCENTER_CLOUD_OAUTH_MODE:-local}"
readonly PROXMOXCENTER_CLOUD_OAUTH_BROKER_ORIGIN="${PROXMOXCENTER_CLOUD_OAUTH_BROKER_ORIGIN:-}"
readonly PROXMOXCENTER_IMAGE="${PROXMOXCENTER_IMAGE:-ghcr.io/valentinblchd/proxmoxcenter:latest}"

log() {
  printf '\033[1;34m[proxmoxcenter]\033[0m %s\n' "$*"
}

warn() {
  printf '\033[1;33m[proxmoxcenter]\033[0m %s\n' "$*" >&2
}

fail() {
  printf '\033[1;31m[proxmoxcenter]\033[0m %s\n' "$*" >&2
  exit 1
}

require_root() {
  if [[ "${EUID}" -ne 0 ]]; then
    fail "Exécute ce script en root via sudo."
  fi
}

check_platform() {
  [[ "$(uname -s)" == "Linux" ]] || fail "Installation supportée uniquement sur Linux."

  local arch
  arch="$(uname -m)"
  case "${arch}" in
    x86_64|amd64) ;;
    *)
      fail "Architecture non supportée: ${arch}. Cible attendue: Linux x86_64."
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
    printf '%s' "${VERSION_CODENAME:-bookworm}"
  )"
  repo_file="/etc/apt/sources.list.d/docker.list"

  cat >"${repo_file}" <<EOF
deb [arch=amd64 signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian ${codename} stable
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

write_compose_file() {
  cat >"${PROXMOXCENTER_COMPOSE_FILE}" <<EOF
name: proxmoxcenter
services:
  proxmoxcenter:
    image: ${PROXMOXCENTER_IMAGE}
    container_name: proxmoxcenter
    ports:
      - "${PROXMOXCENTER_PORT}:3000"
    environment:
      PROXMOXCENTER_PUBLIC_ORIGIN: "${PROXMOXCENTER_PUBLIC_ORIGIN}"
      PROXMOXCENTER_CLOUD_OAUTH_MODE: "${PROXMOXCENTER_CLOUD_OAUTH_MODE}"
      PROXMOXCENTER_CLOUD_OAUTH_BROKER_ORIGIN: "${PROXMOXCENTER_CLOUD_OAUTH_BROKER_ORIGIN}"
    volumes:
      - "${PROXMOXCENTER_DATA_DIR}:/app/data"
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-fsS", "http://127.0.0.1:3000/api/health"]
      interval: 30s
      timeout: 5s
      retries: 5
      start_period: 20s
EOF
}

write_helper_scripts() {
  cat >/usr/local/bin/proxmoxcenter-update <<EOF
#!/usr/bin/env bash
set -Eeuo pipefail
export PROXMOXCENTER_INSTALL_DIR="${PROXMOXCENTER_INSTALL_DIR}"
export PROXMOXCENTER_DATA_DIR="${PROXMOXCENTER_DATA_DIR}"
export PROXMOXCENTER_PORT="${PROXMOXCENTER_PORT}"
export PROXMOXCENTER_PUBLIC_ORIGIN="${PROXMOXCENTER_PUBLIC_ORIGIN}"
export PROXMOXCENTER_CLOUD_OAUTH_MODE="${PROXMOXCENTER_CLOUD_OAUTH_MODE}"
export PROXMOXCENTER_CLOUD_OAUTH_BROKER_ORIGIN="${PROXMOXCENTER_CLOUD_OAUTH_BROKER_ORIGIN}"
export PROXMOXCENTER_IMAGE="${PROXMOXCENTER_IMAGE}"
curl -fsSL https://raw.githubusercontent.com/Valentinblchd/proxmoxcenter/main/install.sh | bash
EOF
  chmod +x /usr/local/bin/proxmoxcenter-update

  cat >/usr/local/bin/proxmoxcenter-logs <<EOF
#!/usr/bin/env bash
set -Eeuo pipefail
docker compose -f "${PROXMOXCENTER_COMPOSE_FILE}" logs -f --tail=200
EOF
  chmod +x /usr/local/bin/proxmoxcenter-logs

  cat >/usr/local/bin/proxmoxcenter-status <<EOF
#!/usr/bin/env bash
set -Eeuo pipefail
docker compose -f "${PROXMOXCENTER_COMPOSE_FILE}" ps
curl -fsS "http://127.0.0.1:${PROXMOXCENTER_PORT}/api/health" || true
EOF
  chmod +x /usr/local/bin/proxmoxcenter-status
}

install_stack() {
  mkdir -p "${PROXMOXCENTER_INSTALL_DIR}" "${PROXMOXCENTER_DATA_DIR}"
  write_compose_file
  write_helper_scripts
  log "Téléchargement de l'image ProxmoxCenter."
  if ! docker pull "${PROXMOXCENTER_IMAGE}"; then
    fail "Impossible de télécharger ${PROXMOXCENTER_IMAGE}. Rends le package GHCR public ou connecte Docker à GHCR avant de relancer l'installation."
  fi
  log "Démarrage de ProxmoxCenter."
  docker compose -f "${PROXMOXCENTER_COMPOSE_FILE}" up -d
}

wait_for_health() {
  local attempt=0
  local health_url="http://127.0.0.1:${PROXMOXCENTER_PORT}/api/health"

  until curl -fsS "${health_url}" >/dev/null 2>&1; do
    attempt=$((attempt + 1))
    if (( attempt >= 60 )); then
      warn "Le conteneur est démarré mais le healthcheck HTTP n'a pas encore répondu."
      return
    fi
    sleep 2
  done

  log "Healthcheck OK: ${health_url}"
}

print_summary() {
  cat <<EOF

Installation terminée. Amusez-vous bien.

- Répertoire: ${PROXMOXCENTER_INSTALL_DIR}
- Données persistées: ${PROXMOXCENTER_DATA_DIR}
- Compose: ${PROXMOXCENTER_COMPOSE_FILE}
- URL locale: http://$(hostname -I 2>/dev/null | awk '{print $1}' || printf 'IP_DU_SERVEUR'):${PROXMOXCENTER_PORT}
- Origine canonique: ${PROXMOXCENTER_PUBLIC_ORIGIN:-non définie}

Commandes utiles:
- proxmoxcenter-status
- proxmoxcenter-logs
- proxmoxcenter-update

Étapes suivantes:
1. Ouvre l'interface web.
2. Crée le premier compte local.
3. Configure ensuite la connexion Proxmox et, si besoin, PBS/cloud depuis l'UI.
4. Si ton URL finale n'est pas localhost, définis PROXMOXCENTER_PUBLIC_ORIGIN=http://ip:port ou https://dns.
EOF
}

main() {
  require_root
  log "Merci d'utiliser ProxmoxCenter."
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
