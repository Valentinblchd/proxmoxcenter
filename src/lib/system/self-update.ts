import "server-only";

import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Agent, fetch } from "undici";

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
  containerImage: string | null;
};

type SelfUpdateConfig = {
  enabled: boolean;
  hostInstallDir: string;
  hostDataDir: string;
  composeFile: string;
  branch: string;
  service: string;
  runnerImage: string;
  fallbackRunnerImage: string | null;
  maxHistory: number;
};

type DockerContainerInspect = {
  Image?: string;
  Config?: {
    Image?: string;
    Labels?: Record<string, unknown>;
  };
};

type DockerImageInspect = {
  Id?: string;
};

type DockerCreateResponse = {
  Id?: string;
  Warnings?: string[];
};

type DockerWaitResponse = {
  StatusCode?: number;
  Error?: {
    Message?: string;
  };
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
const DOCKER_SOCKET_PATH = "/var/run/docker.sock";
const DOCKER_API_BASE = "http://docker";
const DOCKER_REGISTRY_AUTH = Buffer.from("{}", "utf8").toString("base64");
const DOCKER_SOCKET_AGENT = new Agent({
  connect: {
    socketPath: DOCKER_SOCKET_PATH,
  },
});

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

function getDockerBinaryCandidates() {
  const configured = asAbsolutePath(process.env.PROXMOXCENTER_DOCKER_BIN);
  return [
    configured,
    "/usr/bin/docker",
    "/usr/local/bin/docker",
    "docker",
  ].filter((value, index, list): value is string => Boolean(value) && list.indexOf(value) === index);
}

function findDockerBinaryPath() {
  for (const candidate of getDockerBinaryCandidates()) {
    if (candidate.includes("/")) {
      try {
        fs.accessSync(candidate, fs.constants.X_OK);
        return candidate;
      } catch {
        continue;
      }
    }
    if (candidate === "docker") {
      const searchPath =
        process.env.PATH || "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";
      for (const directory of searchPath.split(":").map((entry) => entry.trim()).filter(Boolean)) {
        const binaryPath = path.join(directory, candidate);
        try {
          fs.accessSync(binaryPath, fs.constants.X_OK);
          return binaryPath;
        } catch {
          continue;
        }
      }
    }
  }
  return null;
}

function buildDockerUrl(pathname: string, query?: Record<string, string | undefined>) {
  const url = new URL(pathname, DOCKER_API_BASE);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (typeof value === "string" && value.length > 0) {
      url.searchParams.set(key, value);
    }
  }
  return url;
}

async function dockerApiRequest<T>(
  method: string,
  pathname: string,
  options?: {
    query?: Record<string, string | undefined>;
    body?: unknown;
    headers?: Record<string, string>;
    timeoutMs?: number;
    parseJson?: boolean;
  },
) {
  if (!fs.existsSync(DOCKER_SOCKET_PATH)) {
    return {
      ok: false,
      status: 0,
      text: "",
      data: null as T | null,
      error: "Docker socket non monté (/var/run/docker.sock).",
    };
  }

  try {
    const response = await fetch(buildDockerUrl(pathname, options?.query), {
      method,
      dispatcher: DOCKER_SOCKET_AGENT,
      headers: {
        ...(options?.body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(options?.headers ?? {}),
      },
      body:
        options?.body === undefined
          ? undefined
          : typeof options.body === "string"
            ? options.body
            : JSON.stringify(options.body),
      cache: "no-store",
      signal: options?.timeoutMs ? AbortSignal.timeout(options.timeoutMs) : undefined,
    });

    const text = await response.text();
    let data: T | null = null;
    if (options?.parseJson !== false && text.trim()) {
      try {
        data = JSON.parse(text) as T;
      } catch {
        data = null;
      }
    }

    return {
      ok: response.ok,
      status: response.status,
      text,
      data,
      error: response.ok ? null : text.trim() || `${method} ${pathname} a échoué (${response.status}).`,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      text: "",
      data: null as T | null,
      error: error instanceof Error ? error.message : `Impossible de joindre ${pathname}.`,
    };
  }
}

async function inspectDockerContainer(containerIdOrName: string) {
  const result = await dockerApiRequest<DockerContainerInspect>(
    "GET",
    `/containers/${encodeURIComponent(containerIdOrName)}/json`,
    { timeoutMs: 8_000 },
  );
  return result.ok ? result.data : null;
}

async function inspectDockerImage(imageRef: string) {
  const result = await dockerApiRequest<DockerImageInspect>(
    "GET",
    `/images/${encodeURIComponent(imageRef)}/json`,
    { timeoutMs: 12_000 },
  );
  return result.ok ? result.data : null;
}

async function removeDockerContainer(containerIdOrName: string, force = false) {
  await dockerApiRequest(
    "DELETE",
    `/containers/${encodeURIComponent(containerIdOrName)}`,
    {
      query: force ? { force: "1" } : undefined,
      parseJson: false,
      timeoutMs: 10_000,
    },
  );
}

async function pullDockerImage(imageRef: string) {
  return dockerApiRequest(
    "POST",
    "/images/create",
    {
      query: { fromImage: imageRef },
      headers: {
        "X-Registry-Auth": DOCKER_REGISTRY_AUTH,
      },
      parseJson: false,
      timeoutMs: 90_000,
    },
  );
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

async function readSelfComposeMetadata(): Promise<SelfComposeMetadata> {
  const containerId =
    fs.existsSync("/etc/hostname") ? fs.readFileSync("/etc/hostname", "utf8").trim() : "";
  if (!containerId) {
    return {
      workingDir: null,
      configFile: null,
      service: null,
      containerImage: null,
    };
  }

  const inspect = await inspectDockerContainer(containerId);
  if (!inspect) {
    return {
      workingDir: null,
      configFile: null,
      service: null,
      containerImage: null,
    };
  }

  try {
    const labels = inspect.Config?.Labels ?? {};
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
      containerImage:
        typeof inspect.Config?.Image === "string" ? inspect.Config.Image.trim() || null : null,
    };
  } catch {
    return {
      workingDir: null,
      configFile: null,
      service: null,
      containerImage: null,
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

async function resolveConfig(): Promise<SelfUpdateConfig> {
  const composeMetadata = await readSelfComposeMetadata();
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
    fallbackRunnerImage: composeMetadata.containerImage,
    maxHistory: 24,
  };
}

function checkPrerequisites() {
  const dockerSocketAvailable = fs.existsSync("/var/run/docker.sock");
  const dockerCliAvailable = Boolean(findDockerBinaryPath());

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

function getComposeFileInsideMountedHost(config: SelfUpdateConfig) {
  if (config.composeFile.startsWith(config.hostInstallDir)) {
    const relativePath = path.relative(config.hostInstallDir, config.composeFile) || "docker-compose.yml";
    return `/host/${relativePath}`;
  }
  return "/host/docker-compose.yml";
}

async function ensureRunnerImage(imageRef: string) {
  const inspect = await inspectDockerImage(imageRef);
  if (inspect?.Id) return { ok: true, message: "" };

  const pull = await pullDockerImage(imageRef);
  return {
    ok: pull.ok,
    message: pull.error || pull.text.trim() || `Impossible de récupérer ${imageRef}.`,
  };
}

async function createRunnerContainer(options: {
  name: string;
  image: string;
  script: string;
  binds: string[];
}) {
  const firstPass = await dockerApiRequest<DockerCreateResponse>(
    "POST",
    "/containers/create",
    {
      query: { name: options.name },
      body: {
        Image: options.image,
        Cmd: ["sh", "-lc", options.script],
        Tty: true,
        AttachStdout: true,
        AttachStderr: true,
        HostConfig: {
          AutoRemove: false,
          Binds: options.binds,
        },
      },
      timeoutMs: 15_000,
    },
  );

  if (firstPass.ok && firstPass.data?.Id) {
    return { ok: true, id: firstPass.data.Id, error: "" };
  }

  if (firstPass.status === 404 || /No such image/i.test(firstPass.error || firstPass.text)) {
    const pulled = await ensureRunnerImage(options.image);
    if (!pulled.ok) {
      return { ok: false, id: null, error: pulled.message };
    }

    const secondPass = await dockerApiRequest<DockerCreateResponse>(
      "POST",
      "/containers/create",
      {
        query: { name: options.name },
        body: {
          Image: options.image,
          Cmd: ["sh", "-lc", options.script],
          Tty: true,
          AttachStdout: true,
          AttachStderr: true,
          HostConfig: {
            AutoRemove: false,
            Binds: options.binds,
          },
        },
        timeoutMs: 15_000,
      },
    );

    if (secondPass.ok && secondPass.data?.Id) {
      return { ok: true, id: secondPass.data.Id, error: "" };
    }

    return {
      ok: false,
      id: null,
      error: secondPass.error || secondPass.text.trim() || "Impossible de créer le conteneur runner.",
    };
  }

  return {
    ok: false,
    id: null,
    error: firstPass.error || firstPass.text.trim() || "Impossible de créer le conteneur runner.",
  };
}

async function startRunnerContainer(containerId: string) {
  const result = await dockerApiRequest(
    "POST",
    `/containers/${encodeURIComponent(containerId)}/start`,
    {
      parseJson: false,
      timeoutMs: 15_000,
    },
  );
  return {
    ok: result.ok,
    error: result.error || result.text.trim(),
  };
}

async function waitRunnerContainer(containerId: string, timeout = 60_000) {
  const result = await dockerApiRequest<DockerWaitResponse>(
    "POST",
    `/containers/${encodeURIComponent(containerId)}/wait`,
    {
      query: { condition: "not-running" },
      timeoutMs: timeout,
    },
  );

  return {
    ok: result.ok,
    statusCode: result.data?.StatusCode ?? null,
    error:
      result.data?.Error?.Message ||
      result.error ||
      result.text.trim() ||
      "Le runner de vérification n’a pas répondu.",
  };
}

async function readRunnerLogs(containerId: string) {
  const result = await dockerApiRequest(
    "GET",
    `/containers/${encodeURIComponent(containerId)}/logs`,
    {
      query: { stdout: "1", stderr: "1", tail: "all" },
      parseJson: false,
      timeoutMs: 10_000,
    },
  );

  return {
    ok: result.ok,
    text: result.text.trim(),
    error: result.error || result.text.trim(),
  };
}

async function runHostProbe(config: SelfUpdateConfig, script: string, timeout = 60_000) {
  if (!config.hostInstallDir || !path.isAbsolute(config.hostInstallDir)) {
    return {
      ok: false,
      stdout: "",
      stderr: "Host install dir invalide.",
    };
  }

  const runnerCandidates = [
    config.runnerImage,
    config.fallbackRunnerImage,
  ].filter((value, index, list): value is string => Boolean(value) && list.indexOf(value) === index);

  let lastError = "Impossible de lancer le runner de vérification.";

  for (const runnerImage of runnerCandidates) {
    const name = `proxmoxcenter-probe-${Date.now()}-${randomUUID().slice(0, 8)}`.toLowerCase();
    const created = await createRunnerContainer({
      name,
      image: runnerImage,
      script,
      binds: [
        "/var/run/docker.sock:/var/run/docker.sock",
        `${config.hostInstallDir}:/host:ro`,
      ],
    });
    if (!created.ok || !created.id) {
      lastError = created.error || `Runner ${runnerImage} indisponible.`;
      continue;
    }

    try {
      const started = await startRunnerContainer(created.id);
      if (!started.ok) {
        lastError = started.error || `Runner ${runnerImage} indisponible.`;
        continue;
      }

      const waited = await waitRunnerContainer(created.id, timeout);
      const logs = await readRunnerLogs(created.id);
      const stdout = logs.text;
      if (waited.ok && waited.statusCode === 0) {
        return {
          ok: true,
          stdout,
          stderr: "",
        };
      }
      if (stdout) {
        return {
          ok: false,
          stdout,
          stderr: waited.error,
        };
      }

      lastError = waited.error || logs.error || `Runner ${runnerImage} indisponible.`;
    } finally {
      await removeDockerContainer(created.id, true);
    }
  }

  return {
    ok: false,
    stdout: "",
    stderr: lastError,
  };
}

async function verifyGitAvailability(config: SelfUpdateConfig): Promise<SelfUpdateAvailability | null> {
  const probe = await runHostProbe(
    config,
    [
      "set -eu",
      "if [ ! -d /host/.git ]; then",
      "  printf 'mode=none\\n'",
      "  exit 0",
      "fi",
      "if ! command -v git >/dev/null 2>&1; then",
      "  if command -v apk >/dev/null 2>&1; then apk add --no-cache git >/dev/null 2>&1 || true; fi",
      "  if ! command -v git >/dev/null 2>&1 && command -v apt-get >/dev/null 2>&1; then",
      "    export DEBIAN_FRONTEND=noninteractive",
      "    apt-get update >/dev/null 2>&1 || true",
      "    apt-get install -y --no-install-recommends git >/dev/null 2>&1 || true",
      "  fi",
      "fi",
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

async function verifyImageAvailability(config: SelfUpdateConfig): Promise<SelfUpdateAvailability> {
  const serviceContainer = await inspectDockerContainer(config.service);
  const serviceImage =
    typeof serviceContainer?.Config?.Image === "string"
      ? serviceContainer.Config.Image.trim() || null
      : config.fallbackRunnerImage;
  const currentRef =
    typeof serviceContainer?.Image === "string" ? serviceContainer.Image.trim() || null : null;

  if (!serviceImage) {
    return {
      status: "unknown",
      message: "Image du service introuvable dans l’inspection Docker.",
      checkedAt: timestamp(),
      currentRef: null,
      availableRef: null,
      serviceImage: null,
    };
  }

  const before = (await inspectDockerImage(serviceImage))?.Id?.trim() || null;
  const pulled = await pullDockerImage(serviceImage);
  const after = (await inspectDockerImage(serviceImage))?.Id?.trim() || null;
  const pullOutput = (pulled.text || "").trim();

  if (
    /pull access denied|repository does not exist|requested access to the resource is denied|not found: manifest unknown/i.test(
      pullOutput || pulled.error || "",
    )
  ) {
    return {
      status: "unknown",
      message: "Image locale build détectée: aucun registre distant exploitable pour comparer.",
      checkedAt: timestamp(),
      currentRef: shortenRef(currentRef || before),
      availableRef: shortenRef(after),
      serviceImage,
    };
  }

  if (!pulled.ok) {
    return {
      status: "error",
      message:
        pulled.error?.split(/\r?\n/u).find(Boolean) ||
        pullOutput.split(/\r?\n/u).find(Boolean) ||
        "Impossible de vérifier l’image distante.",
      checkedAt: timestamp(),
      currentRef: shortenRef(currentRef || before),
      availableRef: shortenRef(after),
      serviceImage,
    };
  }

  const updateAvailable =
    /Downloaded newer image|Status: Downloaded newer image/i.test(pullOutput) ||
    (Boolean(before) && Boolean(after) && before !== after) ||
    (Boolean(currentRef) && Boolean(after) && currentRef !== after);

  return {
    status: updateAvailable ? "update-available" : "up-to-date",
    message: updateAvailable
      ? "Une nouvelle image est prête. Lance la mise à jour pour la redéployer."
      : "Aucune nouvelle image détectée.",
    checkedAt: timestamp(),
    currentRef: shortenRef(currentRef || before),
    availableRef: shortenRef(after),
    serviceImage,
  };
}

async function resolveAvailability(config: SelfUpdateConfig, options?: { refresh?: boolean }) {
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

  const byGit = await verifyGitAvailability(config);
  const availability = byGit ?? (await verifyImageAvailability(config));
  writeAvailability(availability);
  return availability;
}

async function refreshStateFromResult(state: SelfUpdateState) {
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
    await removeDockerContainer(current.containerName, true);
    current.containerName = null;
  }

  const config = await resolveConfig();
  state.history = [current, ...state.history.filter((entry) => entry.id !== current.id)].slice(0, config.maxHistory);
  state.current = current;
  writeState(state);
  return state;
}

function buildRunnerScript(options: {
  jobId: string;
  branch: string;
  service: string;
  composeFile: string;
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
    "  if ! command -v git >/dev/null 2>&1; then",
    "    if command -v apk >/dev/null 2>&1; then apk add --no-cache git >/dev/null 2>&1 || true; fi",
    "    if ! command -v git >/dev/null 2>&1 && command -v apt-get >/dev/null 2>&1; then",
    "      export DEBIAN_FRONTEND=noninteractive",
    "      apt-get update >/dev/null 2>&1 || true",
    "      apt-get install -y --no-install-recommends git >/dev/null 2>&1 || true",
    "    fi",
    "  fi",
    "  log 'Update ProxmoxCenter: git pull'",
    `  git -C /host pull origin ${shQuote(options.branch)} 2>&1 | tee -a \"$LOG_FILE\"`,
    "else",
    "  log 'Update ProxmoxCenter: repo local absent, docker compose pull'",
    `  docker compose -f ${shQuote(options.composeFile)} pull 2>&1 | tee -a \"$LOG_FILE\"`,
    "fi",
    "log 'Update ProxmoxCenter: docker compose down'",
    `docker compose -f ${shQuote(options.composeFile)} down 2>&1 | tee -a \"$LOG_FILE\"`,
    "log 'Update ProxmoxCenter: docker compose up -d --build'",
    `docker compose -f ${shQuote(options.composeFile)} up -d --build 2>&1 | tee -a \"$LOG_FILE\"`,
    `log 'Update ProxmoxCenter: docker compose logs --tail=200 ${options.service}'`,
    `docker compose -f ${shQuote(options.composeFile)} logs --tail=200 ${shQuote(options.service)} 2>&1 | tee -a \"$LOG_FILE\" || true`,
    "log 'Update ProxmoxCenter terminé.'",
  ].join("\n");
}

async function runDetachedUpdateContainer(config: SelfUpdateConfig, job: SelfUpdateJob) {
  const script = buildRunnerScript({
    jobId: job.id,
    branch: job.branch,
    service: job.service,
    composeFile: getComposeFileInsideMountedHost(config),
  });

  const runnerCandidates = [
    config.runnerImage,
    config.fallbackRunnerImage,
  ].filter((value, index, list): value is string => Boolean(value) && list.indexOf(value) === index);

  let lastError = "Impossible de lancer le conteneur de mise à jour.";

  for (const runnerImage of runnerCandidates) {
    const created = await createRunnerContainer({
      name: job.containerName ?? `proxmoxcenter-self-update-${job.id.slice(-8)}`,
      image: runnerImage,
      script,
      binds: [
        "/var/run/docker.sock:/var/run/docker.sock",
        `${config.hostInstallDir}:/host:rw`,
        `${config.hostDataDir}:/state:rw`,
      ],
    });

    if (!created.ok || !created.id) {
      lastError = created.error || `Runner ${runnerImage} indisponible.`;
      continue;
    }

    const started = await startRunnerContainer(created.id);
    if (started.ok) {
      return {
        containerId: created.id,
      };
    }

    lastError = started.error || `Runner ${runnerImage} indisponible.`;
    await removeDockerContainer(created.id, true);
  }

  throw new Error(lastError);
}

export async function getSelfUpdateOverview(options?: { refreshAvailability?: boolean }) {
  const config = await resolveConfig();
  const prereq = checkPrerequisites();

  const state = await refreshStateFromResult(readState());
  const job = state.current;
  const availability = await resolveAvailability(config, {
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

export async function startSelfUpdate(requestedBy: string | null) {
  const config = await resolveConfig();
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
    await runDetachedUpdateContainer(config, job);
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

export async function resetSelfUpdateState() {
  mutateState((state) => {
    state.current = null;
  });
  return getSelfUpdateOverview();
}
