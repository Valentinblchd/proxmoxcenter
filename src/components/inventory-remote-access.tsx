"use client";

import { useMemo, useState } from "react";

type InventoryRemoteAccessProps = {
  kind: "qemu" | "lxc";
  osFamily: "windows" | "linux" | "unknown";
  osLabel: string | null;
  primaryIp: string | null;
  guestIps: string[];
  bridge: string | null;
  vlanTag: string | null;
  running: boolean;
  reason: string;
  consoleHref: string | null;
  consoleOptions?: Array<{
    id: string;
    label: string;
    href: string;
  }>;
};

function buildSshHref(target: string) {
  return `ssh://${target}`;
}

function buildRdpHref(target: string) {
  return `rdp://full%20address=s:${target}`;
}

export default function InventoryRemoteAccess({
  kind,
  osFamily,
  osLabel,
  primaryIp,
  guestIps,
  bridge,
  vlanTag,
  running,
  reason,
  consoleHref,
  consoleOptions = [],
}: InventoryRemoteAccessProps) {
  const [target, setTarget] = useState(primaryIp ?? "");
  const [feedback, setFeedback] = useState("");

  const canLaunchRemote = running && target.trim().length > 0;
  const supportsRdp = kind === "qemu" && (osFamily === "windows" || osFamily === "unknown");
  const supportsSsh = kind === "lxc" || osFamily === "linux" || osFamily === "unknown";
  const detectedIps = useMemo(
    () => [...new Set(guestIps.filter((ip) => ip && ip !== primaryIp))],
    [guestIps, primaryIp],
  );
  const hasConsoleVariants = consoleOptions.length > 0;

  async function copyTarget(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setFeedback("Copié");
      window.setTimeout(() => setFeedback(""), 1800);
    } catch {
      setFeedback("Copie refusée");
      window.setTimeout(() => setFeedback(""), 2200);
    }
  }

  function openExternal(href: string) {
    window.location.href = href;
  }

  return (
    <section className="inventory-remote-panel" aria-label="Accès distant">
      <div className="inventory-remote-head">
        <div>
          <strong>Accès distant</strong>
          <div className="muted">
            {osLabel ?? (kind === "qemu" ? "VM" : "Conteneur")} • {reason}
          </div>
        </div>
        <div className="inventory-tag-list">
          {bridge ? <span className="inventory-tag">{bridge}</span> : null}
          {vlanTag ? <span className="inventory-tag">VLAN {vlanTag}</span> : null}
        </div>
      </div>

      <div className="inventory-remote-grid inventory-remote-grid-compact">
        <div className="inventory-remote-card">
          <label className="inventory-remote-label" htmlFor="remote-target">
            Adresse / IP
          </label>
          <input
            id="remote-target"
            className="inventory-remote-input"
            list="remote-target-options"
            value={target}
            onChange={(event) => setTarget(event.target.value)}
            placeholder={primaryIp ?? "192.168.1.20"}
            autoComplete="off"
          />
          <datalist id="remote-target-options">
            {primaryIp ? <option value={primaryIp} /> : null}
            {detectedIps.map((ip) => (
              <option key={ip} value={ip} />
            ))}
          </datalist>
          <div className="inventory-remote-chip-row">
            {primaryIp ? (
              <button
                type="button"
                className={`inventory-remote-chip${target === primaryIp ? " is-active" : ""}`}
                onClick={() => setTarget(primaryIp)}
              >
                IP principale: {primaryIp}
              </button>
            ) : null}
            {detectedIps.map((ip) => (
              <button
                key={ip}
                type="button"
                className={`inventory-remote-chip${target === ip ? " is-active" : ""}`}
                onClick={() => setTarget(ip)}
              >
                {ip}
              </button>
            ))}
          </div>
        </div>

        <div className="inventory-remote-card">
          <div className="inventory-remote-actions">
            {consoleHref && !hasConsoleVariants ? (
              <a href={consoleHref} className="inventory-primary-btn">
                Console
              </a>
            ) : (
              !hasConsoleVariants ? (
                <button type="button" className="inventory-primary-btn" disabled>
                  Console indisponible
                </button>
              ) : null
            )}

            {consoleOptions.map((option) => (
              <a
                key={option.id}
                href={option.href}
                className={option.id === "novnc" ? "inventory-primary-btn" : "inventory-ghost-btn"}
              >
                {option.label}
              </a>
            ))}

            {supportsRdp ? (
              <button
                type="button"
                className="inventory-ghost-btn"
                disabled={!canLaunchRemote}
                onClick={() => openExternal(buildRdpHref(target.trim()))}
              >
                Ouvrir RDP
              </button>
            ) : null}

            {supportsSsh ? (
              <button
                type="button"
                className="inventory-ghost-btn"
                disabled={!canLaunchRemote}
                onClick={() => openExternal(buildSshHref(target.trim()))}
              >
                Ouvrir SSH
              </button>
            ) : null}

            <button
              type="button"
              className="inventory-ghost-btn"
              disabled={!target.trim()}
              onClick={() => copyTarget(target.trim())}
            >
              Copier cible
            </button>
          </div>

          {feedback ? <div className="inventory-action-hint">{feedback}</div> : null}
        </div>
      </div>

      <div className="inventory-remote-inline-meta">
        <span className="muted">Mode conseillé: {osFamily === "windows" ? "RDP" : "SSH"}</span>
        <span className="muted">État: {running ? "En marche" : "Arrêtée"}</span>
      </div>
    </section>
  );
}
