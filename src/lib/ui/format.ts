export function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0 B";

  const units = ["B", "KB", "MB", "GB", "TB"];
  let current = value;
  let unitIndex = 0;

  while (current >= 1024 && unitIndex < units.length - 1) {
    current /= 1024;
    unitIndex += 1;
  }

  const precision = current >= 10 || unitIndex === 0 ? 0 : 1;
  return `${current.toFixed(precision)} ${units[unitIndex]}`;
}

export function formatPercent(ratio: number) {
  const safe = Number.isFinite(ratio) ? Math.max(0, Math.min(ratio, 1)) : 0;
  return `${Math.round(safe * 100)}%`;
}

export function formatUptime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0m";

  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);

  if (d > 0) return `${d}j ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function formatRelativeTime(isoDate: string) {
  const date = new Date(isoDate);
  const deltaMs = Date.now() - date.getTime();

  if (!Number.isFinite(deltaMs)) return isoDate;

  const sec = Math.round(deltaMs / 1000);
  if (Math.abs(sec) < 5) return "à l'instant";
  if (Math.abs(sec) < 60) return `il y a ${sec}s`;

  const min = Math.round(sec / 60);
  if (Math.abs(min) < 60) return `il y a ${min}min`;

  const hr = Math.round(min / 60);
  if (Math.abs(hr) < 24) return `il y a ${hr}h`;

  const day = Math.round(hr / 24);
  return `il y a ${day}j`;
}
