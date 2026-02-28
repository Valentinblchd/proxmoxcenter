"use client";

import { startTransition, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  applyPresetToDraft,
  coerceProvisionKind,
  getDefaultDraft,
  PROVISION_PRESETS,
  type AssistantIntentResponse,
  type ProvisionDraft,
  type ProvisionKind,
  type ProvisionPresetId,
} from "@/lib/provision/schema";

type ProvisionOptionsResponse = {
  ok: boolean;
  mode: "offline" | "live";
  configured: boolean;
  options: {
    nodes: string[];
    nextVmid: number | null;
    storages: Array<{
      name: string;
      type: string;
      content: string;
      shared: boolean;
      active: boolean;
    }>;
    bridges: string[];
    vmOstypes: Array<{ value: string; label: string }>;
  };
};

type ProvisionCreateResponse = {
  ok: boolean;
  upid?: string;
  node?: string;
  kind?: "qemu" | "lxc";
  vmid?: number;
  name?: string;
  message?: string;
  error?: string;
};

type ProvisionImportIsoResponse = {
  ok: boolean;
  upid?: string;
  node?: string;
  storage?: string;
  filename?: string;
  isoVolume?: string;
  message?: string;
  error?: string;
};

type TaskStatusResponse = {
  ok: boolean;
  done?: boolean;
  success?: boolean | null;
  error?: string;
  data?: {
    status?: string;
    exitstatus?: string;
  };
};

function draftFromQuery(kindRaw?: string | null, presetRaw?: string | null) {
  const kind = coerceProvisionKind(kindRaw);
  let draft = getDefaultDraft(kind);
  if (presetRaw) {
    draft = applyPresetToDraft(draft, presetRaw as ProvisionPresetId);
  }
  return draft;
}

function storageHasContent(content: string, target: string) {
  return content
    .split(/[,\s]+/)
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
    .includes(target.toLowerCase());
}

function getFirmwarePresetForOstype(ostype: string) {
  const normalized = ostype.trim().toLowerCase();

  if (/^(win11|win10|w2k16|w2k19|w2k22)$/.test(normalized)) {
    return {
      bios: "ovmf" as const,
      machine: "q35" as const,
      enableTpm: true,
      label: "Windows moderne",
    };
  }

  if (/^(win7|win8|w2k8|w2k12)$/.test(normalized)) {
    return {
      bios: "seabios" as const,
      machine: "i440fx" as const,
      enableTpm: false,
      label: "OS legacy",
    };
  }

  return {
    bios: "ovmf" as const,
    machine: "q35" as const,
    enableTpm: false,
    label: "Linux générique",
  };
}

function FieldRow({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="provision-field">
      <span className="provision-field-label">
        {label}
        {hint ? <small>{hint}</small> : null}
      </span>
      {children}
    </label>
  );
}

function SelectInput({
  value,
  onChange,
  options,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  placeholder?: string;
}) {
  return (
    <select
      className="provision-input"
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      <option value="">{placeholder ?? "Sélectionner"}</option>
      {options.map((option) => (
        <option key={`${option.value}-${option.label}`} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

export default function ProvisioningStudio({
  initialKind,
  initialPreset,
  mode = "wizard",
}: {
  initialKind?: string | null;
  initialPreset?: string | null;
  mode?: "wizard" | "assistant";
}) {
  const MAX_ASSISTANT_PROMPT_CHARS = 1600;
  const [draft, setDraft] = useState<ProvisionDraft>(() => draftFromQuery(initialKind, initialPreset));
  const [assistantPrompt, setAssistantPrompt] = useState("");
  const [assistantResponse, setAssistantResponse] = useState<AssistantIntentResponse | null>(null);
  const [options, setOptions] = useState<ProvisionOptionsResponse | null>(null);
  const [optionsError, setOptionsError] = useState<string | null>(null);
  const [isLoadingOptions, setIsLoadingOptions] = useState(true);
  const [isAskingAssistant, setIsAskingAssistant] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [createResult, setCreateResult] = useState<ProvisionCreateResponse | null>(null);
  const [taskStatus, setTaskStatus] = useState<TaskStatusResponse | null>(null);
  const [taskPollError, setTaskPollError] = useState<string | null>(null);
  const pollTimerRef = useRef<number | null>(null);

  const canCreate = Boolean(options?.configured) && !isCreating;
  const isQemu = draft.kind === "qemu";
  const firmwareForcesQ35 = isQemu && draft.bios === "ovmf";
  const tpmUnsupported = isQemu && draft.bios !== "ovmf";
  const firmwarePreset = getFirmwarePresetForOstype(draft.ostype);

  const storageOptions = useMemo(
    () =>
      (options?.options.storages ?? []).map((storage) => ({
        value: storage.name,
        label: `${storage.name} (${storage.type})`,
      })),
    [options],
  );

  const isoStorageOptions = useMemo(
    () =>
      (options?.options.storages ?? [])
        .filter((storage) => storageHasContent(storage.content, "iso"))
        .map((storage) => ({
          value: storage.name,
          label: `${storage.name} (${storage.type})`,
        })),
    [options],
  );

  const nodeOptions = useMemo(
    () => (options?.options.nodes ?? []).map((node) => ({ value: node, label: node })),
    [options],
  );

  const bridgeOptions = useMemo(
    () =>
      (options?.options.bridges ?? ["vmbr0"]).map((bridge) => ({
        value: bridge,
        label: bridge,
      })),
    [options],
  );

  const presetOptions = PROVISION_PRESETS.filter(
    (preset) => preset.kind === "any" || preset.kind === draft.kind,
  );

  useEffect(() => {
    let cancelled = false;

    async function loadOptions() {
      setIsLoadingOptions(true);
      setOptionsError(null);
      try {
        const response = await fetch("/api/provision/options", { cache: "no-store" });
        const data = (await response.json()) as ProvisionOptionsResponse & { error?: string };
        if (!response.ok || !data.ok) {
          throw new Error(data.error || "Impossible de charger les options de création.");
        }
        if (!cancelled) {
          const defaultIsoStorage =
            data.options.storages.find((storage) => storageHasContent(storage.content, "iso"))?.name ?? "";
          setOptions(data);
          setDraft((current) => {
            const next = { ...current };
            if (!next.node && data.options.nodes[0]) next.node = data.options.nodes[0];
            if (!next.vmid && data.options.nextVmid) next.vmid = String(data.options.nextVmid);
            if (!next.storage && data.options.storages[0]) next.storage = data.options.storages[0].name;
            if (!next.bridge && data.options.bridges[0]) next.bridge = data.options.bridges[0];
            if (!next.isoStorage && defaultIsoStorage) next.isoStorage = defaultIsoStorage;
            return next;
          });
        }
      } catch (error) {
        if (!cancelled) {
          setOptionsError(error instanceof Error ? error.message : "Erreur de chargement.");
        }
      } finally {
        if (!cancelled) {
          setIsLoadingOptions(false);
        }
      }
    }

    void loadOptions();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return () => {
      if (pollTimerRef.current) {
        window.clearTimeout(pollTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!isQemu) return;

    setDraft((current) => {
      let changed = false;
      const next = { ...current };

      if (next.bios === "ovmf" && next.machine !== "q35") {
        next.machine = "q35";
        changed = true;
      }

      if (next.bios !== "ovmf" && next.enableTpm) {
        next.enableTpm = false;
        changed = true;
      }

      return changed ? next : current;
    });
  }, [draft.bios, isQemu]);

  useEffect(() => {
    if (!isQemu) return;

    const preset = getFirmwarePresetForOstype(draft.ostype);
    setDraft((current) => {
      if (
        current.bios === preset.bios &&
        current.machine === preset.machine &&
        current.enableTpm === preset.enableTpm
      ) {
        return current;
      }

      return {
        ...current,
        bios: preset.bios,
        machine: preset.machine,
        enableTpm: preset.enableTpm,
      };
    });
  }, [draft.ostype, isQemu]);

  function patchDraft(patch: Partial<ProvisionDraft>) {
    setDraft((current) => ({ ...current, ...patch }));
  }

  function setKind(nextKind: ProvisionKind) {
    setDraft((current) => {
      const base = getDefaultDraft(nextKind);
      return {
        ...base,
        node: current.node || base.node,
        vmid: current.vmid || base.vmid,
        storage: current.storage || base.storage,
        bridge: current.bridge || base.bridge,
        kind: nextKind,
      };
    });
    setAssistantResponse(null);
    setCreateResult(null);
    setTaskStatus(null);
  }

  function applyPreset(presetId: ProvisionPresetId) {
    setDraft((current) => applyPresetToDraft(current, presetId));
  }

  async function askAssistant() {
    const prompt = assistantPrompt.trim();
    if (!prompt) return;

    setIsAskingAssistant(true);
    setAssistantResponse(null);
    setCreateResult(null);
    setTaskStatus(null);
    try {
      const response = await fetch("/api/assistant/intent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });
      const data = (await response.json()) as AssistantIntentResponse & { error?: string };
      if (!response.ok || !data.ok) {
        throw new Error(data.error || "Assistant indisponible.");
      }
      setAssistantResponse(data);
      if (data.intent === "create-workload" && data.draft) {
        const draftPatch = data.draft;
        const suggestedKind = data.suggestedKind;
        setDraft((current) => {
          let next = { ...current };
          if (suggestedKind && suggestedKind !== current.kind) {
            next = getDefaultDraft(suggestedKind);
          }
          return {
            ...next,
            ...draftPatch,
            kind: coerceProvisionKind(
              typeof draftPatch.kind === "string" ? draftPatch.kind : suggestedKind ?? next.kind,
            ),
          };
        });
      }
    } catch (error) {
      setAssistantResponse({
        ok: true,
        intent: "unknown",
        message: error instanceof Error ? error.message : "Erreur assistant.",
      });
    } finally {
      setIsAskingAssistant(false);
    }
  }

  async function fetchTaskStatus(node: string, upid: string) {
    const response = await fetch(
      `/api/workloads/task-status?node=${encodeURIComponent(node)}&upid=${encodeURIComponent(upid)}`,
      { cache: "no-store" },
    );
    const data = (await response.json()) as TaskStatusResponse;
    setTaskStatus(data);

    if (!response.ok || !data.ok) {
      throw new Error(data.error ?? "Erreur de suivi de tâche.");
    }

    return data;
  }

  async function waitForTaskCompletion(node: string, upid: string, label: string) {
    for (let attempt = 0; attempt < 900; attempt += 1) {
      const data = await fetchTaskStatus(node, upid);
      if (data.done) {
        if (data.success) {
          return data;
        }
        throw new Error(data.data?.exitstatus ?? `${label} échoué.`);
      }
      await new Promise((resolve) => window.setTimeout(resolve, 1200));
    }

    throw new Error(`${label} trop long. Vérifie la tâche Proxmox.`);
  }

  async function pollTask(node: string, upid: string, attempt = 0) {
    try {
      const data = await fetchTaskStatus(node, upid);
      if (data.done || attempt >= 90) {
        return;
      }

      pollTimerRef.current = window.setTimeout(() => {
        void pollTask(node, upid, attempt + 1);
      }, 1200);
    } catch (error) {
      setTaskPollError(error instanceof Error ? error.message : "Erreur de polling");
    }
  }

  async function createWorkload() {
    setIsCreating(true);
    setCreateResult(null);
    setTaskStatus(null);
    setTaskPollError(null);
    if (pollTimerRef.current) {
      window.clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }

    try {
      let payload: ProvisionDraft = { ...draft };

      if (payload.kind === "qemu" && payload.isoSourceMode === "url" && payload.isoUrl.trim()) {
        const importResponse = await fetch("/api/provision/import-iso", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            node: payload.node,
            storage: payload.isoStorage,
            isoUrl: payload.isoUrl,
            isoFilename: payload.isoFilename,
          }),
        });
        const importData = (await importResponse.json()) as ProvisionImportIsoResponse;
        setCreateResult(importData);

        if (!importResponse.ok || !importData.ok || !importData.node || !importData.upid || !importData.isoVolume) {
          return;
        }

        await waitForTaskCompletion(importData.node, importData.upid, "Téléchargement ISO");
        payload = {
          ...payload,
          isoSourceMode: "existing",
          isoVolume: importData.isoVolume,
          isoStorage: importData.storage ?? payload.isoStorage,
          isoFilename: importData.filename ?? payload.isoFilename,
        };
        setDraft(payload);
        setCreateResult({
          ok: true,
          message: `ISO prêt: ${importData.isoVolume}. Création VM lancée.`,
        });
        setTaskStatus(null);
      }

      const response = await fetch("/api/provision/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await response.json()) as ProvisionCreateResponse;
      setCreateResult(data);
      if (!response.ok || !data.ok) {
        return;
      }
      if (data.node && data.upid) {
        void pollTask(data.node, data.upid);
      }
    } catch (error) {
      setCreateResult({
        ok: false,
        error: error instanceof Error ? error.message : "Erreur de création",
      });
    } finally {
      setIsCreating(false);
    }
  }

  const missingRequired =
    !draft.node ||
    !draft.vmid ||
    !draft.name ||
    !draft.memoryMiB ||
    !draft.cores ||
    !draft.diskGb ||
    !draft.storage ||
    !draft.bridge ||
    (isQemu && draft.isoSourceMode === "url" && (!draft.isoUrl || !draft.isoStorage)) ||
    (isQemu ? false : !draft.lxcTemplate);

  return (
    <div className="provision-shell">
      {mode === "assistant" ? (
        <section className="panel provision-assistant-panel">
          <div className="panel-head">
            <h2>Assistant de création</h2>
          </div>
          <div className="assistant-row">
            <textarea
              className="provision-textarea"
              placeholder="Ex: Crée un serveur Windows 2022, 4 vCPU, 8 Go de RAM, 120 Go"
              value={assistantPrompt}
              onChange={(event) => setAssistantPrompt(event.target.value)}
              maxLength={MAX_ASSISTANT_PROMPT_CHARS}
              rows={3}
            />
            <button
              type="button"
              className="action-btn primary"
              onClick={() => {
                startTransition(() => {
                  void askAssistant();
                });
              }}
              disabled={isAskingAssistant}
            >
              {isAskingAssistant ? "Analyse..." : "Analyser"}
            </button>
          </div>
          {assistantResponse ? (
            <div className="assistant-response">
              <p>{assistantResponse.message}</p>
              {assistantResponse.followUps?.length ? (
                <ul className="assistant-followups">
                  {assistantResponse.followUps.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              ) : null}
              {assistantResponse.intent === "workload-action" ? (
                <div className="quick-actions">
                  <Link
                    href={
                      assistantResponse.actionDraft?.vmid
                        ? `/inventory?q=${encodeURIComponent(assistantResponse.actionDraft.vmid)}`
                        : "/inventory"
                    }
                    className="action-btn"
                  >
                    Ouvrir inventaire
                  </Link>
                </div>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}

      <section className="panel provision-panel">
        <div className="panel-head">
          <h2>Création VM / LXC</h2>
          <span className="muted">
            {options?.configured ? "Connexion active" : "Connexion requise"}
          </span>
        </div>

        <div className="provision-toolbar">
          <div className="provision-segment">
            <button
              type="button"
              className={`provision-seg-btn${draft.kind === "qemu" ? " is-active" : ""}`}
              onClick={() => setKind("qemu")}
            >
              VM (QEMU)
            </button>
            <button
              type="button"
              className={`provision-seg-btn${draft.kind === "lxc" ? " is-active" : ""}`}
              onClick={() => setKind("lxc")}
            >
              LXC
            </button>
          </div>

          <div className="provision-toolbar-right">
            <SelectInput
              value={draft.presetId}
              onChange={(value) => applyPreset((value || "generic") as ProvisionPresetId)}
              options={presetOptions.map((preset) => ({
                value: preset.id,
                label: preset.label,
              }))}
              placeholder="Preset"
            />
            <button
              type="button"
              className="inventory-mini-toggle"
              onClick={() => window.location.reload()}
            >
              Refresh options
            </button>
          </div>
        </div>

        {isLoadingOptions ? (
          <p className="muted">Chargement des options de création...</p>
        ) : null}

        {optionsError ? <p className="warning">{optionsError}</p> : null}

        {!options?.configured ? (
          <div className="hint-box">
            <p className="muted">
              Connexion Proxmox requise pour créer. Ouvre{" "}
              <Link href="/settings?tab=connection">Paramètres → Connexion</Link>.
            </p>
          </div>
        ) : null}

        <div className="provision-grid">
          <FieldRow label="Nœud">
            <SelectInput
              value={draft.node}
              onChange={(value) => patchDraft({ node: value })}
              options={nodeOptions}
              placeholder="Choisir un nœud"
            />
          </FieldRow>

          <FieldRow label="VMID" hint={options?.options.nextVmid ? `Prochain suggéré: ${options.options.nextVmid}` : undefined}>
            <input
              className="provision-input"
              value={draft.vmid}
              onChange={(event) => patchDraft({ vmid: event.target.value })}
              inputMode="numeric"
              placeholder="100"
            />
          </FieldRow>

          <FieldRow label={isQemu ? "Nom VM" : "Hostname LXC"}>
            <input
              className="provision-input"
              value={draft.name}
              onChange={(event) => patchDraft({ name: event.target.value })}
              placeholder={isQemu ? "win-server-prod" : "debian-app-01"}
            />
          </FieldRow>

          <FieldRow label="Stockage">
            <SelectInput
              value={draft.storage}
              onChange={(value) => patchDraft({ storage: value })}
              options={storageOptions}
              placeholder="Choisir un stockage"
            />
          </FieldRow>

          <FieldRow label="Bridge réseau">
            <SelectInput
              value={draft.bridge}
              onChange={(value) => patchDraft({ bridge: value })}
              options={bridgeOptions}
              placeholder="vmbr0"
            />
          </FieldRow>

          <FieldRow label="RAM (MiB)">
            <input
              className="provision-input"
              value={draft.memoryMiB}
              onChange={(event) => patchDraft({ memoryMiB: event.target.value })}
              inputMode="numeric"
              placeholder="4096"
            />
          </FieldRow>

          <FieldRow label="vCPU / Cores">
            <input
              className="provision-input"
              value={draft.cores}
              onChange={(event) => patchDraft({ cores: event.target.value })}
              inputMode="numeric"
              placeholder="2"
            />
          </FieldRow>

          {isQemu ? (
            <FieldRow label="Sockets">
              <input
                className="provision-input"
                value={draft.sockets}
                onChange={(event) => patchDraft({ sockets: event.target.value })}
                inputMode="numeric"
                placeholder="1"
              />
            </FieldRow>
          ) : (
            <FieldRow label="Swap LXC (MiB)">
              <input
                className="provision-input"
                value={draft.lxcSwapMiB}
                onChange={(event) => patchDraft({ lxcSwapMiB: event.target.value })}
                inputMode="numeric"
                placeholder="512"
              />
            </FieldRow>
          )}

          <FieldRow label="Disque (Go)">
            <input
              className="provision-input"
              value={draft.diskGb}
              onChange={(event) => patchDraft({ diskGb: event.target.value })}
              inputMode="numeric"
              placeholder={isQemu ? "64" : "16"}
            />
          </FieldRow>

          {isQemu ? (
            <FieldRow label="OS Type VM" hint="Valeur libre acceptée. Ex: l26, win11, w2k22">
              <>
                <input
                  className="provision-input"
                  value={draft.ostype}
                  onChange={(event) => patchDraft({ ostype: event.target.value })}
                  placeholder="l26"
                  list="vm-ostype-options"
                />
                <datalist id="vm-ostype-options">
                  {(options?.options.vmOstypes ?? []).map((option) => (
                    <option key={`${option.value}-${option.label}`} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </datalist>
              </>
            </FieldRow>
          ) : (
            <FieldRow label="Template LXC" hint="Volume Proxmox type `vztmpl`">
              <input
                className="provision-input"
                value={draft.lxcTemplate}
                onChange={(event) => patchDraft({ lxcTemplate: event.target.value })}
                placeholder="local:vztmpl/debian-12-standard_12.x_amd64.tar.zst"
              />
            </FieldRow>
          )}

          {isQemu ? (
            <>
              <FieldRow label="Source ISO">
                <div className="provision-segment">
                  <button
                    type="button"
                    className={`provision-seg-btn${draft.isoSourceMode === "existing" ? " is-active" : ""}`}
                    onClick={() => patchDraft({ isoSourceMode: "existing" })}
                  >
                    Volume existant
                  </button>
                  <button
                    type="button"
                    className={`provision-seg-btn${draft.isoSourceMode === "url" ? " is-active" : ""}`}
                    onClick={() => patchDraft({ isoSourceMode: "url" })}
                  >
                    URL ISO
                  </button>
                </div>
              </FieldRow>

              {draft.isoSourceMode === "existing" ? (
                <FieldRow label="ISO volume" hint="Ex: local:iso/Win2022.iso">
                  <input
                    className="provision-input"
                    value={draft.isoVolume}
                    onChange={(event) => patchDraft({ isoVolume: event.target.value })}
                    placeholder="local:iso/WinServer2022.iso"
                  />
                </FieldRow>
              ) : (
                <>
                  <FieldRow label="URL du fichier ISO" hint="Téléchargé directement par Proxmox">
                    <input
                      className="provision-input"
                      value={draft.isoUrl}
                      onChange={(event) => patchDraft({ isoUrl: event.target.value })}
                      placeholder="https://downloads.exemple.tld/windows-server-2022.iso"
                    />
                  </FieldRow>

                  <FieldRow label="Stockage ISO cible">
                    <SelectInput
                      value={draft.isoStorage}
                      onChange={(value) => patchDraft({ isoStorage: value })}
                      options={isoStorageOptions}
                      placeholder={
                        isoStorageOptions.length > 0
                          ? "Choisir un stockage ISO"
                          : "Aucun stockage ISO détecté"
                      }
                    />
                  </FieldRow>

                  <FieldRow label="Nom du fichier ISO" hint="Optionnel, dérivé depuis l’URL sinon">
                    <input
                      className="provision-input"
                      value={draft.isoFilename}
                      onChange={(event) => patchDraft({ isoFilename: event.target.value })}
                      placeholder="windows-server-2022.iso"
                    />
                  </FieldRow>
                </>
              )}
            </>
          ) : (
            <FieldRow label="Mot de passe root (optionnel)">
              <input
                className="provision-input"
                type="password"
                value={draft.lxcPassword}
                onChange={(event) => patchDraft({ lxcPassword: event.target.value })}
                placeholder="Laisse vide si tu fournis ensuite SSH/console"
              />
            </FieldRow>
          )}

          {isQemu ? (
            <>
              <FieldRow label="CPU type">
                <input
                  className="provision-input"
                  value={draft.cpuType}
                  onChange={(event) => patchDraft({ cpuType: event.target.value })}
                  placeholder="host ou x86-64-v2-AES"
                />
              </FieldRow>
              <FieldRow label="BIOS / Machine">
                <div className="provision-inline-split">
                  <select
                    className="provision-input"
                    value={draft.bios}
                    onChange={(event) =>
                      patchDraft({ bios: event.target.value as ProvisionDraft["bios"] })
                    }
                  >
                    <option value="ovmf">OVMF (UEFI)</option>
                    <option value="seabios">SeaBIOS</option>
                  </select>
                  <select
                    className="provision-input"
                    value={draft.machine}
                    onChange={(event) =>
                      patchDraft({ machine: event.target.value as ProvisionDraft["machine"] })
                    }
                    disabled={firmwareForcesQ35}
                  >
                    <option value="q35">Q35</option>
                    <option value="i440fx">i440fx</option>
                  </select>
                </div>
                <small className="item-subtitle">Preset auto: {firmwarePreset.label}</small>
              </FieldRow>
            </>
          ) : (
            <FieldRow label="Mode LXC">
              <div className="provision-check-row">
                <label className="provision-check">
                  <input
                    type="checkbox"
                    checked={draft.lxcUnprivileged}
                    onChange={(event) => patchDraft({ lxcUnprivileged: event.target.checked })}
                  />
                  <span>Unprivileged</span>
                </label>
              </div>
            </FieldRow>
          )}
        </div>

        {isQemu && draft.isoSourceMode === "url" && isoStorageOptions.length === 0 ? (
          <p className="warning">
            Aucun stockage Proxmox avec contenu `iso` détecté. Ajoute un datastore ISO avant
            d’utiliser le téléchargement par URL.
          </p>
        ) : null}

        {isQemu && firmwareForcesQ35 ? (
          <p className="muted">
            OVMF force `Q35` pour éviter les incompatibilités firmware/chipset.
          </p>
        ) : null}

        {isQemu && tpmUnsupported ? (
          <p className="muted">
            TPM n’est disponible qu’en mode OVMF (UEFI). Il est désactivé automatiquement avec
            SeaBIOS.
          </p>
        ) : null}

        <div className="provision-check-row">
          {isQemu ? (
            <>
              <label className="provision-check">
                <input
                  type="checkbox"
                  checked={draft.enableAgent}
                  onChange={(event) => patchDraft({ enableAgent: event.target.checked })}
                />
                <span>QEMU guest agent</span>
              </label>
              <label className="provision-check">
                <input
                  type="checkbox"
                  checked={draft.enableTpm}
                  disabled={tpmUnsupported}
                  onChange={(event) => patchDraft({ enableTpm: event.target.checked })}
                />
                <span>TPM (Windows/UEFI)</span>
              </label>
            </>
          ) : null}
        </div>

        <div className="provision-actions">
          <button
            type="button"
            className="action-btn primary"
            onClick={() => {
              startTransition(() => {
                void createWorkload();
              });
            }}
            disabled={!canCreate || missingRequired}
          >
            {isCreating ? "Création..." : `Créer ${isQemu ? "la VM" : "le LXC"}`}
          </button>
          <Link href="/inventory" className="action-btn">
            Retour inventaire
          </Link>
          {missingRequired ? (
            <span className="muted">Complète les champs requis pour activer la création.</span>
          ) : null}
        </div>

        {createResult ? (
          <div className={`provision-result ${createResult.ok ? "ok" : "error"}`}>
            <strong>{createResult.ok ? "Création lancée" : "Création refusée"}</strong>
            <p>{createResult.message ?? createResult.error}</p>
            {createResult.upid ? <code>{createResult.upid}</code> : null}
          </div>
        ) : null}

        {taskStatus ? (
          <div className="provision-task-status">
            <div className="row-line">
              <span>Statut tâche</span>
              <strong>{taskStatus.data?.status ?? "inconnu"}</strong>
            </div>
            <div className="row-line">
              <span>Résultat</span>
              <strong
                className={
                  taskStatus.done
                    ? taskStatus.success
                      ? "status-good"
                      : "warning"
                    : undefined
                }
              >
                {taskStatus.done
                  ? taskStatus.success
                    ? "OK"
                    : taskStatus.data?.exitstatus ?? "Erreur"
                  : "En cours..."}
              </strong>
            </div>
          </div>
        ) : null}

        {taskPollError ? <p className="warning">{taskPollError}</p> : null}
      </section>
    </div>
  );
}
