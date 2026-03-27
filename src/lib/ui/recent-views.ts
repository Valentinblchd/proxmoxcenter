export type RecentViewEntry = {
  href: string;
  title: string;
  visitedAt: string;
};

const RECENT_VIEWS_STORAGE_KEY = "proxcenter_recent_views";
const RECENT_VIEWS_UPDATED_EVENT = "proxcenter:recent-views-updated";
const MAX_RECENT_VIEWS = 10;

function canUseStorage() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

export function readRecentViews(): RecentViewEntry[] {
  if (!canUseStorage()) return [];
  try {
    const raw = window.localStorage.getItem(RECENT_VIEWS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is RecentViewEntry => {
      if (!entry || typeof entry !== "object") return false;
      const candidate = entry as Record<string, unknown>;
      return (
        typeof candidate.href === "string" &&
        typeof candidate.title === "string" &&
        typeof candidate.visitedAt === "string"
      );
    });
  } catch {
    return [];
  }
}

export function rememberRecentView(entry: Omit<RecentViewEntry, "visitedAt">) {
  if (!canUseStorage()) return;
  const nextEntry: RecentViewEntry = {
    ...entry,
    visitedAt: new Date().toISOString(),
  };
  const current = readRecentViews().filter((item) => item.href !== entry.href);
  const next = [nextEntry, ...current].slice(0, MAX_RECENT_VIEWS);
  try {
    window.localStorage.setItem(RECENT_VIEWS_STORAGE_KEY, JSON.stringify(next));
    window.dispatchEvent(new CustomEvent(RECENT_VIEWS_UPDATED_EVENT));
  } catch {
    // Ignore storage failures.
  }
}

export function subscribeRecentViews(onChange: () => void) {
  if (typeof window === "undefined") return () => {};
  const handler = () => onChange();
  window.addEventListener(RECENT_VIEWS_UPDATED_EVENT, handler);
  return () => window.removeEventListener(RECENT_VIEWS_UPDATED_EVENT, handler);
}
