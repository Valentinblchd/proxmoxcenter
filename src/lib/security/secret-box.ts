import "server-only";
import fs from "node:fs";
import path from "node:path";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { readRuntimeAuthConfig } from "@/lib/auth/runtime-config";

const SECRET_BOX_VERSION = "v2";
const LEGACY_SECRET_BOX_VERSION = "v1";
const SECRET_BOX_ALGO = "aes-256-gcm";

function toBase64(input: Uint8Array | Buffer) {
  return Buffer.from(input).toString("base64");
}

function fromBase64(value: string) {
  return Buffer.from(value, "base64");
}

function getDefaultSecretBoxSeedPath() {
  return path.join(process.cwd(), "data", "secret-box.key");
}

function getSecretBoxSeedPath() {
  const custom = process.env.PROXMOXCENTER_SECRET_BOX_KEY_PATH?.trim();
  return custom || getDefaultSecretBoxSeedPath();
}

function ensureSecretBoxSeedFile() {
  const filePath = getSecretBoxSeedPath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });

  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, `${randomBytes(32).toString("base64url")}\n`, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
  }

  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    // Best effort only.
  }

  return filePath;
}

function resolveCurrentSecretBoxSeed() {
  const envSeed = process.env.PROXCENTER_SECRET_KEY?.trim();
  if (envSeed) return envSeed;

  const filePath = ensureSecretBoxSeedFile();
  const persistedSeed = fs.readFileSync(filePath, "utf8").trim();
  if (persistedSeed) return persistedSeed;

  throw new Error("Secret encryption key unavailable.");
}

function resolveLegacySecretBoxSeed() {
  const envSeed = process.env.PROXCENTER_SECRET_KEY?.trim();
  if (envSeed) return envSeed;

  const runtimeAuth = readRuntimeAuthConfig();
  if (runtimeAuth?.sessionSecret) return runtimeAuth.sessionSecret;

  return null;
}

function deriveKey(seed: string) {
  return createHash("sha256")
    .update(`proxcenter:secret-box:${seed}`)
    .digest();
}

export function sealSecret(value: string) {
  const key = deriveKey(resolveCurrentSecretBoxSeed());
  const iv = randomBytes(12);
  const cipher = createCipheriv(SECRET_BOX_ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `${SECRET_BOX_VERSION}:${toBase64(iv)}:${toBase64(tag)}:${toBase64(encrypted)}`;
}

export function openSecret(payload: string) {
  const [version, ivB64, tagB64, encryptedB64] = payload.split(":");
  if (!ivB64 || !tagB64 || !encryptedB64) {
    return null;
  }

  const candidateSeeds =
    version === SECRET_BOX_VERSION
      ? [resolveCurrentSecretBoxSeed()]
      : version === LEGACY_SECRET_BOX_VERSION
        ? [resolveLegacySecretBoxSeed(), resolveCurrentSecretBoxSeed()].filter(
            (value): value is string => Boolean(value),
          )
        : [];

  for (const seed of candidateSeeds) {
    try {
      const key = deriveKey(seed);
      const decipher = createDecipheriv(SECRET_BOX_ALGO, key, fromBase64(ivB64));
      decipher.setAuthTag(fromBase64(tagB64));
      const decrypted = Buffer.concat([
        decipher.update(fromBase64(encryptedB64)),
        decipher.final(),
      ]);
      return decrypted.toString("utf8");
    } catch {
      // Try next key source.
    }
  }

  return null;
}
