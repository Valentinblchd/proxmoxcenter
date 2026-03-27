"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type SavedInventoryView = {
  href: string;
  label: string;
  savedAt: string;
};

const STORAGE_KEY = "proxcenter_inventory_saved_views";

function readSavedViews() {
  if (typeof window === "undefined") return [] as SavedInventoryView[];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is SavedInventoryView => {
      if (!entry || typeof entry !== "object") return false;
      const candidate = entry as Record<string, unknown>;
      return (
        typeof candidate.href === "string" &&
        typeof candidate.label === "string" &&
        typeof candidate.savedAt === "string"
      );
    });
  } catch {
    return [];
  }
}

export default function InventoryViewTools({
  currentHref,
  activeTab,
  query,
  nodeFilter,
}: {
  currentHref: string;
  activeTab: string;
  query: string;
  nodeFilter: string;
}) {
  const [savedViews, setSavedViews] = useState<SavedInventoryView[]>([]);
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setSavedViews(readSavedViews().slice(0, 5));
  }, []);

  const label = useMemo(() => {
    const parts = [];
    parts.push(activeTab === "summary" ? "Résumé" : activeTab);
    if (nodeFilter) parts.push(`nœud ${nodeFilter}`);
    if (query) parts.push(`recherche ${query}`);
    return parts.join(" • ");
  }, [activeTab, nodeFilter, query]);

  async function onCopyLink() {
    try {
      await navigator.clipboard.writeText(new URL(currentHref, window.location.origin).toString());
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  }

  function onSaveView() {
    const nextEntry: SavedInventoryView = {
      href: currentHref,
      label,
      savedAt: new Date().toISOString(),
    };
    const next = [nextEntry, ...readSavedViews().filter((entry) => entry.href !== currentHref)].slice(0, 8);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      setSavedViews(next.slice(0, 5));
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1400);
    } catch {
      setSaved(false);
    }
  }

  return (
    <div className="inventory-view-tools">
      <div className="inventory-view-tools-actions">
        <button type="button" className="action-btn" onClick={() => void onCopyLink()}>
          {copied ? "Lien copié" : "Copier la vue"}
        </button>
        <button type="button" className="action-btn" onClick={onSaveView}>
          {saved ? "Vue enregistrée" : "Enregistrer la vue"}
        </button>
      </div>

      {savedViews.length > 0 ? (
        <div className="inventory-view-tools-list">
          {savedViews.map((view) => (
            <Link key={`${view.href}-${view.savedAt}`} href={view.href} className="pill inventory-view-pill">
              {view.label}
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  );
}
