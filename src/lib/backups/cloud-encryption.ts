import "server-only";
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import type { RuntimeBackupCloudTarget } from "@/lib/backups/runtime-config";

type UploadPayload = {
  filename: string;
  bytes: Uint8Array;
  contentType: string;
};

const ENCRYPTION_MAGIC = Buffer.from("PXCLOUD1", "ascii");
const SALT_LENGTH = 16;
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

function isEnabled(value: string | undefined) {
  if (!value) return false;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

export function isCloudUploadEncryptionEnabled(target: RuntimeBackupCloudTarget) {
  return isEnabled(target.settings.encryptupload);
}

export function encryptUploadPayloadIfNeeded(
  target: RuntimeBackupCloudTarget,
  payload: UploadPayload,
): UploadPayload {
  if (!isCloudUploadEncryptionEnabled(target)) {
    return payload;
  }

  const passphrase = target.secrets.encryptionpassphrase?.trim() ?? "";
  if (!passphrase) {
    throw new Error("Chiffrement cloud activé mais passphrase absente.");
  }

  const metadata = Buffer.from(
    JSON.stringify({
      filename: payload.filename,
      contentType: payload.contentType,
      provider: target.provider,
      encryptedAt: new Date().toISOString(),
    }),
    "utf8",
  );

  const metadataLength = Buffer.allocUnsafe(4);
  metadataLength.writeUInt32BE(metadata.byteLength, 0);

  const plaintext = Buffer.concat([
    metadataLength,
    metadata,
    Buffer.from(payload.bytes),
  ]);

  const salt = randomBytes(SALT_LENGTH);
  const iv = randomBytes(IV_LENGTH);
  const key = scryptSync(passphrase, salt, 32);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    filename: `${payload.filename}.pxenc`,
    bytes: Buffer.concat([ENCRYPTION_MAGIC, salt, iv, tag, ciphertext]),
    contentType: "application/octet-stream",
  };
}

export function decryptUploadPayloadIfNeeded(
  target: RuntimeBackupCloudTarget,
  payload: UploadPayload,
): UploadPayload {
  const input = Buffer.from(payload.bytes);
  const hasMagic =
    input.byteLength >
      ENCRYPTION_MAGIC.byteLength + SALT_LENGTH + IV_LENGTH + TAG_LENGTH + 4 &&
    input.subarray(0, ENCRYPTION_MAGIC.byteLength).equals(ENCRYPTION_MAGIC);

  if (!hasMagic) {
    return payload;
  }

  const passphrase = target.secrets.encryptionpassphrase?.trim() ?? "";
  if (!passphrase) {
    throw new Error("Impossible de déchiffrer: passphrase absente sur la cible cloud.");
  }

  const saltStart = ENCRYPTION_MAGIC.byteLength;
  const ivStart = saltStart + SALT_LENGTH;
  const tagStart = ivStart + IV_LENGTH;
  const cipherStart = tagStart + TAG_LENGTH;

  const salt = input.subarray(saltStart, ivStart);
  const iv = input.subarray(ivStart, tagStart);
  const tag = input.subarray(tagStart, cipherStart);
  const ciphertext = input.subarray(cipherStart);
  const key = scryptSync(passphrase, salt, 32);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

  if (plaintext.byteLength < 4) {
    throw new Error("Payload chiffré invalide.");
  }

  const metadataLength = plaintext.readUInt32BE(0);
  const metadataStart = 4;
  const metadataEnd = metadataStart + metadataLength;
  if (metadataEnd > plaintext.byteLength) {
    throw new Error("Métadonnées chiffrées invalides.");
  }

  let metadata: { filename?: unknown; contentType?: unknown } | null = null;
  try {
    metadata = JSON.parse(plaintext.subarray(metadataStart, metadataEnd).toString("utf8")) as {
      filename?: unknown;
      contentType?: unknown;
    };
  } catch {
    throw new Error("Métadonnées de chiffrement illisibles.");
  }

  const filename =
    typeof metadata?.filename === "string" && metadata.filename.trim()
      ? metadata.filename.trim()
      : payload.filename.replace(/\.pxenc$/i, "");
  const contentType =
    typeof metadata?.contentType === "string" && metadata.contentType.trim()
      ? metadata.contentType.trim()
      : "application/octet-stream";

  return {
    filename,
    bytes: plaintext.subarray(metadataEnd),
    contentType,
  };
}
