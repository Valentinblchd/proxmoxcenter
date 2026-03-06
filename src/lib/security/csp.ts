export const CSP_NONCE_HEADER = "x-proxcenter-csp-nonce";

function asNonce(value: string | null | undefined) {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return /^[A-Za-z0-9_-]{16,180}$/.test(trimmed) ? trimmed : null;
}

export function createCspNonce() {
  return crypto.randomUUID().replace(/-/g, "");
}

export function readCspNonce(value: string | null | undefined) {
  return asNonce(value);
}

export function buildContentSecurityPolicy(nonce: string) {
  const safeNonce = asNonce(nonce);
  const scriptSource = safeNonce ? `'self' 'nonce-${safeNonce}'` : "'self'";
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    "style-src 'self' 'unsafe-inline'",
    `script-src ${scriptSource}`,
    "connect-src 'self' https: wss:",
    "media-src 'self' data: blob:",
  ].join("; ");
}
