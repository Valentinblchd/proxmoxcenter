import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import InventoryRemoteAccess from "@/components/inventory-remote-access";
import InventoryUpdateStatus from "@/components/inventory-update-status";
import InventoryWorkloadActions from "@/components/inventory-workload-actions";
import { AUTH_COOKIE_NAME, verifySessionToken } from "@/lib/auth/session";
import { hasRuntimeCapability } from "@/lib/auth/rbac";
import {
  buildProxmoxWorkloadConsoleUrl,
  buildProxmoxWorkloadNoVncUrl,
  buildProxmoxWorkloadSpiceUrl,
  buildProxmoxWorkloadXtermUrl,
} from "@/lib/proxmox/console-url";
import { getProxmoxConfig } from "@/lib/proxmox/config";
import { getWorkloadDetailById, type WorkloadKind } from "@/lib/proxmox/workloads";
import { formatBytes, formatPercent, formatUptime } from "@/lib/ui/format";

export const dynamic = "force-dynamic";

type WorkloadPageProps = {
  params:
    | Promise<{ kind: string; vmid: string }>
    | { kind: string; vmid: string };
};

async function readParams(value: WorkloadPageProps["params"]) {
  if (typeof (value as Promise<{ kind: string; vmid: string }>).then === "function") {
    return await (value as Promise<{ kind: string; vmid: string }>);
  }
  return value as { kind: string; vmid: string };
}

function asKind(value: string): WorkloadKind | null {
  return value === "qemu" || value === "lxc" ? value : null;
}

function parseVmid(value: string) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
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

  const proxmox = getProxmoxConfig();
  const cookieStore = await cookies();
  const token = cookieStore.get(AUTH_COOKIE_NAME)?.value;
  const session = token ? await verifySessionToken(token) : null;
  const canOperate = hasRuntimeCapability(session?.role, "operate");
  const consoleHref = proxmox
    ? buildProxmoxWorkloadConsoleUrl({
        baseUrl: proxmox.baseUrl,
        node: detail.node,
        vmid: detail.vmid,
        kind: detail.kind,
      })
    : null;
  const consoleOptions =
    proxmox && detail.kind === "qemu"
      ? [
          {
            id: "vnc",
            label: "VNC",
            href: buildProxmoxWorkloadConsoleUrl({
              baseUrl: proxmox.baseUrl,
              node: detail.node,
              vmid: detail.vmid,
              kind: detail.kind,
            }),
          },
          {
            id: "novnc",
            label: "noVNC",
            href: buildProxmoxWorkloadNoVncUrl({
              baseUrl: proxmox.baseUrl,
              node: detail.node,
              vmid: detail.vmid,
            }),
          },
          {
            id: "spice",
            label: "SPICE",
            href: buildProxmoxWorkloadSpiceUrl({
              baseUrl: proxmox.baseUrl,
              node: detail.node,
              vmid: detail.vmid,
            }),
          },
        ]
      : proxmox
        ? [
            {
              id: "xtermjs",
              label: "xtermjs",
              href: buildProxmoxWorkloadXtermUrl({
                baseUrl: proxmox.baseUrl,
                node: detail.node,
                vmid: detail.vmid,
              }),
            },
          ]
        : [];
  const updateShellHref =
    proxmox && detail.kind === "lxc"
      ? buildProxmoxWorkloadXtermUrl({
          baseUrl: proxmox.baseUrl,
          node: detail.node,
          vmid: detail.vmid,
        })
      : consoleHref;

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
          {detail.navigation.previous ? (
            <Link
              href={`/inventory/${detail.navigation.previous.kind}/${detail.navigation.previous.vmid}`}
              className="action-btn"
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
            <span className="muted">RAM</span>
            <strong>{formatBytes(detail.memoryUsed)} / {formatBytes(detail.memoryTotal)}</strong>
          </div>
          <div className="inventory-metric-card">
            <span className="muted">Disque</span>
            <strong>{formatBytes(detail.diskUsed)} / {formatBytes(detail.diskTotal)}</strong>
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
            actionable={Boolean(proxmox) && canOperate}
            consoleHref={consoleHref}
          />
        </div>
      </section>

      <section className="panel">
        <InventoryRemoteAccess
          key={detail.id}
          name={detail.name}
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
          live={Boolean(proxmox)}
          node={detail.node}
          vmid={detail.vmid}
          kind={detail.kind}
          status={detail.status === "running" ? "running" : "stopped"}
          shellHref={updateShellHref}
        />
      </section>

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
            <article className="mini-list-item">
              <div>
                <div className="item-title">IP principale</div>
              </div>
              <div className="item-metric">{detail.remoteAccess.primaryIp ?? "—"}</div>
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
