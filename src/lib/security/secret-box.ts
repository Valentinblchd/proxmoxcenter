import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { readRuntimeAuthConfig } from "@/lib/auth/runtime-config";

const SECRET_BOX_VERSION = "v1";
const SECRET_BOX_ALGO = "aes-256-gcm";

function toBase64(input: Uint8Array | Buffer) {
  return Buffer.from(input).toString("base64");
}

function fromBase64(value: string) {
  return Buffer.from(value, "base64");
}

function resolveSecretBoxSeed() {
  const envSeed = process.env.PROXCENTER_SECRET_KEY?.trim();
  if (envSeed) return envSeed;

  const runtimeAuth = readRuntimeAuthConfig();
  if (runtimeAuth?.sessionSecret) return runtimeAuth.sessionSecret;

  throw new Error(
    "Secret encryption key unavailable. Configure auth first or set PROXCENTER_SECRET_KEY.",
  );
}

function deriveKey() {
  const seed = resolveSecretBoxSeed();
  return createHash("sha256")
    .update(`proxcenter:secret-box:${seed}`)
    .digest();
}

export function sealSecret(value: string) {
  const key = deriveKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv(SECRET_BOX_ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `${SECRET_BOX_VERSION}:${toBase64(iv)}:${toBase64(tag)}:${toBase64(encrypted)}`;
}

export function openSecret(payload: string) {
  const [version, ivB64, tagB64, encryptedB64] = payload.split(":");
  if (version !== SECRET_BOX_VERSION || !ivB64 || !tagB64 || !encryptedB64) {
    return null;
  }

  try {
    const key = deriveKey();
    const decipher = createDecipheriv(SECRET_BOX_ALGO, key, fromBase64(ivB64));
    decipher.setAuthTag(fromBase64(tagB64));
    const decrypted = Buffer.concat([
      decipher.update(fromBase64(encryptedB64)),
      decipher.final(),
    ]);
    return decrypted.toString("utf8");
  } catch {
    return null;
  }
}
