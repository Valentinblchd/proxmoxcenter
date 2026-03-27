"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ACCOUNT_MENU_SECTION,
  filterNavSectionsForRole,
  MAIN_MENU_SECTIONS,
} from "@/lib/navigation/menu";
import type { RuntimeAuthUserRole } from "@/lib/auth/rbac";
import { readRecentViews, subscribeRecentViews } from "@/lib/ui/recent-views";

type CommandPaletteProps = {
  sessionRole: RuntimeAuthUserRole | null;
};

type CommandItem = {
  id: string;
  label: string;
  href: string;
  hint?: string;
};

const QUICK_SHORTCUTS = [
  { key: "1", href: "/", label: "Accueil" },
  { key: "2", href: "/inventory", label: "Inventaire" },
  { key: "3", href: "/provision", label: "Création" },
  { key: "4", href: "/observability", label: "Observabilité" },
  { key: "5", href: "/backups", label: "Sauvegardes" },
  { key: "6", href: "/security", label: "Sécurité" },
  { key: "7", href: "/settings", label: "Paramètres" },
] as const;

function isTypingContext(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  const tagName = target.tagName.toLowerCase();
  return tagName === "input" || tagName === "textarea" || tagName === "select" || target.isContentEditable;
}

export default function CommandPalette({ sessionRole }: CommandPaletteProps) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [recentViews, setRecentViews] = useState(() => readRecentViews().slice(0, 5));

  const navItems = useMemo(() => {
    const visibleSections = filterNavSectionsForRole(
      [...MAIN_MENU_SECTIONS, ACCOUNT_MENU_SECTION],
      sessionRole,
    );
    return visibleSections.flatMap((section) =>
      section.items.map((item) => ({
        id: `nav-${item.id}`,
        label: item.label,
        href: item.href,
        hint: section.title,
      })),
    );
  }, [sessionRole]);

  const mergedItems = useMemo<CommandItem[]>(() => {
    const recentItems = recentViews.map((entry, index) => ({
      id: `recent-${index}`,
      label: entry.title,
      href: entry.href,
      hint: "Récent",
    }));
    const existingHrefs = new Set(recentItems.map((item) => item.href));
    return [...recentItems, ...navItems.filter((item) => !existingHrefs.has(item.href))];
  }, [navItems, recentViews]);

  const filteredItems = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) return mergedItems.slice(0, 12);
    return mergedItems.filter((item) => {
      const haystack = `${item.label} ${item.href} ${item.hint ?? ""}`.toLowerCase();
      return haystack.includes(trimmed);
    });
  }, [mergedItems, query]);

  useEffect(() => {
    const sync = () => setRecentViews(readRecentViews().slice(0, 5));
    return subscribeRecentViews(sync);
  }, []);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => inputRef.current?.focus(), 10);
    return () => window.clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((current) => !current);
        return;
      }

      if (!isTypingContext(event.target) && event.altKey) {
        const shortcut = QUICK_SHORTCUTS.find((item) => item.key === event.key);
        if (shortcut) {
          event.preventDefault();
          router.push(shortcut.href);
        }
      }

      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [router]);

  function navigateTo(href: string) {
    setOpen(false);
    setQuery("");
    router.push(href);
  }

  return (
    <>
      <button
        type="button"
        className="command-palette-trigger"
        onClick={() => setOpen(true)}
        aria-label="Ouvrir la palette de commandes"
        title="Palette de commandes (Ctrl/Cmd + K)"
      >
        Rechercher
        <span className="command-palette-shortcut">Ctrl/Cmd + K</span>
      </button>

      {open ? (
        <div className="command-palette-layer" role="presentation">
          <button
            type="button"
            className="command-palette-backdrop"
            aria-label="Fermer la palette"
            onClick={() => setOpen(false)}
          />
          <section
            className="command-palette-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="Palette de commandes"
          >
            <div className="command-palette-head">
              <input
                ref={inputRef}
                type="search"
                className="command-palette-input"
                placeholder="Accueil, inventaire, sauvegardes, observabilité..."
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                aria-label="Rechercher une commande"
              />
              <button type="button" className="action-btn" onClick={() => setOpen(false)}>
                Fermer
              </button>
            </div>

            <div className="command-palette-hints">
              {QUICK_SHORTCUTS.filter((item) => item.href !== "/settings" || sessionRole === "admin").map((shortcut) => (
                <span key={shortcut.key} className="pill">
                  Alt + {shortcut.key} • {shortcut.label}
                </span>
              ))}
            </div>

            <div className="command-palette-results">
              {filteredItems.length === 0 ? (
                <p className="muted">Aucun résultat pour cette recherche.</p>
              ) : (
                filteredItems.map((item) => (
                  <button
                    key={`${item.id}-${item.href}`}
                    type="button"
                    className="command-palette-item"
                    onClick={() => navigateTo(item.href)}
                  >
                    <div>
                      <div className="item-title">{item.label}</div>
                      <div className="item-subtitle">{item.hint ? `${item.hint} • ${item.href}` : item.href}</div>
                    </div>
                    <span className="inventory-badge">Ouvrir</span>
                  </button>
                ))
              )}
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
