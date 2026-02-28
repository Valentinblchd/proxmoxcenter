import "server-only";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  buildPbsRepository,
  readRuntimePbsConfig,
  type RuntimePbsConfig,
} from "@/lib/pbs/runtime-config";

export class PbsToolingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PbsToolingError";
  }
}

export class PbsCommandCancelledError extends Error {
  constructor(message = "Import PBS annulé.") {
    super(message);
    this.name = "PbsCommandCancelledError";
  }
}

type CommandResult = {
  lines: string[];
};

type UploadArchiveToPbsOptions = {
  config: RuntimePbsConfig;
  filename: string;
  bytes: Uint8Array;
  onLine?: (line: string, lines: string[]) => void;
  shouldCancel?: () => boolean;
};

type PbsCommandOptions = {
  env: NodeJS.ProcessEnv;
  onLine?: (line: string, lines: string[]) => void;
  shouldCancel?: () => boolean;
};

type RestoreArchiveFromPbsOptions = {
  config: RuntimePbsConfig;
  snapshot: string;
  archiveName: string;
  namespace?: string | null;
  shouldCancel?: () => boolean;
};

const MAX_PBS_STAGED_DOWNLOAD_BYTES = 512 * 1024 * 1024;

function asNonEmptyLine(value: string) {
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, 500) : null;
}

function sanitizeBackupId(value: string) {
  const base = value
    .replace(/\.[^.]+$/u, "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return (base || "cloud-restore").slice(0, 64);
}

function buildPbsEnv(config: RuntimePbsConfig) {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PBS_REPOSITORY: buildPbsRepository(config),
    PBS_PASSWORD: config.secret,
  };

  if (config.fingerprint) {
    env.PBS_FINGERPRINT = config.fingerprint;
  }

  return env;
}

function appendRepositoryArgs(
  args: string[],
  config: RuntimePbsConfig,
  namespace?: string | null,
  outputFormat?: "json" | "json-pretty",
) {
  const next = [...args, "--repository", buildPbsRepository(config)];
  const effectiveNamespace = namespace?.trim() || config.namespace;
  if (effectiveNamespace) {
    next.push("--ns", effectiveNamespace);
  }
  if (outputFormat) {
    next.push("--output-format", outputFormat);
  }
  return next;
}

async function runCommand(args: string[], options: PbsCommandOptions) {
  return new Promise<CommandResult>((resolve, reject) => {
    const child = spawn("proxmox-backup-client", args, {
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const lines: string[] = [];
    let settled = false;
    let killedForCancel = false;
    let killEscalated = false;

    const cleanup = () => {
      clearInterval(cancelTimer);
    };

    const pushLine = (chunk: string) => {
      for (const rawLine of chunk.split(/\r?\n/u)) {
        const line = asNonEmptyLine(rawLine);
        if (!line) continue;
        lines.push(line);
        if (lines.length > 40) {
          lines.splice(0, lines.length - 40);
        }
        options.onLine?.(line, [...lines]);
      }
    };

    const cancelTimer = setInterval(() => {
      if (settled || !options.shouldCancel?.()) return;
      if (!killedForCancel) {
        killedForCancel = true;
        child.kill("SIGTERM");
        return;
      }
      if (!killEscalated) {
        killEscalated = true;
        child.kill("SIGKILL");
      }
    }, 1000);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", pushLine);
    child.stderr.on("data", pushLine);

    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        reject(
          new PbsToolingError(
            "Le binaire proxmox-backup-client est introuvable. Installe-le dans l’environnement de l’application pour activer PBS direct.",
          ),
        );
        return;
      }
      reject(error);
    });

    child.on("close", (code, signal) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (killedForCancel || signal === "SIGTERM") {
        reject(new PbsCommandCancelledError());
        return;
      }
      if (code === 0) {
        resolve({ lines });
        return;
      }
      reject(
        new PbsToolingError(
          lines.at(-1) ?? `Commande PBS échouée (code ${code ?? "?"}).`,
        ),
      );
    });
  });
}

async function runJsonCommand(
  args: string[],
  options: Pick<PbsCommandOptions, "env" | "shouldCancel">,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const child = spawn("proxmox-backup-client", args, {
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    let killedForCancel = false;
    let killEscalated = false;

    const cleanup = () => {
      clearInterval(cancelTimer);
    };

    const cancelTimer = setInterval(() => {
      if (settled || !options.shouldCancel?.()) return;
      if (!killedForCancel) {
        killedForCancel = true;
        child.kill("SIGTERM");
        return;
      }
      if (!killEscalated) {
        killEscalated = true;
        child.kill("SIGKILL");
      }
    }, 1000);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });

    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        reject(
          new PbsToolingError(
            "Le binaire proxmox-backup-client est introuvable. Installe-le dans l’environnement de l’application pour activer PBS direct.",
          ),
        );
        return;
      }
      reject(error);
    });

    child.on("close", (code, signal) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (killedForCancel || signal === "SIGTERM") {
        reject(new PbsCommandCancelledError());
        return;
      }
      if (code !== 0) {
        reject(
          new PbsToolingError(
            stderr.trim() || `Commande PBS échouée (code ${code ?? "?"}).`,
          ),
        );
        return;
      }
      try {
        resolve(stdout.trim() ? (JSON.parse(stdout) as unknown) : []);
      } catch {
        reject(new PbsToolingError("Réponse JSON PBS invalide."));
      }
    });
  });
}

async function runLocalCommand(binary: string, args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(binary, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new PbsToolingError(stderr.trim() || `${binary} a échoué (${code ?? "?"}).`));
    });
  });
}

async function collectDirectoryMetrics(rootPath: string): Promise<{
  totalBytes: number;
  fileCount: number;
  topLevelEntries: string[];
}> {
  let totalBytes = 0;
  let fileCount = 0;

  async function walk(currentPath: string): Promise<void> {
    const entries = await readdir(currentPath, { withFileTypes: true });
    for (const entry of entries) {
      const nextPath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        await walk(nextPath);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      const details = await stat(nextPath);
      totalBytes += details.size;
      fileCount += 1;
      if (totalBytes > MAX_PBS_STAGED_DOWNLOAD_BYTES) {
        throw new PbsToolingError(
          "Archive PBS trop volumineuse pour un staging web. Télécharge-la depuis PBS ou restaure-la côté Proxmox/PBS.",
        );
      }
    }
  }

  await walk(rootPath);
  return {
    totalBytes,
    fileCount,
    topLevelEntries: await readdir(rootPath),
  };
}

function sanitizeOutputFilename(value: string) {
  return value
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 180) || "pbs-archive";
}

export async function runPbsJsonCommand(
  config: RuntimePbsConfig,
  args: string[],
  options?: {
    namespace?: string | null;
    shouldCancel?: () => boolean;
  },
) {
  return runJsonCommand(
    appendRepositoryArgs(args, config, options?.namespace, "json"),
    {
      env: buildPbsEnv(config),
      shouldCancel: options?.shouldCancel,
    },
  );
}

export async function readPbsToolingStatus() {
  try {
    const result = await runCommand(["version"], {
      env: process.env,
    });
    const line = result.lines.find((entry) => /proxmox-backup-client/i.test(entry)) ?? null;
    return {
      available: true,
      version: line,
    };
  } catch (error) {
    if (error instanceof PbsToolingError) {
      return {
        available: false,
        version: null,
        error: error.message,
      };
    }
    return {
      available: false,
      version: null,
      error: error instanceof Error ? error.message : "Outil PBS indisponible.",
    };
  }
}

export async function uploadArchiveToPbsDirect(options: UploadArchiveToPbsOptions) {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "proxcenter-pbs-"));
  const payloadDir = path.join(tempRoot, "payload");
  const targetFile = path.join(payloadDir, options.filename);
  const backupId = sanitizeBackupId(options.filename);

  try {
    await mkdir(payloadDir, { recursive: true });
    await writeFile(targetFile, Buffer.from(options.bytes));

    const args = [
      "backup",
      `cloud-restore.pxar:${payloadDir}`,
      "--repository",
      buildPbsRepository(options.config),
      "--backup-type",
      "host",
      "--backup-id",
      backupId,
    ];
    if (options.config.namespace) {
      args.push("--ns", options.config.namespace);
    }

    const result = await runCommand(args, {
      env: buildPbsEnv(options.config),
      onLine: options.onLine,
      shouldCancel: options.shouldCancel,
    });

    const namespace = options.config.namespace ? `/${options.config.namespace}` : "";
    const snapshot = `pbs:${options.config.datastore}${namespace}:host/${backupId}`;

    return {
      backupId,
      snapshot,
      lines: result.lines,
    };
  } finally {
    await rm(tempRoot, { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function restoreArchiveFromPbs(options: RestoreArchiveFromPbsOptions) {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "proxcenter-pbs-restore-"));
  const outputDir = path.join(tempRoot, "restore");

  try {
    await mkdir(outputDir, { recursive: true });
    const result = await runCommand(
      appendRepositoryArgs(
        ["restore", options.snapshot, options.archiveName, outputDir],
        options.config,
        options.namespace,
      ),
      {
        env: buildPbsEnv(options.config),
        shouldCancel: options.shouldCancel,
      },
    );

    const metrics = await collectDirectoryMetrics(outputDir);
    if (metrics.fileCount === 0) {
      throw new PbsToolingError("Aucun contenu restauré depuis PBS.");
    }

    if (metrics.fileCount === 1 && metrics.topLevelEntries.length === 1) {
      const singlePath = path.join(outputDir, metrics.topLevelEntries[0]);
      const singleStat = await stat(singlePath);
      if (singleStat.isFile()) {
        return {
          filename: metrics.topLevelEntries[0],
          bytes: new Uint8Array(await readFile(singlePath)),
          contentType: "application/octet-stream",
          lines: result.lines,
        };
      }
    }

    const archiveBase = sanitizeOutputFilename(`${path.basename(options.snapshot)}-${options.archiveName}`);
    const archivePath = path.join(tempRoot, `${archiveBase}.tar.gz`);
    await runLocalCommand("tar", ["-czf", archivePath, "-C", outputDir, "."]);
    const archiveStat = await stat(archivePath);
    if (archiveStat.size > MAX_PBS_STAGED_DOWNLOAD_BYTES) {
      throw new PbsToolingError(
        "Archive restaurée trop volumineuse pour un téléchargement web. Utilise PBS/Proxmox pour une restauration serveur.",
      );
    }

    return {
      filename: `${archiveBase}.tar.gz`,
      bytes: new Uint8Array(await readFile(archivePath)),
      contentType: "application/gzip",
      lines: result.lines,
    };
  } finally {
    await rm(tempRoot, { recursive: true, force: true }).catch(() => undefined);
  }
}

export function requireRuntimePbsConfig() {
  const config = readRuntimePbsConfig();
  if (!config) {
    throw new PbsToolingError("Connexion PBS directe non configurée.");
  }
  return config;
}
