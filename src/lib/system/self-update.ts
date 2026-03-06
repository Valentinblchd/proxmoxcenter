import "server-only";

import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";

type SelfUpdateStatus = "idle" | "running" | "success" | "failed";
type UpdateAvailabilityStatus = "disabled" | "unknown" | "up-to-date" | "update-available" | "error";

export type SelfUpdateJob = {
  id: string;
  status: SelfUpdateStatus;
  requestedBy: string | null;
  startedAt: string;
  finishedAt: string | null;
  containerName: string | null;
  branch: string;
  service: string;
  logFile: string;
  resultFile: string;
  message: string | null;
  error: string | null;
};

type SelfUpdateState = {
  current: SelfUpdateJob | null;
  history: SelfUpdateJob[];
  updatedAt: string;
};

type SelfUpdateAvailability = {
  status: UpdateAvailabilityStatus;
  message: string;
  checkedAt: string | null;
  currentRef: string | null;
  availableRef: string | null;
  serviceImage: string | null;
};

type SelfComposeMetadata = {
  workingDir: string | null;
  configFile: string | null;
  service: string | null;
};

type SelfUpdateConfig = {
  enabled: boolean;
  hostInstallDir: string;
  hostDataDir: string;
  composeFile: string;
  branch: string;
  service: string;
  runnerImage: string;
  maxHistory: number;
};

const DEFAULT_STATE: SelfUpdateState = {
  current: null,
  history: [],
  updatedAt: new Date(0).toISOString(),
};

const DEFAULT_AVAILABILITY: SelfUpdateAvailability = {
  status: "unknown",
  message: "Aucune vérification distante lancée.",
  checkedAt: null,
  currentRef: null,
  availableRef: null,
  serviceImage: null,
};

const AVAILABILITY_TTL_MS = 15 * 60_000;

function timestamp() {
  return new Date().toISOString();
}

function asBooleanEnv(value: string | undefined, fallback = false) {
  if (!value) return fallback;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function asSafeName(value: string | undefined, fallback: string) {
  const text = (value ?? "").trim();
  if (!text) return fallback;
  const sanitized = text.replace(/[^a-zA-Z0-9._-]+/g, "").slice(0, 64);
  return sanitized || fallback;
}

function asSafeImage(value: string | undefined, fallback: string) {
  const text = (value ?? "").trim();
  if (!text) return fallback;
  if (!/^[a-zA-Z0-9./:_-]+$/.test(text)) return fallback;
  return text;
}

function asAbsolutePath(value: string | null | undefined) {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed || !path.isAbsolute(trimmed)) return null;
  return trimmed;
}

function getStateDir() {
  return path.join(process.cwd(), "data", "self-update");
}

function ensureStateDir() {
  const dir = getStateDir();
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

function getStatePath() {
  return path.join(getStateDir(), "state.json");
}

function getAvailabilityPath() {
  return path.join(getStateDir(), "availability.json");
}

function readState(): SelfUpdateState {
  const filePath = getStatePath();
  if (!fs.existsSync(filePath)) return { ...DEFAULT_STATE, history: [] };
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    if (!raw.trim()) return { ...DEFAULT_STATE, history: [] };
    const parsed = JSON.parse(raw) as Partial<SelfUpdateState>;
    return {
      current: parsed.current ?? null,
      history: Array.isArray(parsed.history) ? parsed.history : [],
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date(0).toISOString(),
    };
  } catch {
    return { ...DEFAULT_STATE, history: [] };
  }
}

function writeState(state: SelfUpdateState) {
  ensureStateDir();
  state.updatedAt = timestamp();
  fs.writeFileSync(getStatePath(), `${JSON.stringify(state, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
}

function readAvailability(): SelfUpdateAvailability {
  const filePath = getAvailabilityPath();
  if (!fs.existsSync(filePath)) return { ...DEFAULT_AVAILABILITY };

  try {
    const raw = fs.readFileSync(filePath, "utf8");
    if (!raw.trim()) return { ...DEFAULT_AVAILABILITY };
    const parsed = JSON.parse(raw) as Partial<SelfUpdateAvailability>;
    return {
      status:
        parsed.status === "disabled" ||
        parsed.status === "unknown" ||
        parsed.status === "up-to-date" ||
        parsed.status === "update-available" ||
        parsed.status === "error"
          ? parsed.status
          : "unknown",
      message: typeof parsed.message === "string" ? parsed.message : DEFAULT_AVAILABILITY.message,
      checkedAt: typeof parsed.checkedAt === "string" ? parsed.checkedAt : null,
      currentRef: typeof parsed.currentRef === "string" ? parsed.currentRef : null,
      availableRef: typeof parsed.availableRef === "string" ? parsed.availableRef : null,
      serviceImage: typeof parsed.serviceImage === "string" ? parsed.serviceImage : null,
    };
  } catch {
    return { ...DEFAULT_AVAILABILITY };
  }
}

function writeAvailability(availability: SelfUpdateAvailability) {
  ensureStateDir();
  fs.writeFileSync(getAvailabilityPath(), `${JSON.stringify(availability, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
}

function readSelfComposeMetadata(): SelfComposeMetadata {
  const containerId =
    fs.existsSync("/etc/hostname") ? fs.readFileSync("/etc/hostname", "utf8").trim() : "";
  if (!containerId) {
    return {
      workingDir: null,
      configFile: null,
      service: null,
    };
  }

  const inspect = readCommandText("docker", ["inspect", containerId, "--format", "{{json .Config.Labels}}"], 8_000);
  if (!inspect.ok || !inspect.stdout) {
    return {
      workingDir: null,
      configFile: null,
      service: null,
    };
  }

  try {
    const labels = JSON.parse(inspect.stdout) as Record<string, unknown>;
    const configFilesRaw =
      typeof labels["com.docker.compose.project.config_files"] === "string"
        ? labels["com.docker.compose.project.config_files"]
        : "";
    const configFile = configFilesRaw.split(",").map((entry) => entry.trim()).find(Boolean) ?? null;
    return {
      workingDir: asAbsolutePath(
        typeof labels["com.docker.compose.project.working_dir"] === "string"
          ? labels["com.docker.compose.project.working_dir"]
          : null,
      ),
      configFile: asAbsolutePath(configFile),
      service:
        typeof labels["com.docker.compose.service"] === "string"
          ? labels["com.docker.compose.service"].trim() || null
          : null,
    };
  } catch {
    return {
      workingDir: null,
      configFile: null,
      service: null,
    };
  }
}

function mutateState<T>(mutator: (state: SelfUpdateState) => T) {
  const state = readState();
  const out = mutator(state);
  writeState(state);
  return out;
}

function shQuote(value: string) {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function resolveConfig(): SelfUpdateConfig {
  const composeMetadata = readSelfComposeMetadata();
  const enabled = asBooleanEnv(process.env.PROXMOXCENTER_SELF_UPDATE_ENABLED, false);
  const configuredInstallDir = asAbsolutePath(process.env.PROXMOXCENTER_SELF_UPDATE_INSTALL_DIR);
  const hostInstallDir =
    composeMetadata.workingDir ||
    configuredInstallDir ||
    "/opt/proxmoxcenter";
  const configuredDataDir = asAbsolutePath(process.env.PROXMOXCENTER_SELF_UPDATE_DATA_DIR);
  const hostDataDir =
    configuredDataDir ||
    (composeMetadata.workingDir ? path.join(composeMetadata.workingDir, "data") : null) ||
    path.join(hostInstallDir, "data");

  return {
    enabled,
    hostInstallDir,
    hostDataDir,
    composeFile: composeMetadata.configFile || path.join(hostInstallDir, "docker-compose.yml"),
    branch: asSafeName(process.env.PROXMOXCENTER_SELF_UPDATE_BRANCH, "main"),
    service: composeMetadata.service || asSafeName(process.env.PROXMOXCENTER_SELF_UPDATE_SERVICE, "proxmoxcenter"),
    runnerImage: asSafeImage(process.env.PROXMOXCENTER_SELF_UPDATE_RUNNER_IMAGE, "docker:27-cli"),
    maxHistory: 24,
  };
}

function checkPrerequisites() {
  const dockerSocketAvailable = fs.existsSync("/var/run/docker.sock");
  const dockerBinary = spawnSync("docker", ["--version"], { encoding: "utf8" });
  const dockerCliAvailable = dockerBinary.status === 0;

  return {
    dockerSocketAvailable,
    dockerCliAvailable,
  };
}

function readResultFile(resultPath: string): Record<string, string> | null {
  if (!fs.existsSync(resultPath)) return null;
  try {
    const raw = fs.readFileSync(resultPath, "utf8");
    const lines = raw.split(/\r?\n/u);
    const output: Record<string, string> = {};
    for (const line of lines) {
      const idx = line.indexOf("=");
      if (idx <= 0) continue;
      const key = line.slice(0, idx).trim();
      const value = line.slice(idx + 1).trim();
      if (!key) continue;
      output[key] = value;
    }
    return output;
  } catch {
    return null;
  }
}

function resolveLogPath(logFile: string) {
  return path.join(getStateDir(), logFile);
}

function tailLogLines(logFile: string | null | undefined, maxLines = 120) {
  if (!logFile) return [] as string[];
  const filePath = resolveLogPath(logFile);
  if (!fs.existsSync(filePath)) return [] as string[];
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const lines = raw.split(/\r?\n/u).map((line) => line.trimEnd()).filter(Boolean);
    return lines.slice(-maxLines);
  } catch {
    return [] as string[];
  }
}

function readCommandText(binary: string, args: string[], timeout = 15_000) {
  const result = spawnSync(binary, args, {
    encoding: "utf8",
    timeout,
  });

  return {
    ok: result.status === 0,
    stdout: (result.stdout ?? "").trim(),
    stderr: (result.stderr ?? "").trim(),
  };
}

function parseKeyValueOutput(raw: string) {
  const out: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/u)) {
    const idx = line.indexOf("=");
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (key) out[key] = value;
  }
  return out;
}

function shortenRef(value: string | null) {
  if (!value) return null;
  const trimmed = value.trim();
  if (trimmed.length <= 20) return trimmed;
  return trimmed.slice(0, 20);
}

function runHostProbe(config: SelfUpdateConfig, script: string, timeout = 60_000) {
  if (!config.hostInstallDir || !path.isAbsolute(config.hostInstallDir)) {
    return {
      ok: false,
      stdout: "",
      stderr: "Host install dir invalide.",
    };
  }

  const args = [
    "run",
    "--rm",
    "-v",
    "/var/run/docker.sock:/var/run/docker.sock",
    "-v",
    `${config.hostInstallDir}:/host:ro`,
    config.runnerImage,
    "sh",
    "-lc",
    script,
  ];

  return readCommandText("docker", args, timeout);
}

function verifyGitAvailability(config: SelfUpdateConfig): SelfUpdateAvailability | null {
  const probe = runHostProbe(
    config,
    [
      "set -eu",
      "if [ ! -d /host/.git ]; then",
      "  printf 'mode=none\\n'",
      "  exit 0",
      "fi",
      "if ! command -v git >/dev/null 2>&1; then apk add --no-cache git >/dev/null 2>&1 || true; fi",
      "if ! command -v git >/dev/null 2>&1; then",
      "  printf 'mode=git\\nerror=git_missing\\n'",
      "  exit 0",
      "fi",
      "current=$(git -C /host rev-parse HEAD 2>/dev/null || true)",
      `remote=$(git -C /host ls-remote origin refs/heads/${shQuote(config.branch)} 2>/dev/null | awk 'NR==1{print $1}')`,
      "printf 'mode=git\\n'",
      "printf 'current=%s\\n' \"$current\"",
      "printf 'remote=%s\\n' \"$remote\"",
    ].join("\n"),
    30_000,
  );

  if (!probe.ok && !probe.stdout) {
    return null;
  }

  const parsed = parseKeyValueOutput(probe.stdout);
  if (parsed.mode !== "git") {
    return null;
  }

  if (parsed.error === "git_missing") {
    return {
      status: "error",
      message: "Git absent dans le runner de vérification.",
      checkedAt: timestamp(),
      currentRef: null,
      availableRef: null,
      serviceImage: null,
    };
  }

  if (!parsed.current) {
    return {
      status: "error",
      message: "Impossible de lire le commit local.",
      checkedAt: timestamp(),
      currentRef: null,
      availableRef: null,
      serviceImage: null,
    };
  }

  if (!parsed.remote) {
    return {
      status: "error",
      message: "Impossible de joindre le dépôt distant.",
      checkedAt: timestamp(),
      currentRef: shortenRef(parsed.current),
      availableRef: null,
      serviceImage: null,
    };
  }

  const updateAvailable = parsed.remote.trim() !== parsed.current.trim();
  return {
    status: updateAvailable ? "update-available" : "up-to-date",
    message: updateAvailable
      ? "Un nouveau commit est disponible sur la branche distante."
      : "Le dépôt local est déjà à jour.",
    checkedAt: timestamp(),
    currentRef: shortenRef(parsed.current),
    availableRef: shortenRef(parsed.remote),
    serviceImage: null,
  };
}

function verifyImageAvailability(config: SelfUpdateConfig): SelfUpdateAvailability {
  const probe = runHostProbe(
    config,
    [
      "set -eu",
      "service_image=$(docker compose -f /host/docker-compose.yml config --images 2>/dev/null | head -n 1)",
      `current=$(docker inspect --format '{{.Image}}' ${shQuote(config.service)} 2>/dev/null || true)`,
      "before=$(if [ -n \"$service_image\" ]; then docker image inspect --format '{{.Id}}' \"$service_image\" 2>/dev/null || true; fi)",
      "pull_output=$(if [ -n \"$service_image\" ]; then docker pull \"$service_image\" 2>&1 || true; fi)",
      "after=$(if [ -n \"$service_image\" ]; then docker image inspect --format '{{.Id}}' \"$service_image\" 2>/dev/null || true; fi)",
      "printf 'service_image=%s\\n' \"$service_image\"",
      "printf 'current=%s\\n' \"$current\"",
      "printf 'before=%s\\n' \"$before\"",
      "printf 'after=%s\\n' \"$after\"",
      "printf 'pull_output_b64=%s\\n' \"$(printf '%s' \"$pull_output\" | base64 | tr -d '\\n')\"",
    ].join("\n"),
    90_000,
  );

  if (!probe.ok && !probe.stdout) {
    return {
      status: "error",
      message: probe.stderr || "Impossible de lancer la vérification image.",
      checkedAt: timestamp(),
      currentRef: null,
      availableRef: null,
      serviceImage: null,
    };
  }

  const parsed = parseKeyValueOutput(probe.stdout);
  const serviceImage = parsed.service_image || null;
  const pullOutput = parsed.pull_output_b64
    ? Buffer.from(parsed.pull_output_b64, "base64").toString("utf8")
    : "";

  if (!serviceImage) {
    return {
      status: "unknown",
      message: "Image du service introuvable dans la compose.",
      checkedAt: timestamp(),
      currentRef: null,
      availableRef: null,
      serviceImage: null,
    };
  }

  if (
    /pull access denied|repository does not exist|requested access to the resource is denied/i.test(pullOutput)
  ) {
    return {
      status: "unknown",
      message: "Image locale build détectée: aucun registre distant exploitable pour comparer.",
      checkedAt: timestamp(),
      currentRef: shortenRef(parsed.current || parsed.before || null),
      availableRef: shortenRef(parsed.after || null),
      serviceImage,
    };
  }

  if (pullOutput && /error|denied|unauthorized|not found/i.test(pullOutput) && !/image is up to date/i.test(pullOutput)) {
    return {
      status: "error",
      message: pullOutput.split(/\r?\n/u).filter(Boolean)[0] ?? "Impossible de vérifier l’image distante.",
      checkedAt: timestamp(),
      currentRef: shortenRef(parsed.current || parsed.before || null),
      availableRef: shortenRef(parsed.after || null),
      serviceImage,
    };
  }

  const updateAvailable =
    /downloaded newer image/i.test(pullOutput) ||
    (Boolean(parsed.before) && Boolean(parsed.after) && parsed.before !== parsed.after) ||
    (Boolean(parsed.current) && Boolean(parsed.after) && parsed.current !== parsed.after);

  return {
    status: updateAvailable ? "update-available" : "up-to-date",
    message: updateAvailable
      ? "Une nouvelle image est prête. Lance la mise à jour pour la redéployer."
      : "Aucune nouvelle image détectée.",
    checkedAt: timestamp(),
    currentRef: shortenRef(parsed.current || parsed.before || null),
    availableRef: shortenRef(parsed.after || null),
    serviceImage,
  };
}

function resolveAvailability(config: SelfUpdateConfig, options?: { refresh?: boolean }) {
  if (!config.enabled) {
    const availability = {
      status: "disabled",
      message: "Mise à jour UI désactivée.",
      checkedAt: timestamp(),
      currentRef: null,
      availableRef: null,
      serviceImage: null,
    } satisfies SelfUpdateAvailability;
    writeAvailability(availability);
    return availability;
  }

  const cached = readAvailability();
  const checkedAtMs = cached.checkedAt ? new Date(cached.checkedAt).getTime() : Number.NaN;
  const cacheStillFresh =
    Number.isFinite(checkedAtMs) && Date.now() - checkedAtMs <= AVAILABILITY_TTL_MS;

  if (!options?.refresh && cacheStillFresh) {
    return cached;
  }

  const byGit = verifyGitAvailability(config);
  const availability = byGit ?? verifyImageAvailability(config);
  writeAvailability(availability);
  return availability;
}

function refreshStateFromResult(state: SelfUpdateState) {
  const current = state.current;
  if (!current || current.status !== "running") {
    return state;
  }

  const resultPath = resolveLogPath(current.resultFile);
  const result = readResultFile(resultPath);
  if (!result) return state;

  current.status = result.status === "success" ? "success" : "failed";
  current.finishedAt = result.finishedAt || timestamp();
  current.error = current.status === "failed" ? result.error || `Update échouée (exit ${result.exitCode ?? "?"}).` : null;
  current.message =
    current.status === "success"
      ? "Mise à jour terminée."
      : current.error;

  if (current.containerName) {
    spawnSync("docker", ["rm", "-f", current.containerName], { stdio: "ignore" });
    current.containerName = null;
  }

  state.history = [current, ...state.history.filter((entry) => entry.id !== current.id)].slice(0, resolveConfig().maxHistory);
  state.current = current;
  writeState(state);
  return state;
}

function buildRunnerScript(options: {
  jobId: string;
  branch: string;
  service: string;
}) {
  const logPath = `/state/self-update/${options.jobId}.log`;
  const resultPath = `/state/self-update/${options.jobId}.result`;

  return [
    "set -Eeuo pipefail",
    "mkdir -p /state/self-update",
    `LOG_FILE=${shQuote(logPath)}`,
    `RESULT_FILE=${shQuote(resultPath)}`,
    "touch \"$LOG_FILE\"",
    "log(){ printf '[%s] %s\\n' \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\" \"$*\" | tee -a \"$LOG_FILE\"; }",
    "write_result(){",
    "  local status=\"$1\"",
    "  local err=\"${2:-}\"",
    "  printf 'status=%s\\n' \"$status\" > \"$RESULT_FILE\"",
    "  printf 'finishedAt=%s\\n' \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\" >> \"$RESULT_FILE\"",
    "  if [ -n \"$err\" ]; then",
    "    printf 'error=%s\\n' \"$err\" >> \"$RESULT_FILE\"",
    "  fi",
    "}",
    "on_exit(){",
    "  local code=$?",
    "  if [ \"$code\" -eq 0 ]; then",
    "    write_result success",
    "  else",
    "    write_result failed \"Commande échouée (exit $code)\"",
    "  fi",
    "}",
    "trap on_exit EXIT",
    "if [ -d /host/.git ]; then",
    "  if ! command -v git >/dev/null 2>&1; then apk add --no-cache git >/dev/null; fi",
    "  log 'Update ProxmoxCenter: git pull'",
    `  git -C /host pull origin ${shQuote(options.branch)} 2>&1 | tee -a \"$LOG_FILE\"`,
    "else",
    "  log 'Update ProxmoxCenter: repo local absent, docker compose pull'",
    "  docker compose -f /host/docker-compose.yml pull 2>&1 | tee -a \"$LOG_FILE\"",
    "fi",
    "log 'Update ProxmoxCenter: docker compose down'",
    "docker compose -f /host/docker-compose.yml down 2>&1 | tee -a \"$LOG_FILE\"",
    "log 'Update ProxmoxCenter: docker compose up -d --build'",
    "docker compose -f /host/docker-compose.yml up -d --build 2>&1 | tee -a \"$LOG_FILE\"",
    `log 'Update ProxmoxCenter: docker compose logs --tail=200 ${options.service}'`,
    `docker compose -f /host/docker-compose.yml logs --tail=200 ${shQuote(options.service)} 2>&1 | tee -a \"$LOG_FILE\" || true`,
    "log 'Update ProxmoxCenter terminé.'",
  ].join("\n");
}

function runDetachedUpdateContainer(config: SelfUpdateConfig, job: SelfUpdateJob) {
  const script = buildRunnerScript({
    jobId: job.id,
    branch: job.branch,
    service: job.service,
  });

  const args = [
    "run",
    "-d",
    "--name",
    job.containerName ?? `proxmoxcenter-self-update-${job.id.slice(-8)}`,
    "-v",
    "/var/run/docker.sock:/var/run/docker.sock",
    "-v",
    `${config.hostInstallDir}:/host:rw`,
    "-v",
    `${config.hostDataDir}:/state:rw`,
    config.runnerImage,
    "sh",
    "-lc",
    script,
  ];

  const result = spawnSync("docker", args, {
    encoding: "utf8",
  });

  if (result.status !== 0) {
    throw new Error(result.stderr?.trim() || result.stdout?.trim() || "Impossible de lancer le conteneur de mise à jour.");
  }

  const containerId = (result.stdout ?? "").trim();
  return {
    containerId,
  };
}

export function getSelfUpdateOverview(options?: { refreshAvailability?: boolean }) {
  const config = resolveConfig();
  const prereq = checkPrerequisites();

  const state = refreshStateFromResult(readState());
  const job = state.current;
  const availability = resolveAvailability(config, {
    refresh: Boolean(options?.refreshAvailability) && job?.status !== "running",
  });

  return {
    enabled: config.enabled,
    config: {
      branch: config.branch,
      service: config.service,
      runnerImage: config.runnerImage,
      installDir: config.hostInstallDir,
    },
    prerequisites: prereq,
    availability,
    current: job,
    history: state.history.slice(0, 12),
    logs: tailLogLines(job?.logFile),
  };
}

export function startSelfUpdate(requestedBy: string | null) {
  const config = resolveConfig();
  if (!config.enabled) {
    throw new Error("Mise à jour UI désactivée (PROXMOXCENTER_SELF_UPDATE_ENABLED=0).");
  }

  const prereq = checkPrerequisites();
  if (!prereq.dockerCliAvailable) {
    throw new Error("Docker CLI indisponible dans le conteneur ProxmoxCenter.");
  }
  if (!prereq.dockerSocketAvailable) {
    throw new Error("Docker socket non monté (/var/run/docker.sock). Mise à jour UI impossible.");
  }

  const running = readState().current;
  if (running?.status === "running") {
    throw new Error("Une mise à jour est déjà en cours.");
  }

  ensureStateDir();
  const id = `upd-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const logFile = `${id}.log`;
  const resultFile = `${id}.result`;
  const containerName = `proxmoxcenter-self-update-${id.slice(-8).toLowerCase()}`;

  fs.writeFileSync(resolveLogPath(logFile), `[${timestamp()}] Demande de mise à jour reçue.\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  fs.rmSync(resolveLogPath(resultFile), { force: true });

  const job: SelfUpdateJob = {
    id,
    status: "running",
    requestedBy,
    startedAt: timestamp(),
    finishedAt: null,
    containerName,
    branch: config.branch,
    service: config.service,
    logFile,
    resultFile,
    message: "Mise à jour démarrée.",
    error: null,
  };

  try {
    runDetachedUpdateContainer(config, job);
  } catch (error) {
    job.status = "failed";
    job.finishedAt = timestamp();
    job.error = error instanceof Error ? error.message : "Impossible de lancer le job de mise à jour.";
    job.message = job.error;
    job.containerName = null;
  }

  mutateState((state) => {
    state.current = job;
    state.history = [job, ...state.history.filter((entry) => entry.id !== job.id)].slice(0, config.maxHistory);
  });

  return getSelfUpdateOverview();
}

export function resetSelfUpdateState() {
  mutateState((state) => {
    state.current = null;
  });
  return getSelfUpdateOverview();
}
