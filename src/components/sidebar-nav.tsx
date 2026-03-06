"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import BrandLogo from "@/components/brand-logo";
import {
  ACCOUNT_MENU_SECTION,
  filterNavSectionsForRole,
  MAIN_MENU_SECTIONS,
  NavItem,
  NavSection,
} from "@/lib/navigation/menu";
import type { RuntimeAuthUserRole } from "@/lib/auth/rbac";

const SIDEBAR_EXPANDED_STORAGE_KEY = "proxcenter_sidebar_expanded";
const SIDEBAR_SECTIONS_STORAGE_KEY = "proxcenter_sidebar_sections";
const HOVER_EXPAND_DELAY_MS = 1200;

function MenuIcon({ itemId }: { itemId: string }) {
  const commonProps = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.9,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };

  switch (itemId) {
    case "dashboard":
      return (
        <svg {...commonProps}>
          <rect x="3" y="3" width="8" height="8" rx="1.5" />
          <rect x="13" y="3" width="8" height="5" rx="1.5" />
          <rect x="13" y="10" width="8" height="11" rx="1.5" />
          <rect x="3" y="13" width="8" height="8" rx="1.5" />
        </svg>
      );
    case "inventory":
      return (
        <svg {...commonProps}>
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <path d="M3 10h18" />
          <path d="M9 10V5" />
        </svg>
      );
    case "assistant":
      return (
        <svg {...commonProps}>
          <path d="M12 3l1.8 3.8L18 8.5l-3 2.9.7 4.1-3.7-2-3.7 2 .7-4.1-3-2.9 4.2-1.7L12 3z" />
        </svg>
      );
    case "provision":
      return (
        <svg {...commonProps}>
          <rect x="4" y="4" width="16" height="16" rx="2" />
          <path d="M12 8v8M8 12h8" />
        </svg>
      );
    case "observability":
      return (
        <svg {...commonProps}>
          <circle cx="12" cy="12" r="8" />
          <path d="M12 12L16.5 9" />
          <path d="M12 12v5" />
        </svg>
      );
    case "operations":
      return (
        <svg {...commonProps}>
          <path d="M4 6h16" />
          <path d="M4 12h16" />
          <path d="M4 18h16" />
        </svg>
      );
    case "console":
      return (
        <svg {...commonProps}>
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <path d="M7 10l3 2-3 2" />
          <path d="M12 15h5" />
        </svg>
      );
    case "nodes":
      return (
        <svg {...commonProps}>
          <rect x="4" y="4" width="6" height="6" rx="1.2" />
          <rect x="14" y="4" width="6" height="6" rx="1.2" />
          <rect x="9" y="14" width="6" height="6" rx="1.2" />
          <path d="M10 7h4M12 10v4" />
        </svg>
      );
    case "network":
      return (
        <svg {...commonProps}>
          <circle cx="6" cy="12" r="2.5" />
          <circle cx="18" cy="6" r="2.5" />
          <circle cx="18" cy="18" r="2.5" />
          <path d="M8.3 11l7.4-3.8M8.3 13l7.4 3.8" />
        </svg>
      );
    case "storage":
      return (
        <svg {...commonProps}>
          <ellipse cx="12" cy="6.5" rx="7" ry="3" />
          <path d="M5 6.5v11c0 1.7 3.1 3 7 3s7-1.3 7-3v-11" />
          <path d="M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3" />
        </svg>
      );
    case "templates":
      return (
        <svg {...commonProps}>
          <rect x="4" y="4" width="7" height="7" rx="1.2" />
          <rect x="13" y="4" width="7" height="7" rx="1.2" />
          <rect x="4" y="13" width="7" height="7" rx="1.2" />
          <rect x="13" y="13" width="7" height="7" rx="1.2" />
        </svg>
      );
    case "backups":
      return (
        <svg {...commonProps}>
          <path d="M12 3v10" />
          <path d="M8 9l4 4 4-4" />
          <rect x="4" y="15" width="16" height="6" rx="1.4" />
        </svg>
      );
    case "security":
      return (
        <svg {...commonProps}>
          <path d="M12 3l7 3v5c0 5-3.4 8.4-7 10-3.6-1.6-7-5-7-10V6l7-3z" />
          <path d="M9.3 12.2l1.9 1.9 3.5-3.5" />
        </svg>
      );
    case "resources":
      return (
        <svg {...commonProps}>
          <path d="M12 3v18" />
          <path d="M3 12h18" />
          <circle cx="12" cy="12" r="7.2" />
        </svg>
      );
    case "settings":
      return (
        <svg {...commonProps}>
          <circle cx="12" cy="12" r="3" />
          <path d="M19 12a7 7 0 00.1-1l2-1.2-2-3.5-2.3.6a7.4 7.4 0 00-1.7-1L14.7 3h-5.4l-.4 2.9a7.4 7.4 0 00-1.7 1l-2.3-.6-2 3.5L4.9 11a7 7 0 000 2L2.9 14.2l2 3.5 2.3-.6a7.4 7.4 0 001.7 1l.4 2.9h5.4l.4-2.9a7.4 7.4 0 001.7-1l2.3.6 2-3.5-2-1.2c.1-.3.1-.6.1-1z" />
        </svg>
      );
    case "logout":
      return (
        <svg {...commonProps}>
          <path d="M10 4H5a2 2 0 00-2 2v12a2 2 0 002 2h5" />
          <path d="M14 16l5-4-5-4" />
          <path d="M19 12H9" />
        </svg>
      );
    default:
      return (
        <svg {...commonProps}>
          <circle cx="12" cy="12" r="7" />
        </svg>
      );
  }
}

function isActivePath(pathname: string, href: string) {
  const cleanHref = href.split("?")[0] || href;

  if (cleanHref === "/") {
    return pathname === "/";
  }

  return pathname === cleanHref || pathname.startsWith(`${cleanHref}/`);
}

function parseHrefParts(href: string) {
  const [pathPart, queryPart] = href.split("?", 2);
  return {
    path: pathPart || "/",
    query: new URLSearchParams(queryPart || ""),
  };
}

function matchesHrefQuery(
  href: string,
  searchParams: ReturnType<typeof useSearchParams>,
) {
  const entries = Array.from(parseHrefParts(href).query.entries());
  if (entries.length === 0) return true;
  return entries.every(([key, value]) => searchParams.get(key) === value);
}

function hasMatchingQueryShortcutForPath(
  href: string,
  items: NavItem[],
  searchParams: ReturnType<typeof useSearchParams>,
) {
  const { path } = parseHrefParts(href);
  return items
    .filter((item) => item.href.includes("?"))
    .some((item) => parseHrefParts(item.href).path === path && matchesHrefQuery(item.href, searchParams));
}

function MenuLinkWithClose({
  item,
  showLabel,
  allItems,
  onNavigate,
}: {
  item: NavItem;
  showLabel: boolean;
  allItems: NavItem[];
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const pathMatches = isActivePath(pathname, item.href);
  const hasQuery = Array.from(parseHrefParts(item.href).query.entries()).length > 0;
  let active = false;

  if (pathMatches) {
    if (hasQuery) {
      active = matchesHrefQuery(item.href, searchParams);
    } else {
      active = !hasMatchingQueryShortcutForPath(item.href, allItems, searchParams);
    }
  }

  return (
    <Link
      href={item.href}
      className={`menu-btn${active ? " is-active" : ""}`}
      title={item.label}
      aria-label={item.label}
      aria-current={active ? "page" : undefined}
      onClick={onNavigate}
    >
      <span className="menu-glyph" aria-hidden="true">
        <MenuIcon itemId={item.id} />
      </span>
      <span className="menu-label" aria-hidden={!showLabel}>
        {item.label}
      </span>
    </Link>
  );
}

function getDefaultSectionOpenState(sections: NavSection[]) {
  return Object.fromEntries(
    sections.map((section) => [section.id, section.defaultOpen ?? true]),
  ) as Record<string, boolean>;
}

function SectionBlock({
  section,
  expanded,
  open,
  allItems,
  onToggle,
  onNavigate,
}: {
  section: NavSection;
  expanded: boolean;
  open: boolean;
  allItems: NavItem[];
  onToggle: (sectionId: string) => void;
  onNavigate?: () => void;
}) {
  if (!expanded) {
    return (
      <div className="menu-group" data-section-id={section.id}>
        {section.items.map((item) => (
          <MenuLinkWithClose
            key={item.id}
            item={item}
            showLabel={false}
            allItems={allItems}
            onNavigate={onNavigate}
          />
        ))}
      </div>
    );
  }

  return (
    <section
      className={`menu-section${open ? " is-open" : " is-collapsed"}`}
      data-section-id={section.id}
    >
      <div className="menu-section-head">
        <span className="menu-section-title">{section.title}</span>
        {section.collapsible ? (
          <button
            type="button"
            className="menu-section-toggle"
            onClick={() => onToggle(section.id)}
            aria-expanded={open}
            aria-controls={`menu-section-panel-${section.id}`}
            title={open ? `Réduire ${section.title}` : `Afficher ${section.title}`}
          >
            <span aria-hidden="true">{open ? "▾" : "▸"}</span>
          </button>
        ) : null}
      </div>

      <div
        id={`menu-section-panel-${section.id}`}
        className={`menu-section-items${open ? "" : " is-collapsed"}`}
      >
        {section.items.map((item) => (
          <MenuLinkWithClose
            key={item.id}
            item={item}
            showLabel
            allItems={allItems}
            onNavigate={onNavigate}
          />
        ))}
      </div>
    </section>
  );
}

export default function SidebarNav({
  sessionRole,
  mobileOpen = false,
  onRequestClose,
  onRequestToggle,
}: {
  sessionRole: RuntimeAuthUserRole | null;
  mobileOpen?: boolean;
  onRequestClose?: () => void;
  onRequestToggle?: () => void;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const visibleMainSections = useMemo(
    () => filterNavSectionsForRole(MAIN_MENU_SECTIONS, sessionRole),
    [sessionRole],
  );
  const visibleAccountSection = useMemo(
    () => filterNavSectionsForRole([ACCOUNT_MENU_SECTION], sessionRole)[0] ?? null,
    [sessionRole],
  );
  const visibleSections = useMemo(
    () => [...visibleMainSections, ...(visibleAccountSection ? [visibleAccountSection] : [])],
    [visibleAccountSection, visibleMainSections],
  );
  const [isExpanded, setIsExpanded] = useState(false);
  const [hoverExpanded, setHoverExpanded] = useState(false);
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false);
  const [prefLoaded, setPrefLoaded] = useState(false);
  const [sectionOpenState, setSectionOpenState] = useState<Record<string, boolean>>(
    () => getDefaultSectionOpenState(visibleSections),
  );
  const logoutFormRef = useRef<HTMLFormElement | null>(null);
  const hoverTimerRef = useRef<number | null>(null);
  const sidebarExpanded = isExpanded || hoverExpanded;
  const allItems = visibleSections.flatMap((section) => section.items);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(SIDEBAR_EXPANDED_STORAGE_KEY);
      if (stored === "1") {
        setIsExpanded(true);
      }

      const storedSections = window.localStorage.getItem(SIDEBAR_SECTIONS_STORAGE_KEY);
      if (storedSections) {
        const parsed = JSON.parse(storedSections) as Record<string, unknown>;
        setSectionOpenState((current) => {
          const next = { ...current };
          for (const section of visibleSections) {
            if (typeof parsed?.[section.id] === "boolean") {
              next[section.id] = parsed[section.id] as boolean;
            }
          }
          return next;
        });
      }
    } catch {
      // Ignore storage access failures.
    } finally {
      setPrefLoaded(true);
    }
  }, [visibleSections]);

  useEffect(() => {
    if (!prefLoaded) return;

    try {
      window.localStorage.setItem(
        SIDEBAR_EXPANDED_STORAGE_KEY,
        isExpanded ? "1" : "0",
      );
      window.localStorage.setItem(
        SIDEBAR_SECTIONS_STORAGE_KEY,
        JSON.stringify(sectionOpenState),
      );
    } catch {
      // Ignore storage access failures.
    }
  }, [isExpanded, prefLoaded, sectionOpenState]);

  useEffect(() => {
    if (!logoutConfirmOpen) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setLogoutConfirmOpen(false);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [logoutConfirmOpen]);

  useEffect(
    () => () => {
      if (hoverTimerRef.current !== null) {
        window.clearTimeout(hoverTimerRef.current);
      }
    },
    [],
  );

  const toggleLabel = sidebarExpanded ? "Réduire le menu" : "Agrandir le menu";

  function toggleSection(sectionId: string) {
    setSectionOpenState((current) => ({
      ...current,
      [sectionId]: !current[sectionId],
    }));
  }

  function isSectionOpen(section: NavSection) {
    if (!section.collapsible) return true;
    const hasActiveItem = section.items.some((item) => {
      const pathMatches = isActivePath(pathname, item.href);
      if (!pathMatches) return false;

      const hasQuery = Array.from(parseHrefParts(item.href).query.entries()).length > 0;
      if (hasQuery) {
        return matchesHrefQuery(item.href, searchParams);
      }
      return !hasMatchingQueryShortcutForPath(item.href, allItems, searchParams);
    });
    if (hasActiveItem) return true;
    return sectionOpenState[section.id] ?? (section.defaultOpen ?? true);
  }

  function handleNavigate() {
    if (typeof window === "undefined") return;
    if (!window.matchMedia("(max-width: 779px)").matches) return;
    onRequestClose?.();
  }

  function canUseHoverExpand() {
    if (typeof window === "undefined") return false;
    return window.matchMedia("(min-width: 780px) and (hover: hover) and (pointer: fine)").matches;
  }

  function handleSidebarMouseEnter() {
    if (isExpanded) return;
    if (!canUseHoverExpand()) return;
    if (hoverTimerRef.current !== null) {
      window.clearTimeout(hoverTimerRef.current);
    }
    hoverTimerRef.current = window.setTimeout(() => {
      setHoverExpanded(true);
      hoverTimerRef.current = null;
    }, HOVER_EXPAND_DELAY_MS);
  }

  function handleSidebarMouseLeave() {
    if (hoverTimerRef.current !== null) {
      window.clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
    setHoverExpanded(false);
  }

  function openLogoutConfirm() {
    setLogoutConfirmOpen(true);
  }

  function closeLogoutConfirm() {
    setLogoutConfirmOpen(false);
  }

  function confirmLogout() {
    setLogoutConfirmOpen(false);
    handleNavigate();
    logoutFormRef.current?.requestSubmit();
  }

  return (
    <>
      <aside
        className={`sidebar${sidebarExpanded ? " is-expanded" : ""}${mobileOpen ? " is-mobile-open" : ""}`}
        onMouseEnter={handleSidebarMouseEnter}
        onMouseLeave={handleSidebarMouseLeave}
      >
        <div className="sidebar-top">
          <div className="sidebar-header-row">
            <Link
              href="/"
              className="brand sidebar-brand-link"
              title="ProxCenter - Accueil"
              aria-label="Accueil"
            >
              <span className="brand-logo-wrap" aria-hidden="true">
                <BrandLogo className="brand-logo" />
              </span>
              <span className="sidebar-brand-text">PROXCENTER</span>
            </Link>

            <button
              type="button"
              className="sidebar-toggle"
              aria-label={toggleLabel}
              title={toggleLabel}
              aria-pressed={isExpanded}
              onClick={() => setIsExpanded((current) => !current)}
            >
              <span className="sidebar-toggle-chevrons" aria-hidden="true">
                {sidebarExpanded ? "<<" : ">>"}
              </span>
            </button>
            <button
              type="button"
              className="sidebar-mobile-toggle"
              aria-label={mobileOpen ? "Fermer le menu mobile" : "Ouvrir le menu mobile"}
              title={mobileOpen ? "Fermer le menu" : "Ouvrir le menu"}
              aria-pressed={mobileOpen}
              onClick={onRequestToggle}
            >
              {mobileOpen ? "✕" : "☰"}
            </button>
          </div>

          <span className="brand-mini">{sidebarExpanded ? "Menu" : "PX"}</span>
        </div>

        <nav className="menu-rail" aria-label="Menu principal">
          {visibleMainSections.map((section, index, sections) => (
            <div key={section.id} className="menu-section-wrap">
              <SectionBlock
                section={section}
                expanded={sidebarExpanded}
                open={isSectionOpen(section)}
                allItems={allItems}
                onToggle={toggleSection}
                onNavigate={handleNavigate}
              />
              {index < sections.length - 1 ? <div className="menu-separator" /> : null}
            </div>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <div className="sidebar-bottom-divider" />

          {visibleAccountSection && sidebarExpanded ? (
            <SectionBlock
              section={visibleAccountSection}
              expanded={sidebarExpanded}
              open={isSectionOpen(visibleAccountSection)}
              allItems={allItems}
              onToggle={toggleSection}
              onNavigate={handleNavigate}
            />
          ) : null}

          {!sidebarExpanded ? <div className="menu-separator" /> : null}

          <form ref={logoutFormRef} method="post" action="/api/auth/logout" className="menu-form">
            <button
              type="button"
              className="menu-btn"
              title="Déconnexion"
              aria-label="Déconnexion"
              onClick={openLogoutConfirm}
            >
              <span className="menu-glyph" aria-hidden="true">
                <MenuIcon itemId="logout" />
              </span>
              <span className="menu-label" aria-hidden={!sidebarExpanded}>
                Déconnexion
              </span>
            </button>
          </form>
        </div>
      </aside>

      {logoutConfirmOpen ? (
        <div className="logout-confirm-layer" role="presentation">
          <button
            type="button"
            className="logout-confirm-backdrop"
            onClick={closeLogoutConfirm}
            aria-label="Fermer la confirmation de déconnexion"
          />
          <section
            className="logout-confirm-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="logout-confirm-title"
          >
            <h2 id="logout-confirm-title">Se déconnecter ?</h2>
            <p className="muted">
              Es-tu sûr de vouloir fermer la session en cours ?
            </p>
            <div className="logout-confirm-actions">
              <button type="button" className="action-btn" onClick={closeLogoutConfirm}>
                Non, annuler
              </button>
              <button type="button" className="action-btn primary" onClick={confirmLogout}>
                Oui, déconnexion
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
