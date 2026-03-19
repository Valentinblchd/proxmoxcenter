import "server-only";

import fs from "node:fs";
import path from "node:path";
import { timingSafeEqual } from "node:crypto";
import { randomHex } from "@/lib/auth/session";

const DEFAULT_BOOTSTRAP_CODE_PATH = path.join(process.cwd(), "data", "bootstrap-code.txt");

function normalizeCustomPath(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function getBootstrapCodePath() {
  return (
    normalizeCustomPath(process.env.PROXMOXCENTER_BOOTSTRAP_CODE_PATH) ??
    normalizeCustomPath(process.env.PROXCENTER_BOOTSTRAP_CODE_PATH) ??
    DEFAULT_BOOTSTRAP_CODE_PATH
  );
}

function ensureParentDirectory(filePath: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
}

function buildBootstrapCode() {
  const raw = randomHex(10).toUpperCase();
  return [raw.slice(0, 4), raw.slice(4, 8), raw.slice(8, 12), raw.slice(12)].filter(Boolean).join("-");
}

function normalizeInput(value: string) {
  return value.trim().toUpperCase();
}

export function ensureBootstrapCode() {
  const filePath = getBootstrapCodePath();
  ensureParentDirectory(filePath);

  if (fs.existsSync(filePath)) {
    const current = fs.readFileSync(filePath, "utf8").trim();
    if (current) {
      try {
        fs.chmodSync(filePath, 0o600);
      } catch {
        // Ignore chmod issues on unsupported filesystems.
      }
      return current;
    }
  }

  const nextCode = buildBootstrapCode();
  fs.writeFileSync(filePath, `${nextCode}\n`, { encoding: "utf8", mode: 0o600 });
  return nextCode;
}

export function consumeBootstrapCode(input: unknown) {
  if (typeof input !== "string") {
    return false;
  }

  const provided = normalizeInput(input);
  if (!provided) {
    return false;
  }

  const filePath = getBootstrapCodePath();
  if (!fs.existsSync(filePath)) {
    return false;
  }

  const expected = normalizeInput(fs.readFileSync(filePath, "utf8"));
  if (!expected) {
    return false;
  }

  const expectedBuffer = Buffer.from(expected, "utf8");
  const providedBuffer = Buffer.from(provided, "utf8");
  if (
    expectedBuffer.length !== providedBuffer.length ||
    !timingSafeEqual(expectedBuffer, providedBuffer)
  ) {
    return false;
  }

  fs.rmSync(filePath, { force: true });
  return true;
}
