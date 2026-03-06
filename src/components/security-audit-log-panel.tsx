"use client";

import { useMemo, useState } from "react";

type AuditLogEntry = {
  id: string;
  at: string;
  severity: "info" | "warning" | "error";
  category: "auth" | "security" | "settings" | "workload" | "backup" | "observability";
  action: string;
  summary: string;
  actor: {
    username: string;
    role: string;
    authMethod: "local" | "ldap";
    userId: string | null;
  };
  targetType: string;
  targetId: string | null;
  targetLabel: string | null;
  changes: Array<{
    field: string;
    before: string | null;
    after: string | null;
  }>;
  details: Record<string, string>;
};

type Props = {
  entries: AuditLogEntry[];
};

type SortMode = "newest" | "oldest" | "actor" | "category";

function formatWhen(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function severityBadgeClass(severity: AuditLogEntry["severity"]) {
  if (severity === "error") return "status-stopped";
  if (severity === "warning") return "status-pending";
  return "status-running";
}

function categoryLabel(category: AuditLogEntry["category"]) {
  switch (category) {
    case "auth":
      return "Connexion";
    case "security":
      return "Sécurité";
    case "settings":
      return "Réglage";
    case "workload":
      return "Workload";
    case "backup":
      return "Sauvegarde";
    case "observability":
      return "Observabilité";
    default:
      return category;
  }
}

export default function SecurityAuditLogPanel({ entries }: Props) {
  const [sortMode, setSortMode] = useState<SortMode>("newest");
  const [filter, setFilter] = useState("");

  const visibleEntries = useMemo(() => {
    const normalizedFilter = filter.trim().toLowerCase();
    const filtered = normalizedFilter
      ? entries.filter((entry) => {
          const haystack = [
            entry.summary,
            entry.action,
            entry.actor.username,
            entry.actor.role,
            entry.targetType,
            entry.targetId ?? "",
            entry.targetLabel ?? "",
            entry.category,
            ...entry.changes.flatMap((change) => [change.field, change.before ?? "", change.after ?? ""]),
            ...Object.entries(entry.details).flatMap(([key, value]) => [key, value]),
          ]
            .join(" ")
            .toLowerCase();
          return haystack.includes(normalizedFilter);
        })
      : entries;

    const sorted = [...filtered];
    if (sortMode === "oldest") {
      sorted.sort((left, right) => Date.parse(left.at) - Date.parse(right.at));
    } else if (sortMode === "actor") {
      sorted.sort((left, right) => {
        const byActor = left.actor.username.localeCompare(right.actor.username);
        if (byActor !== 0) return byActor;
        return Date.parse(right.at) - Date.parse(left.at);
      });
    } else if (sortMode === "category") {
      sorted.sort((left, right) => {
        const byCategory = left.category.localeCompare(right.category);
        if (byCategory !== 0) return byCategory;
        return Date.parse(right.at) - Date.parse(left.at);
      });
    } else {
      sorted.sort((left, right) => Date.parse(right.at) - Date.parse(left.at));
    }

    return sorted;
  }, [entries, filter, sortMode]);

  return (
    <section className="stack-sm">
      <div className="provision-grid">
        <label className="provision-field">
          <span className="provision-field-label">Filtrer</span>
          <input
            className="provision-input"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Utilisateur, action, VM, réglage..."
          />
        </label>
        <label className="provision-field">
          <span className="provision-field-label">Tri</span>
          <select
            className="provision-input"
            value={sortMode}
            onChange={(event) => setSortMode(event.target.value as SortMode)}
          >
            <option value="newest">Plus récent</option>
            <option value="oldest">Plus ancien</option>
            <option value="actor">Utilisateur</option>
            <option value="category">Catégorie</option>
          </select>
        </label>
      </div>

      {visibleEntries.length === 0 ? (
        <p className="muted">Aucun événement pour ce filtre.</p>
      ) : (
        <div className="mini-list">
          {visibleEntries.map((entry) => (
            <article key={entry.id} className="mini-list-item">
              <div>
                <div className="item-title">
                  {entry.summary}
                  <span className={`inventory-badge ${severityBadgeClass(entry.severity)}`}>
                    {categoryLabel(entry.category)}
                  </span>
                </div>
                <div className="item-subtitle">
                  {entry.actor.username} ({entry.actor.authMethod}) • {entry.targetLabel ?? entry.targetType}
                  {entry.targetId ? ` • ${entry.targetId}` : ""}
                </div>
                {entry.changes.length > 0 ? (
                  <div className="backup-target-meta">
                    {entry.changes.slice(0, 6).map((change) => (
                      <span key={`${entry.id}-${change.field}`} className="inventory-tag">
                        {change.field}: {change.before ?? "—"} → {change.after ?? "—"}
                      </span>
                    ))}
                  </div>
                ) : null}
                {Object.keys(entry.details).length > 0 ? (
                  <div className="backup-target-meta">
                    {Object.entries(entry.details)
                      .slice(0, 6)
                      .map(([key, value]) => (
                        <span key={`${entry.id}-${key}`} className="inventory-tag">
                          {key}: {value}
                        </span>
                      ))}
                  </div>
                ) : null}
              </div>
              <div className="item-metric">{formatWhen(entry.at)}</div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
