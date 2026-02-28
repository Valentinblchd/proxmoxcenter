import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getStorageDetail } from "@/lib/proxmox/storages";
import { formatBytes } from "@/lib/ui/format";

export const dynamic = "force-dynamic";

type StoragePageProps = {
  params:
    | Promise<{ node: string; name: string }>
    | { node: string; name: string };
};

async function readParams(value: StoragePageProps["params"]) {
  if (typeof (value as Promise<{ node: string; name: string }>).then === "function") {
    return await (value as Promise<{ node: string; name: string }>);
  }
  return value as { node: string; name: string };
}

function buildStorageHref(node: string, storage: string) {
  return `/inventory/storage/${encodeURIComponent(node)}/${encodeURIComponent(storage)}`;
}

export async function generateMetadata({ params }: StoragePageProps): Promise<Metadata> {
  const resolved = await readParams(params);
  return {
    title: `Storage ${decodeURIComponent(resolved.name)} | ProxCenter`,
  };
}

export default async function InventoryStorageDetailPage({ params }: StoragePageProps) {
  const resolved = await readParams(params);
  const nodeName = decodeURIComponent(resolved.node);
  const storageName = decodeURIComponent(resolved.name);

  if (!nodeName || !storageName) notFound();

  let detail = null;
  try {
    detail = await getStorageDetail({ node: nodeName, storage: storageName });
  } catch {
    detail = null;
  }

  if (!detail) {
    return (
      <section className="content workload-page">
        <header className="topbar">
          <div className="workload-header-copy">
            <Link href={`/inventory/node/${encodeURIComponent(nodeName)}`} className="action-btn workload-back-btn">
              ← Retour
            </Link>
            <nav className="inventory-breadcrumb" aria-label="Fil d’Ariane">
              <Link href="/inventory">Inventaire</Link>
              <span>›</span>
              <Link href={`/inventory?node=${encodeURIComponent(nodeName)}`}>Filtre {nodeName}</Link>
              <span>›</span>
              <span>Storage introuvable</span>
            </nav>
            <h1>Stockage indisponible</h1>
          </div>
          <div className="topbar-meta">
            <span className="pill">Introuvable</span>
          </div>
        </header>
      </section>
    );
  }

  return (
    <section className="content content-wide workload-page">
      <header className="topbar">
        <div className="workload-header-copy">
          <Link href={`/inventory/node/${encodeURIComponent(detail.node)}`} className="action-btn workload-back-btn">
            ← Retour
          </Link>
          <nav className="inventory-breadcrumb" aria-label="Fil d’Ariane">
            <Link href="/inventory">Inventaire</Link>
            <span>›</span>
            <Link href={`/inventory?node=${encodeURIComponent(detail.node)}`}>Filtre {detail.node}</Link>
            <span>›</span>
            <Link href={`/inventory/node/${encodeURIComponent(detail.node)}`}>{detail.node}</Link>
            <span>›</span>
            <span>{detail.storage}</span>
          </nav>
          <h1>{detail.storage}</h1>
        </div>
        <div className="topbar-meta">
          {detail.navigation.previous ? (
            <Link
              href={buildStorageHref(detail.navigation.previous.node, detail.navigation.previous.storage)}
              className="action-btn"
            >
              ← {detail.navigation.previous.storage}
            </Link>
          ) : (
            <span className="pill">Début</span>
          )}
          {detail.navigation.next ? (
            <Link
              href={buildStorageHref(detail.navigation.next.node, detail.navigation.next.storage)}
              className="action-btn"
            >
              {detail.navigation.next.storage} →
            </Link>
          ) : (
            <span className="pill">Fin</span>
          )}
          <span className={`inventory-badge status-${detail.status === "available" ? "running" : "stopped"}`}>
            STORAGE • {detail.status}
          </span>
        </div>
      </header>

      <section className="panel workload-hero">
        <div className="workload-hero-copy">
          <div className="row-line">
            <span>Nœud</span>
            <strong>{detail.node}</strong>
          </div>
          <div className="row-line">
            <span>Contenus</span>
            <strong>{detail.content ?? "—"}</strong>
          </div>
          <div className="row-line">
            <span>Entrées</span>
            <strong>{detail.contentEntries.length}</strong>
          </div>
          <div className="row-line">
            <span>Shared</span>
            <strong>{detail.shared ? "Oui" : "Non"}</strong>
          </div>
        </div>

        <div className="workload-hero-stats">
          <div className="inventory-metric-card">
            <span className="muted">Utilisé</span>
            <strong>{formatBytes(detail.usedBytes)}</strong>
          </div>
          <div className="inventory-metric-card">
            <span className="muted">Capacité</span>
            <strong>{formatBytes(detail.totalBytes)}</strong>
          </div>
          <div className="inventory-metric-card">
            <span className="muted">Libre</span>
            <strong>{formatBytes(detail.freeBytes)}</strong>
          </div>
          <div className="inventory-metric-card">
            <span className="muted">Type</span>
            <strong>{detail.status}</strong>
          </div>
        </div>

        <div className="workload-hero-actions">
          <Link href={`/inventory?node=${encodeURIComponent(detail.node)}`} className="action-btn">
            Inventaire filtré
          </Link>
          <Link href={`/inventory/node/${encodeURIComponent(detail.node)}`} className="action-btn">
            Voir le nœud
          </Link>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>Contenu du stockage</h2>
          <span className="muted">{detail.contentEntries.length}</span>
        </div>
        {detail.contentEntries.length === 0 ? (
          <p className="muted">Aucune entrée remontée pour ce stockage.</p>
        ) : (
          <div className="mini-list">
            {detail.contentEntries.map((entry) => (
              <article key={entry.id} className="mini-list-item">
                <div>
                  <div className="item-title">{entry.volid}</div>
                  <div className="item-subtitle">
                    {[entry.content, entry.format, entry.vmid !== null ? `VMID ${entry.vmid}` : null, entry.notes]
                      .filter(Boolean)
                      .join(" • ") || "—"}
                  </div>
                </div>
                <div className="item-metric">
                  {entry.size > 0 ? formatBytes(entry.size) : entry.createdAt ? new Date(entry.createdAt).toLocaleDateString("fr-FR") : "—"}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </section>
  );
}
