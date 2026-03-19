import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import InventoryRefreshButton from "@/components/inventory-refresh-button";
import InventoryRemoteAccess from "@/components/inventory-remote-access";
import InventoryUpdateStatus from "@/components/inventory-update-status";
import InventoryWorkloadConfigEditor from "@/components/inventory-workload-config-editor";
import InventoryWorkloadActions from "@/components/inventory-workload-actions";
import { AUTH_COOKIE_NAME, verifySessionToken } from "@/lib/auth/session";
import { hasRuntimeCapability } from "@/lib/auth/rbac";
import { getWorkloadDetailById, type WorkloadKind } from "@/lib/proxmox/workloads";
import { formatBytes, formatPercent, formatUptime } from "@/lib/ui/format";

export const dynamic = "force-dynamic";

type WorkloadPageProps = {
  params: Promise<{ kind: string; vmid: string }>;
};

async function readParams(value: WorkloadPageProps["params"]) {
  return await value;
}

function asKind(value: string): WorkloadKind | null {
  return value === "qemu" || value === "lxc" ? value : null;
}

function parseVmid(value: string) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function parsePositiveInt(value: string | null) {
  if (!value) return 0;
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

function pickPrimaryDiskKey(disks: Array<{ key: string }>) {
  const preferred = ["rootfs", "scsi0", "virtio0", "sata0", "ide0"];
  for (const key of preferred) {
    if (disks.some((disk) => disk.key === key)) return key;
  }
  return disks.find((disk) => /^(scsi|virtio|sata|ide)\d+$/.test(disk.key))?.key ?? null;
}

function parseStorageName(volume: string) {
  const [storage] = volume.split(":");
  return storage?.trim() || null;
}

function buildWorkloadConsoleHref(kind: WorkloadKind, vmid: number, mode?: "console" | "novnc" | "spice") {
  if (kind === "qemu") {
    const query = mode ? `?mode=${encodeURIComponent(mode)}` : "";
    return `/console/workload/qemu/${vmid}${query}`;
  }
  return `/console/workload/lxc/${vmid}`;
}

function formatRate(value: number) {
  return `${formatBytes(value)}/s`;
}

export async function generateMetadata({ params }: WorkloadPageProps): Promise<Metadata> {
  const resolved = await readParams(params);
  return {
    title: `Workload ${resolved.kind}/${resolved.vmid} | ProxCenter`,
  };
}

export default async function WorkloadDetailPage({ params }: WorkloadPageProps) {
  const resolved = await readParams(params);
  const kind = asKind(resolved.kind);
  const vmid = parseVmid(resolved.vmid);

  if (!kind || !vmid) notFound();

  let detail = null;
  try {
    detail = await getWorkloadDetailById({ kind, vmid });
  } catch {
    detail = null;
  }

  if (!detail) {
    return (
      <section className="content workload-page">
        <header className="topbar">
          <div className="workload-header-copy">
            <Link href="/inventory" className="action-btn workload-back-btn">
              ← Retour
            </Link>
            <nav className="inventory-breadcrumb" aria-label="Fil d’Ariane">
              <Link href="/inventory">Inventaire</Link>
              <span>›</span>
              <span>Workload</span>
              <span>›</span>
              <span>Introuvable</span>
            </nav>
            <h1>Workload indisponible</h1>
          </div>
          <div className="topbar-meta">
            <span className="pill">Introuvable</span>
          </div>
        </header>

        <section className="panel">
          <p className="muted">Impossible de charger cette VM/CT. Vérifie la connexion Proxmox ou le VMID.</p>
        </section>
      </section>
    );
  }

  const cookieStore = await cookies();
  const token = cookieStore.get(AUTH_COOKIE_NAME)?.value;
  const session = token ? await verifySessionToken(token) : null;
  const canOperate = hasRuntimeCapability(session?.role, "operate");
  const consoleHref = buildWorkloadConsoleHref(detail.kind, detail.vmid, detail.kind === "qemu" ? "novnc" : undefined);
  const primaryDiskKey = pickPrimaryDiskKey(detail.disks);
  const primaryDisk = primaryDiskKey ? detail.disks.find((disk) => disk.key === primaryDiskKey) ?? null : null;
  const currentStorage = primaryDisk ? parseStorageName(primaryDisk.volume) : null;
  const memoryMiB = Math.max(256, Math.round(detail.memoryTotal / (1024 * 1024)));
  const diskSizeGb =
    detail.diskTotal > 0
      ? Math.max(1, Math.ceil(detail.diskTotal / (1024 * 1024 * 1024)))
      : null;
  const consoleOptions =
    detail.kind === "qemu"
      ? [
          {
            id: "console",
            label: "Console série",
            href: buildWorkloadConsoleHref(detail.kind, detail.vmid, "console"),
          },
          {
            id: "novnc",
            label: "noVNC",
            href: buildWorkloadConsoleHref(detail.kind, detail.vmid, "novnc"),
          },
          {
            id: "spice",
            label: "SPICE",
            href: buildWorkloadConsoleHref(detail.kind, detail.vmid, "spice"),
          },
        ]
      : [
          {
            id: "xtermjs",
            label: "xtermjs",
            href: buildWorkloadConsoleHref(detail.kind, detail.vmid),
          },
        ];
  const updateShellHref =
    detail.kind === "lxc"
      ? buildWorkloadConsoleHref(detail.kind, detail.vmid)
      : buildWorkloadConsoleHref(detail.kind, detail.vmid, "console");

  return (
    <section className="content content-wide workload-page">
      <header className="topbar">
        <div className="workload-header-copy">
          <Link href="/inventory" className="action-btn workload-back-btn">
            ← Retour
          </Link>
          <nav className="inventory-breadcrumb" aria-label="Fil d’Ariane">
            <Link href="/inventory">Inventaire</Link>
            <span>›</span>
            <span>{detail.kind.toUpperCase()}</span>
            <span>›</span>
            <span>{detail.vmid}</span>
          </nav>
          <h1>
            {detail.name} <span className="muted">#{detail.vmid}</span>
          </h1>
        </div>
        <div className="topbar-meta">
          <InventoryRefreshButton auto intervalMs={5000} />
          {detail.navigation.previous ? (
            <Link
              href={`/inventory/${detail.navigation.previous.kind}/${detail.navigation.previous.vmid}`}
              className="action-btn"
              prefetch
            >
              ← {detail.navigation.previous.vmid}
            </Link>
          ) : (
            <span className="pill">Début</span>
          )}
          {detail.navigation.next ? (
            <Link
              href={`/inventory/${detail.navigation.next.kind}/${detail.navigation.next.vmid}`}
              className="action-btn"
              prefetch
            >
              {detail.navigation.next.vmid} →
            </Link>
          ) : (
            <span className="pill">Fin</span>
          )}
          <span className={`inventory-badge status-${detail.status === "running" ? "running" : "stopped"}`}>
            {detail.kind.toUpperCase()} • {detail.status}
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
            <span>OS</span>
            <strong>{detail.remoteAccess.osLabel ?? detail.ostype ?? "—"}</strong>
          </div>
          <div className="row-line">
            <span>BIOS / Machine</span>
            <strong>
              {[detail.bios, detail.machine].filter(Boolean).join(" / ") || "—"}
            </strong>
          </div>
          <div className="row-line">
            <span>CPU</span>
            <strong>{formatPercent(detail.cpuLoad)}</strong>
          </div>
        </div>

        <div className="workload-hero-stats">
          <div className="inventory-metric-card">
            <span className="muted">CPU</span>
            <strong>{formatPercent(detail.cpuLoad)}</strong>
            <div className="inventory-progress inventory-progress-wide" aria-hidden>
              <span className="tone-green" style={{ width: `${Math.round(detail.cpuLoad * 100)}%` }} />
            </div>
          </div>
          <div className="inventory-metric-card">
            <span className="muted">RAM</span>
            <strong>{formatBytes(detail.memoryUsed)} / {formatBytes(detail.memoryTotal)}</strong>
            <div className="inventory-progress inventory-progress-wide" aria-hidden>
              <span
                className="tone-orange"
                style={{
                  width: `${Math.round(
                    detail.memoryTotal > 0 ? (detail.memoryUsed / detail.memoryTotal) * 100 : 0,
                  )}%`,
                }}
              />
            </div>
          </div>
          <div className="inventory-metric-card">
            <span className="muted">Disque</span>
            <strong>{formatBytes(detail.diskUsed)} / {formatBytes(detail.diskTotal)}</strong>
            <div className="inventory-progress inventory-progress-wide" aria-hidden>
              <span
                className="tone-orange"
                style={{
                  width: `${Math.round(
                    detail.diskTotal > 0 ? (detail.diskUsed / detail.diskTotal) * 100 : 0,
                  )}%`,
                }}
              />
            </div>
          </div>
          <div className="inventory-metric-card">
            <span className="muted">Réseau</span>
            <strong>
              In {formatRate(detail.networkInBytesPerSecond)} • Out {formatRate(detail.networkOutBytesPerSecond)}
            </strong>
          </div>
          <div className="inventory-metric-card">
            <span className="muted">Uptime</span>
            <strong>{detail.uptimeSeconds > 0 ? formatUptime(detail.uptimeSeconds) : "—"}</strong>
          </div>
          <div className="inventory-metric-card">
            <span className="muted">Guest agent</span>
            <strong>
              {detail.agentEnabled === null ? "—" : detail.agentEnabled ? "Actif" : "Inactif"}
            </strong>
          </div>
        </div>

        <div className="workload-hero-actions">
          <InventoryWorkloadActions
            node={detail.node}
            vmid={detail.vmid}
            kind={detail.kind}
            status={detail.status === "running" ? "running" : "stopped"}
            actionable={canOperate}
            consoleHref={consoleHref}
          />
        </div>
      </section>

      <section className="content-grid workload-support-grid">
        <section className="panel">
          <InventoryRemoteAccess
            key={detail.id}
            kind={detail.kind}
            osFamily={detail.remoteAccess.osFamily}
            osLabel={detail.remoteAccess.osLabel}
            primaryIp={detail.remoteAccess.primaryIp}
            guestIps={detail.remoteAccess.guestIps}
            bridge={detail.remoteAccess.bridge}
            vlanTag={detail.remoteAccess.vlanTag}
            running={detail.remoteAccess.running}
            reason={detail.remoteAccess.reason}
            consoleHref={consoleHref}
            consoleOptions={consoleOptions}
          />
        </section>

        <section className="panel">
          <InventoryUpdateStatus
            live={true}
            node={detail.node}
            vmid={detail.vmid}
            kind={detail.kind}
            status={detail.status === "running" ? "running" : "stopped"}
            shellHref={updateShellHref}
          />
        </section>
      </section>

      <InventoryWorkloadConfigEditor
        canOperate={canOperate}
        node={detail.node}
        kind={detail.kind}
        vmid={detail.vmid}
        name={detail.name}
        memoryMiB={memoryMiB}
        cores={Math.max(1, parsePositiveInt(detail.cores))}
        sockets={Math.max(1, parsePositiveInt(detail.sockets))}
        cpuType={detail.cpuType ?? ""}
        ostype={detail.ostype ?? ""}
        bridge={detail.remoteAccess.bridge ?? ""}
        primaryDiskKey={primaryDiskKey}
        currentStorage={currentStorage}
        diskSizeGb={diskSizeGb}
      />

      <section className="workload-grid">
        <section className="panel">
          <div className="panel-head">
            <h2>Configuration</h2>
          </div>
          <div className="mini-list">
            <article className="mini-list-item">
              <div>
                <div className="item-title">Type CPU</div>
              </div>
              <div className="item-metric">{detail.cpuType ?? "—"}</div>
            </article>
            <article className="mini-list-item">
              <div>
                <div className="item-title">Cores / Sockets</div>
              </div>
              <div className="item-metric">
                {[detail.cores ?? "—", detail.sockets ?? "—"].join(" / ")}
              </div>
            </article>
            <article className="mini-list-item">
              <div>
                <div className="item-title">Boot</div>
              </div>
              <div className="item-metric">{detail.bootOrder ?? "—"}</div>
            </article>
          </div>
        </section>

        <section className="panel">
          <div className="panel-head">
            <h2>Disques réels</h2>
            <span className="muted">{detail.disks.length}</span>
          </div>
          {detail.disks.length === 0 ? (
            <p className="muted">Aucun disque remonté.</p>
          ) : (
            <div className="mini-list">
              {detail.disks.map((disk) => (
                <article key={disk.key} className="mini-list-item">
                  <div>
                    <div className="item-title">{disk.label}</div>
                    <div className="item-subtitle">
                      {disk.volume}
                      {disk.mountPoint ? ` • ${disk.mountPoint}` : ""}
                      {disk.media ? ` • ${disk.media}` : ""}
                    </div>
                  </div>
                  <div className="item-metric">{disk.size ?? "—"}</div>
                </article>
              ))}
            </div>
          )}
        </section>

        <section className="panel">
          <div className="panel-head">
            <h2>NIC réelles</h2>
            <span className="muted">{detail.nics.length}</span>
          </div>
          {detail.nics.length === 0 ? (
            <p className="muted">Aucune interface remontée.</p>
          ) : (
            <div className="mini-list">
              {detail.nics.map((nic) => (
                <article key={nic.key} className="mini-list-item">
                  <div>
                    <div className="item-title">{nic.name ?? nic.label}</div>
                    <div className="item-subtitle">
                      {[nic.model, nic.mac, nic.bridge, nic.vlanTag ? `VLAN ${nic.vlanTag}` : null]
                        .filter(Boolean)
                        .join(" • ")}
                    </div>
                  </div>
                  <div className="item-metric">{nic.ipConfig ?? "—"}</div>
                </article>
              ))}
            </div>
          )}
        </section>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>Snapshots</h2>
          <span className="muted">{detail.snapshots.length}</span>
        </div>
        {detail.snapshots.length === 0 ? (
          <p className="muted">Aucun snapshot remonté.</p>
        ) : (
          <div className="mini-list">
            {detail.snapshots.map((snapshot) => (
              <article key={snapshot.name} className="mini-list-item">
                <div>
                  <div className="item-title">{snapshot.name}</div>
                  <div className="item-subtitle">
                    {snapshot.description ?? "Sans description"}
                    {snapshot.createdAt ? ` • ${new Date(snapshot.createdAt).toLocaleString("fr-FR")}` : ""}
                  </div>
                </div>
                <div className="item-metric">
                  {snapshot.vmState === null ? "—" : snapshot.vmState ? "vmstate" : "config"}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </section>
  );
}
