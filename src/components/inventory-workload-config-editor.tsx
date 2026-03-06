"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

type WorkloadKind = "qemu" | "lxc";

type ProvisionStorageOption = {
  name: string;
  type: string;
  content: string;
  shared: boolean;
  active: boolean;
};

type ProvisionOptionsPayload = {
  ok?: boolean;
  options?: {
    storages?: ProvisionStorageOption[];
    bridges?: string[];
  };
};

type SaveResponse = {
  ok?: boolean;
  error?: string;
  message?: string;
};

type Props = {
  canOperate: boolean;
  node: string;
  kind: WorkloadKind;
  vmid: number;
  name: string;
  memoryMiB: number;
  cores: number;
  sockets: number;
  cpuType: string;
  ostype: string;
  bridge: string;
  primaryDiskKey: string | null;
  currentStorage: string | null;
  diskSizeGb: number | null;
};

function storageSupportsKind(content: string, kind: WorkloadKind) {
  const entries = content
    .split(/[,\s]+/)
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  if (kind === "qemu") {
    return entries.includes("images");
  }
  return entries.includes("rootdir");
}

export default function InventoryWorkloadConfigEditor({
  canOperate,
  node,
  kind,
  vmid,
  name,
  memoryMiB,
  cores,
  sockets,
  cpuType,
  ostype,
  bridge,
  primaryDiskKey,
  currentStorage,
  diskSizeGb,
}: Props) {
  const [workloadName, setWorkloadName] = useState(name);
  const [workloadMemoryMiB, setWorkloadMemoryMiB] = useState(String(memoryMiB));
  const [workloadCores, setWorkloadCores] = useState(String(cores));
  const [workloadSockets, setWorkloadSockets] = useState(String(Math.max(1, sockets)));
  const [workloadCpuType, setWorkloadCpuType] = useState(cpuType);
  const [workloadOstype, setWorkloadOstype] = useState(ostype);
  const [workloadBridge, setWorkloadBridge] = useState(bridge);
  const [workloadStorage, setWorkloadStorage] = useState(currentStorage ?? "");
  const [workloadDiskSizeGb, setWorkloadDiskSizeGb] = useState(diskSizeGb ? String(diskSizeGb) : "");
  const [bridgeOptions, setBridgeOptions] = useState<string[]>([]);
  const [storageOptions, setStorageOptions] = useState<ProvisionStorageOption[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (!canOperate) return;
    let cancelled = false;

    async function loadOptions() {
      try {
        const response = await fetch("/api/provision/options", {
          headers: { Accept: "application/json" },
          cache: "no-store",
        });
        const payload = (await response.json().catch(() => ({}))) as ProvisionOptionsPayload;
        if (!response.ok || cancelled) return;
        setBridgeOptions(Array.isArray(payload.options?.bridges) ? payload.options?.bridges ?? [] : []);
        setStorageOptions(Array.isArray(payload.options?.storages) ? payload.options?.storages ?? [] : []);
      } catch {
        if (!cancelled) {
          setBridgeOptions([]);
          setStorageOptions([]);
        }
      }
    }

    void loadOptions();

    return () => {
      cancelled = true;
    };
  }, [canOperate]);

  const compatibleStorages = useMemo(() => {
    const filtered = storageOptions.filter((storage) => storage.active && storageSupportsKind(storage.content, kind));
    if (currentStorage && !filtered.some((storage) => storage.name === currentStorage)) {
      return [
        ...filtered,
        {
          name: currentStorage,
          type: "current",
          content: kind === "qemu" ? "images" : "rootdir",
          shared: false,
          active: true,
        },
      ].sort((left, right) => left.name.localeCompare(right.name));
    }
    return filtered.sort((left, right) => left.name.localeCompare(right.name));
  }, [currentStorage, kind, storageOptions]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");

    try {
      const response = await fetch("/api/workloads/config", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          node,
          kind,
          vmid,
          name: workloadName,
          memoryMiB: Number.parseInt(workloadMemoryMiB || "0", 10),
          cores: Number.parseInt(workloadCores || "0", 10),
          sockets: kind === "qemu" ? Number.parseInt(workloadSockets || "0", 10) : undefined,
          cpuType: kind === "qemu" ? workloadCpuType.trim() : undefined,
          ostype: kind === "qemu" ? workloadOstype.trim() : undefined,
          bridge: workloadBridge,
          primaryDiskKey,
          targetStorage: workloadStorage,
          diskSizeGb: kind === "qemu" && workloadDiskSizeGb ? Number.parseInt(workloadDiskSizeGb, 10) : undefined,
          currentDiskSizeGb: kind === "qemu" && diskSizeGb ? diskSizeGb : undefined,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as SaveResponse;
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || "Impossible d’enregistrer les changements.");
      }
      setNotice(payload.message || "Configuration enregistrée.");
      window.setTimeout(() => {
        window.location.reload();
      }, 900);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Impossible d’enregistrer les changements.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="panel">
      <summary className="settings-collapsible-summary">
        <span>Config workload</span>
        <span className="muted">
          {currentStorage ?? "sans stockage"} • {bridge || "sans bridge"} • {memoryMiB} MiB
        </span>
      </summary>
      <div className="settings-collapsible-content stack-sm">
        {!canOperate ? <p className="muted">Compte opérateur requis pour modifier cette configuration.</p> : null}
        {error ? <div className="backup-alert error"><strong>Erreur</strong><p>{error}</p></div> : null}
        {notice ? <div className="backup-alert info"><strong>Info</strong><p>{notice}</p></div> : null}

        {canOperate ? (
          <form className="provision-panel" onSubmit={onSubmit}>
            <div className="provision-grid">
              <label className="provision-field">
                <span className="provision-field-label">Nom</span>
                <input className="provision-input" value={workloadName} onChange={(event) => setWorkloadName(event.target.value)} required />
              </label>
              <label className="provision-field">
                <span className="provision-field-label">Mémoire (MiB)</span>
                <input
                  className="provision-input"
                  type="number"
                  min={256}
                  value={workloadMemoryMiB}
                  onChange={(event) => setWorkloadMemoryMiB(event.target.value)}
                  required
                />
              </label>
              <label className="provision-field">
                <span className="provision-field-label">CPU / cores</span>
                <input
                  className="provision-input"
                  type="number"
                  min={1}
                  value={workloadCores}
                  onChange={(event) => setWorkloadCores(event.target.value)}
                  required
                />
              </label>
              {kind === "qemu" ? (
                <label className="provision-field">
                  <span className="provision-field-label">Sockets</span>
                  <input
                    className="provision-input"
                    type="number"
                    min={1}
                    value={workloadSockets}
                    onChange={(event) => setWorkloadSockets(event.target.value)}
                    required
                  />
                </label>
              ) : null}
            </div>

            <div className="provision-grid">
              {kind === "qemu" ? (
                <>
                  <label className="provision-field">
                    <span className="provision-field-label">Type CPU</span>
                    <input
                      className="provision-input"
                      value={workloadCpuType}
                      onChange={(event) => setWorkloadCpuType(event.target.value)}
                      placeholder="x86-64-v2-AES"
                    />
                  </label>
                  <label className="provision-field">
                    <span className="provision-field-label">OS type</span>
                    <input
                      className="provision-input"
                      value={workloadOstype}
                      onChange={(event) => setWorkloadOstype(event.target.value)}
                      placeholder="l26 / win11 / w2k22"
                    />
                  </label>
                </>
              ) : null}

              <label className="provision-field">
                <span className="provision-field-label">Bridge réseau</span>
                <select
                  className="provision-input"
                  value={workloadBridge}
                  onChange={(event) => setWorkloadBridge(event.target.value)}
                >
                  <option value="">Aucun bridge</option>
                  {bridgeOptions.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>

              <label className="provision-field">
                <span className="provision-field-label">Stockage principal</span>
                <select
                  className="provision-input"
                  value={workloadStorage}
                  onChange={(event) => setWorkloadStorage(event.target.value)}
                  disabled={!primaryDiskKey}
                >
                  <option value="">{primaryDiskKey ? "Conserver le stockage actuel" : "Aucun disque principal détecté"}</option>
                  {compatibleStorages.map((storage) => (
                    <option key={storage.name} value={storage.name}>
                      {storage.name} ({storage.type})
                    </option>
                  ))}
                </select>
              </label>

              {kind === "qemu" && primaryDiskKey ? (
                <label className="provision-field">
                  <span className="provision-field-label">Taille disque (Go)</span>
                  <input
                    className="provision-input"
                    type="number"
                    min={diskSizeGb ?? 1}
                    value={workloadDiskSizeGb}
                    onChange={(event) => setWorkloadDiskSizeGb(event.target.value)}
                  />
                </label>
              ) : null}
            </div>

            <div className="quick-actions">
              <button type="submit" className="action-btn primary" disabled={busy}>
                {busy ? "Enregistrement..." : "Appliquer les changements"}
              </button>
            </div>
          </form>
        ) : null}
      </div>
    </details>
  );
}
