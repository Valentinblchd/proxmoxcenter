import "server-only";

import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";

type SelfUpdateStatus = "idle" | "running" | "success" | "failed";

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

type SelfUpdateConfig = {
  enabled: boolean;
  hostInstallDir: string;
  hostDataDir: string;
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
  const enabled = asBooleanEnv(process.env.PROXMOXCENTER_SELF_UPDATE_ENABLED, false);
  const hostInstallDir =
    process.env.PROXMOXCENTER_SELF_UPDATE_INSTALL_DIR?.trim() ||
    "/opt/proxmoxcenter";
  const hostDataDir =
    process.env.PROXMOXCENTER_SELF_UPDATE_DATA_DIR?.trim() ||
    "/opt/proxmoxcenter/data";

  return {
    enabled,
    hostInstallDir,
    hostDataDir,
    branch: asSafeName(process.env.PROXMOXCENTER_SELF_UPDATE_BRANCH, "main"),
    service: asSafeName(process.env.PROXMOXCENTER_SELF_UPDATE_SERVICE, "proxmoxcenter"),
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
    "if [ -d /host/app/.git ]; then",
    "  if ! command -v git >/dev/null 2>&1; then apk add --no-cache git >/dev/null; fi",
    "  log 'Update ProxmoxCenter: git pull'",
    `  git -C /host/app pull origin ${shQuote(options.branch)} 2>&1 | tee -a \"$LOG_FILE\"`,
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

export function getSelfUpdateOverview() {
  const config = resolveConfig();
  const prereq = checkPrerequisites();

  const state = refreshStateFromResult(readState());
  const job = state.current;

  return {
    enabled: config.enabled,
    config: {
      branch: config.branch,
      service: config.service,
      runnerImage: config.runnerImage,
      installDir: config.hostInstallDir,
    },
    prerequisites: prereq,
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
