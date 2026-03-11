import "server-only";
import fs from "node:fs";
import path from "node:path";
import type { HardwareSnapshot } from "@/lib/hardware/redfish";

export type RuntimeHardwareSnapshotState = {
  status: "idle" | "ok" | "error";
  attemptedAt: string | null;
  fetchedAt: string | null;
  error: string | null;
  snapshot: HardwareSnapshot | null;
};

function getDefaultRuntimeHardwareSnapshotPath() {
  return path.join(process.cwd(), "data", "hardware-monitor-snapshot.json");
}

function getRuntimeHardwareSnapshotPath() {
  const custom = process.env.PROXCENTER_HARDWARE_MONITOR_SNAPSHOT_PATH?.trim();
  return custom || getDefaultRuntimeHardwareSnapshotPath();
}

function ensureParentDirectory(filePath: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function normalizeState(value: unknown): RuntimeHardwareSnapshotState | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const status = record.status;
  if (status !== "idle" && status !== "ok" && status !== "error") return null;
  return {
    status,
    attemptedAt: typeof record.attemptedAt === "string" && record.attemptedAt.trim() ? record.attemptedAt : null,
    fetchedAt: typeof record.fetchedAt === "string" && record.fetchedAt.trim() ? record.fetchedAt : null,
    error: typeof record.error === "string" && record.error.trim() ? record.error : null,
    snapshot:
      record.snapshot && typeof record.snapshot === "object"
        ? (record.snapshot as HardwareSnapshot)
        : null,
  };
}

export function readRuntimeHardwareSnapshotState(): RuntimeHardwareSnapshotState {
  const filePath = getRuntimeHardwareSnapshotPath();
  if (!fs.existsSync(filePath)) {
    return {
      status: "idle",
      attemptedAt: null,
      fetchedAt: null,
      error: null,
      snapshot: null,
    };
  }
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    if (!raw.trim()) {
      return {
        status: "idle",
        attemptedAt: null,
        fetchedAt: null,
        error: null,
        snapshot: null,
      };
    }
    return normalizeState(JSON.parse(raw)) ?? {
      status: "idle",
      attemptedAt: null,
      fetchedAt: null,
      error: null,
      snapshot: null,
    };
  } catch {
    return {
      status: "idle",
      attemptedAt: null,
      fetchedAt: null,
      error: null,
      snapshot: null,
    };
  }
}

export function writeRuntimeHardwareSnapshotState(state: RuntimeHardwareSnapshotState) {
  const filePath = getRuntimeHardwareSnapshotPath();
  ensureParentDirectory(filePath);
  fs.writeFileSync(filePath, `${JSON.stringify(state, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
}
