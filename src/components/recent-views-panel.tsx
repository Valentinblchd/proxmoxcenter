"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { readRecentViews, subscribeRecentViews, type RecentViewEntry } from "@/lib/ui/recent-views";

export default function RecentViewsPanel() {
  const [entries, setEntries] = useState<RecentViewEntry[]>([]);

  useEffect(() => {
    const sync = () => setEntries(readRecentViews().slice(0, 6));
    sync();
    return subscribeRecentViews(sync);
  }, []);

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Récemment consulté</h2>
        <span className="muted">{entries.length}</span>
      </div>

      {entries.length === 0 ? (
        <p className="muted">Les dernières pages ouvertes apparaîtront ici pour reprendre plus vite.</p>
      ) : (
        <div className="mini-list">
          {entries.map((entry) => (
            <Link key={`${entry.href}-${entry.visitedAt}`} href={entry.href} className="mini-list-item mini-list-link">
              <div>
                <div className="item-title">{entry.title}</div>
                <div className="item-subtitle">{entry.href}</div>
              </div>
              <div className="item-metric">
                {new Date(entry.visitedAt).toLocaleTimeString("fr-FR", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </div>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
