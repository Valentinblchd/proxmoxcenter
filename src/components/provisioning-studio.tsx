"use client";

import { startTransition, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import StrongConfirmDialog from "@/components/strong-confirm-dialog";
import {
  applyPresetToDraft,
  coerceProvisionKind,
  getDefaultDraft,
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
    usedVmids: number[];
    storages: Array<{
      name: string;
      type: string;
      content: string;
      shared: boolean;
      active: boolean;
    }>;
    bridges: string[];
    isoVolumes: Array<{
      value: string;
      label: string;
      storage: string;
      node: string;
      sizeBytes: number | null;
      createdAt: string | null;
    }>;
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

type ProvisionWizardStepId = "base" | "resources" | "os" | "advanced" | "review";

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

function storageSupportsProvisionKind(content: string, kind: ProvisionKind) {
  return kind === "qemu"
    ? storageHasContent(content, "images")
    : storageHasContent(content, "rootdir");
}

function inferOstypeFromMedia(value: string) {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;

  if (/\bdebian\b/.test(normalized)) return "l26";
  if (/\b(ubuntu|alma|rocky|centos|fedora|opensuse|suse|rhel|linux)\b/.test(normalized)) return "l26";
  if (/\bwindows\s*server\s*2025\b/.test(normalized)) return "w2k22";
  if (/\bwindows\s*server\s*2022\b/.test(normalized)) return "w2k22";
  if (/\bwindows\s*server\s*2019\b/.test(normalized)) return "w2k19";
  if (/\bwindows\s*server\s*2016\b/.test(normalized)) return "w2k16";
  if (/\bwindows\s*server\s*2012\b/.test(normalized)) return "w2k12";
  if (/\bwindows\s*server\s*2008\b/.test(normalized)) return "w2k8";
  if (/\bwindows\s*11\b/.test(normalized)) return "win11";
  if (/\bwindows\s*10\b/.test(normalized)) return "win10";
  if (/\bwindows\s*8\b/.test(normalized)) return "win8";
  if (/\bwindows\s*7\b/.test(normalized)) return "win7";
  if (/\bwindows\b/.test(normalized)) return "win11";
  return null;
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
  className,
  children,
}: {
  label: string;
  hint?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={`provision-field${className ? ` ${className}` : ""}`}>
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

function isIsoUrlCandidate(value: string) {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return false;
  try {
    const parsed = new URL(normalized);
    return (
      parsed.protocol === "https:" &&
      !parsed.search &&
      decodeURIComponent(parsed.pathname).toLowerCase().endsWith(".iso")
    );
  } catch {
    return false;
  }
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
  const [importConfirmOpen, setImportConfirmOpen] = useState(false);
  const [wizardStep, setWizardStep] = useState<ProvisionWizardStepId>("base");
  const [createResult, setCreateResult] = useState<ProvisionCreateResponse | null>(null);
  const [taskStatus, setTaskStatus] = useState<TaskStatusResponse | null>(null);
  const [taskPollError, setTaskPollError] = useState<string | null>(null);
  const pollTimerRef = useRef<number | null>(null);
  const autoDetectedOstypeRef = useRef("");
  const [ostypeTouched, setOstypeTouched] = useState(false);

  const canCreate = Boolean(options?.configured) && !isCreating;
  const isQemu = draft.kind === "qemu";
  const tpmUnsupported = isQemu && draft.bios !== "ovmf";
  const parsedVmid = Number.parseInt(draft.vmid, 10);
  const vmidInvalid = draft.vmid.trim().length > 0 && (!Number.isInteger(parsedVmid) || parsedVmid < 1);

  const storageOptions = useMemo(() => {
    const names = new Set<string>();
    return (options?.options.storages ?? [])
      .filter((storage) => storage.active)
      .filter((storage) => storageSupportsProvisionKind(storage.content, draft.kind))
      .filter((storage) => {
        if (names.has(storage.name)) return false;
        names.add(storage.name);
        return true;
      })
      .map((storage) => ({
        value: storage.name,
        label: `${storage.name} (${storage.type})`,
      }));
  }, [draft.kind, options]);

  const isoStorageOptions = useMemo(() => {
    const names = new Set<string>();
    return (options?.options.storages ?? [])
      .filter((storage) => storageHasContent(storage.content, "iso"))
      .filter((storage) => {
        if (names.has(storage.name)) return false;
        names.add(storage.name);
        return true;
      })
      .map((storage) => ({
        value: storage.name,
        label: `${storage.name} (${storage.type})`,
      }));
  }, [options]);

  const isoVolumeOptions = useMemo(() => {
    const selectedNode = draft.node.trim();
    const entries = options?.options.isoVolumes ?? [];
    const filtered = selectedNode
      ? entries.filter((entry) => entry.node === selectedNode)
      : entries;
    return filtered.map((entry) => ({
      value: entry.value,
      label: `${entry.label} • ${entry.node}`,
    }));
  }, [draft.node, options]);

  const nodeOptions = useMemo(
    () => (options?.options.nodes ?? []).map((node) => ({ value: node, label: node })),
    [options],
  );

  const bridgeOptions = useMemo(() => {
    const entries = (options?.options.bridges ?? [])
      .map((bridge) => bridge.trim())
      .filter((bridge) => bridge.length > 0);
    const deduped = Array.from(new Set(entries));
    return deduped.map((bridge) => ({
      value: bridge,
      label: bridge,
    }));
  }, [options]);

  useEffect(() => {
    if (bridgeOptions.length !== 1 || draft.bridge.trim()) return;
    setDraft((current) => ({ ...current, bridge: bridgeOptions[0].value }));
  }, [bridgeOptions, draft.bridge]);

  const vmidConflict = useMemo(() => {
    if (!Number.isInteger(parsedVmid) || parsedVmid < 1) return false;
    return (options?.options.usedVmids ?? []).includes(parsedVmid);
  }, [parsedVmid, options]);

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
          setOptions(data);
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

  useEffect(() => {
    if (!isQemu) return;

    const sourceLabel = draft.isoSourceMode === "url" ? draft.isoUrl : draft.isoVolume;
    const inferred = inferOstypeFromMedia(sourceLabel);
    const current = draft.ostype.trim().toLowerCase();
    const previousAuto = autoDetectedOstypeRef.current.trim().toLowerCase();

    if (!inferred) {
      if (previousAuto && current === previousAuto) {
        autoDetectedOstypeRef.current = "";
      }
      return;
    }

    if ((!current || !ostypeTouched || current === previousAuto) && current !== inferred) {
      autoDetectedOstypeRef.current = inferred;
      setDraft((currentDraft) => ({ ...currentDraft, ostype: inferred }));
      if (!current || current === previousAuto) {
        setOstypeTouched(false);
      }
    }
  }, [draft.isoSourceMode, draft.isoUrl, draft.isoVolume, draft.ostype, isQemu, ostypeTouched]);

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
    setOstypeTouched(false);
    autoDetectedOstypeRef.current = "";
    setAssistantResponse(null);
    setCreateResult(null);
    setTaskStatus(null);
    setWizardStep("base");
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

  async function createWorkload(importConfirmationText?: string) {
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
            confirmationText: importConfirmationText,
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
    vmidConflict ||
    vmidInvalid ||
    (isQemu &&
      draft.isoSourceMode === "url" &&
      (!draft.isoUrl || !draft.isoStorage || !isIsoUrlCandidate(draft.isoUrl))) ||
    (isQemu && draft.isoSourceMode === "existing" && !draft.isoVolume.trim()) ||
    (isQemu ? false : !draft.lxcTemplate);

  const baseStepReady =
    draft.node.trim().length > 0 &&
    draft.vmid.trim().length > 0 &&
    draft.name.trim().length > 0 &&
    !vmidConflict &&
    !vmidInvalid;
  const resourcesStepReady =
    draft.storage.trim().length > 0 &&
    draft.memoryMiB.trim().length > 0 &&
    draft.cores.trim().length > 0 &&
    draft.diskGb.trim().length > 0;
  const osStepReady = isQemu
    ? draft.ostype.trim().length > 0 &&
      (draft.isoSourceMode === "existing"
        ? draft.isoVolume.trim().length > 0
        : draft.isoStorage.trim().length > 0 && isIsoUrlCandidate(draft.isoUrl))
    : draft.lxcTemplate.trim().length > 0;
  const stepStatus: Record<ProvisionWizardStepId, boolean> = {
    base: baseStepReady,
    resources: resourcesStepReady,
    os: osStepReady,
    advanced: true,
    review: !missingRequired,
  };
  const wizardSteps: Array<{ id: ProvisionWizardStepId; label: string; hint: string }> = [
    { id: "base", label: "Identité", hint: "Type, nœud, VMID et nom" },
    { id: "resources", label: "Capacité", hint: "Stockage, réseau, CPU et RAM" },
    { id: "os", label: "Système", hint: isQemu ? "OS, ISO et firmware" : "Template et accès" },
    { id: "advanced", label: "Options", hint: "Réglages système" },
    { id: "review", label: "Résumé", hint: "Vérifier puis créer" },
  ];
  const currentWizardIndex = wizardSteps.findIndex((step) => step.id === wizardStep);
  const activeWizardStep = wizardSteps[currentWizardIndex] ?? wizardSteps[0];
  const canMoveNext =
    currentWizardIndex < wizardSteps.length - 1 && stepStatus[wizardSteps[currentWizardIndex]?.id ?? "base"];
  const stageSummaryRows = [
    { label: "Type", value: isQemu ? "VM QEMU" : "Conteneur LXC" },
    { label: "Nœud", value: draft.node || "À choisir" },
    { label: "Stockage", value: draft.storage || "À choisir" },
    {
      label: isQemu ? "Média" : "Template",
      value: isQemu
        ? draft.isoSourceMode === "url"
          ? draft.isoUrl || "URL ISO manquante"
          : draft.isoVolume || "ISO local manquant"
        : draft.lxcTemplate || "Template manquant",
    },
  ];
  const stageChecklist = (() => {
    if (wizardStep === "base") {
      return [
        !draft.node.trim() ? "Choisir le nœud Proxmox" : null,
        !draft.vmid.trim() ? "Définir le VMID" : null,
        vmidConflict ? "Corriger le VMID déjà utilisé" : null,
        !draft.name.trim() ? `Renseigner le nom de ${isQemu ? "la VM" : "du conteneur"}` : null,
      ].filter((item): item is string => Boolean(item));
    }

    if (wizardStep === "resources") {
      return [
        !draft.storage.trim() ? "Sélectionner le stockage principal" : null,
        !draft.memoryMiB.trim() ? "Renseigner la RAM" : null,
        !draft.cores.trim() ? "Renseigner les vCPU" : null,
        !draft.diskGb.trim() ? "Renseigner la taille disque" : null,
      ].filter((item): item is string => Boolean(item));
    }

    if (wizardStep === "os") {
      return [
        isQemu && !draft.ostype.trim() ? "Choisir le type d’OS invité" : null,
        isQemu && draft.isoSourceMode === "existing" && !draft.isoVolume.trim() ? "Sélectionner un ISO local" : null,
        isQemu && draft.isoSourceMode === "url" && !draft.isoUrl.trim() ? "Renseigner l’URL ISO" : null,
        isQemu && draft.isoSourceMode === "url" && draft.isoUrl.trim() && !isIsoUrlCandidate(draft.isoUrl)
          ? "Vérifier le format de l’URL ISO"
          : null,
        isQemu && draft.isoSourceMode === "url" && !draft.isoStorage.trim() ? "Choisir le stockage ISO cible" : null,
        !isQemu && !draft.lxcTemplate.trim() ? "Renseigner le template LXC" : null,
      ].filter((item): item is string => Boolean(item));
    }

    if (wizardStep === "advanced") {
      return tpmUnsupported ? ["TPM indisponible tant que le firmware n’est pas en OVMF."] : [];
    }

    return missingRequired ? ["Compléter les champs requis avant la création."] : [];
  })();
  const stageReadyMessage = stepStatus[wizardStep]
    ? wizardStep === "review"
      ? "Le brouillon est cohérent. Tu peux lancer la création."
      : "Cette étape est cohérente. Tu peux continuer."
    : "Complète les points ci-dessous pour avancer sans erreur.";

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

      <section className="panel provision-panel provision-panel-compact provision-master-panel">
        <div className="panel-head">
          <h2>Wizard de création</h2>
          {!options?.configured ? <span className="muted">Connexion requise</span> : null}
        </div>

        <div className="provision-stage-hero">
          <div className="provision-stage-hero-grid">
            <div className="provision-stage-main">
              <div className="provision-stage-head">
                <div className="provision-stage-copy">
                  <span className="eyebrow">Parcours guidé</span>
                  <strong>
                    Étape {currentWizardIndex + 1}/{wizardSteps.length} • {activeWizardStep.label}
                  </strong>
                  <small>{activeWizardStep.hint}. Le reste reste accessible sans casser le flux.</small>
                </div>
                <span className={`pill${options?.configured ? " live" : ""}`}>
                  {options?.configured ? "Proxmox connecté" : "Configuration requise"}
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
                  <button
                    type="button"
                    className="inventory-mini-toggle"
                    onClick={() => window.location.reload()}
                  >
                    Actualiser les options
                  </button>
                </div>
              </div>

              {isLoadingOptions ? (
                <div className="inline-loader" role="status" aria-live="polite">
                  <span className="inline-loader-dots" aria-hidden="true">
                    <span />
                  </span>
                  <span className="inline-loader-label">Chargement des options de création</span>
                </div>
              ) : null}

              {optionsError ? <p className="warning">{optionsError}</p> : null}

              {!options?.configured ? (
                <div className="hint-box">
                  <p className="muted">
                    Connexion Proxmox requise pour créer. Ouvre{" "}
                    <Link href="/settings?tab=proxmox">Paramètres → Proxmox</Link>.
                  </p>
                </div>
              ) : null}

              {options?.configured ? (
                <section className="provision-overview-strip" aria-label="Résumé des options disponibles">
                  <article className="provision-overview-chip">
                    <span>Nœuds</span>
                    <strong>{nodeOptions.length}</strong>
                  </article>
                  <article className="provision-overview-chip">
                    <span>Stockages</span>
                    <strong>{storageOptions.length}</strong>
                  </article>
                  {isQemu ? (
                    <article className="provision-overview-chip">
                      <span>ISO</span>
                      <strong>{isoVolumeOptions.length}</strong>
                    </article>
                  ) : (
                    <article className="provision-overview-chip">
                      <span>Bridges</span>
                      <strong>{bridgeOptions.length || "0"}</strong>
                    </article>
                  )}
                </section>
              ) : null}

              <section className="provision-stepper" aria-label="Étapes de création">
                {wizardSteps.map((step, index) => {
                  const isActive = step.id === wizardStep;
                  const isDone = stepStatus[step.id];
                  return (
                    <button
                      key={step.id}
                      type="button"
                      className={`provision-step${isActive ? " is-active" : ""}${isDone ? " is-done" : ""}`}
                      onClick={() => setWizardStep(step.id)}
                    >
                      <span className="provision-step-index">{index + 1}</span>
                      <span className="provision-step-copy">
                        <strong>{step.label}</strong>
                        <small>{step.hint}</small>
                      </span>
                    </button>
                  );
                })}
              </section>
            </div>

            <aside className="provision-stage-aside">
              <section className="hint-box provision-stage-summary">
                <div className="item-title">Résumé courant</div>
                <div className="stack-sm">
                  {stageSummaryRows.map((row) => (
                    <div key={row.label} className="row-line">
                      <span>{row.label}</span>
                      <strong>{row.value}</strong>
                    </div>
                  ))}
                </div>
              </section>

              <section className="hint-box provision-stage-summary">
                <div className="item-title">{stepStatus[wizardStep] ? "Étape prête" : "À compléter"}</div>
                <div className="item-subtitle">{stageReadyMessage}</div>
                {stageChecklist.length > 0 ? (
                  <ul className="provision-stage-checklist">
                    {stageChecklist.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                ) : (
                  <div className="backup-target-meta">
                    <span className="inventory-badge status-running">Validation OK</span>
                    <span className="inventory-badge status-template">{activeWizardStep.label}</span>
                  </div>
                )}
              </section>
            </aside>
          </div>
        </div>

        {wizardStep === "base" ? (
          <section className="provision-step-panel">
            <div className="panel-head">
              <h3>Identité</h3>
              <span className="muted">Type, nœud cible et identité de la ressource.</span>
            </div>
            <div className="provision-grid provision-step-grid">
              <FieldRow label="Nœud">
                <SelectInput
                  value={draft.node}
                  onChange={(value) => patchDraft({ node: value })}
                  options={nodeOptions}
                  placeholder="Choisir un nœud"
                />
              </FieldRow>

              <FieldRow
                label="VMID"
                hint={
                  vmidInvalid
                    ? "VMID invalide."
                    : vmidConflict
                      ? "VMID déjà utilisé, choisis un autre identifiant."
                      : options?.options.nextVmid
                        ? `Prochain suggéré: ${options.options.nextVmid}`
                        : undefined
                }
              >
                <div className="provision-inline-split provision-inline-vmid">
                  <input
                    className={`provision-input${vmidConflict || vmidInvalid ? " is-invalid" : ""}`}
                    value={draft.vmid}
                    onChange={(event) => patchDraft({ vmid: event.target.value })}
                    inputMode="numeric"
                    placeholder="100"
                    aria-invalid={vmidConflict || vmidInvalid}
                  />
                  <button
                    type="button"
                    className="inventory-mini-toggle"
                    onClick={() => {
                      if (!options?.options.nextVmid) return;
                      patchDraft({ vmid: String(options.options.nextVmid) });
                    }}
                    disabled={!options?.options.nextVmid}
                  >
                    Auto VMID
                  </button>
                </div>
              </FieldRow>

              <FieldRow label={isQemu ? "Nom de la VM" : "Nom du conteneur"}>
                <input
                  className="provision-input"
                  value={draft.name}
                  onChange={(event) => patchDraft({ name: event.target.value })}
                  placeholder={isQemu ? "win-server-prod" : "debian-app-01"}
                />
              </FieldRow>

              <section className="hint-box provision-summary-card provision-field-span-full">
                <div className="row-line">
                  <span>Type</span>
                  <strong>{isQemu ? "VM QEMU" : "Conteneur LXC"}</strong>
                </div>
                <div className="row-line">
                  <span>Résumé</span>
                  <strong>
                    {draft.node || "Nœud à choisir"} • {draft.vmid || "VMID à définir"} • {draft.name || "Nom à définir"}
                  </strong>
                </div>
              </section>
            </div>
          </section>
        ) : null}

        {wizardStep === "resources" ? (
          <section className="provision-step-panel">
            <div className="panel-head">
              <h3>Capacité</h3>
              <span className="muted">Stockage principal, réseau et taille de la machine.</span>
            </div>
            <div className="provision-grid provision-step-grid">
              <FieldRow label="Stockage principal">
                <SelectInput
                  value={draft.storage}
                  onChange={(value) => patchDraft({ storage: value })}
                  options={storageOptions}
                  placeholder={
                    storageOptions.length > 0
                      ? isQemu
                        ? "Choisir un stockage VM"
                        : "Choisir un stockage CT"
                      : "Aucun stockage compatible"
                  }
                />
              </FieldRow>

              <FieldRow label="Bridge réseau" hint="Optionnel">
                <SelectInput
                  value={draft.bridge}
                  onChange={(value) => patchDraft({ bridge: value })}
                  options={bridgeOptions}
                  placeholder={bridgeOptions.length === 1 ? "Bridge auto" : "Aucun bridge"}
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

              <FieldRow label="vCPU / cœurs">
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

              <section className="hint-box provision-summary-card provision-field-span-full">
                <div className="row-line">
                  <span>Ressources</span>
                  <strong>
                    {draft.cores || "0"} vCPU • {draft.memoryMiB || "0"} MiB • {draft.diskGb || "0"} Go
                  </strong>
                </div>
                <div className="row-line">
                  <span>Réseau / stockage</span>
                  <strong>{draft.bridge || "Sans réseau"} • {draft.storage || "Stockage à choisir"}</strong>
                </div>
              </section>
            </div>
          </section>
        ) : null}

        {wizardStep === "os" ? (
          <section className="provision-step-panel">
            <div className="panel-head">
              <h3>Système</h3>
              <span className="muted">
                {isQemu ? "Choisis l’OS invité, la source ISO et le média de démarrage." : "Choisis le template et l’accès initial."}
              </span>
            </div>
            <div className="provision-grid provision-step-grid">
              {isQemu ? (
                <>
                  <FieldRow label="Type d’OS invité" hint="Valeur libre acceptée. Ex: l26, win11, w2k22">
                    <>
                      <input
                        className="provision-input"
                        value={draft.ostype}
                        onChange={(event) => {
                          setOstypeTouched(true);
                          patchDraft({ ostype: event.target.value });
                        }}
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

                  <div className="provision-media-block provision-field-span-full">
                    <FieldRow label="Source ISO">
                      <div className="provision-segment">
                        <button
                          type="button"
                          className={`provision-seg-btn${draft.isoSourceMode === "existing" ? " is-active" : ""}`}
                          onClick={() => patchDraft({ isoSourceMode: "existing" })}
                        >
                          ISO local
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
                      <FieldRow
                        label="ISO local"
                        hint={
                          isoVolumeOptions.length > 0
                            ? `${isoVolumeOptions.length} ISO détecté(s)${draft.node ? ` sur ${draft.node}` : ""}`
                            : draft.node
                              ? `Aucun ISO détecté sur ${draft.node}.`
                              : "Aucun ISO détecté, saisis un volume manuellement."
                        }
                      >
                        <SelectInput
                          value={draft.isoVolume}
                          onChange={(value) => patchDraft({ isoVolume: value })}
                          options={isoVolumeOptions}
                          placeholder={isoVolumeOptions.length > 0 ? "Sélectionner un ISO local" : "Aucun ISO détecté"}
                        />
                        {isoVolumeOptions.length === 0 ? (
                          <input
                            className="provision-input"
                            value={draft.isoVolume}
                            onChange={(event) => patchDraft({ isoVolume: event.target.value })}
                            placeholder="local:iso/WinServer2022.iso"
                          />
                        ) : null}
                      </FieldRow>
                    ) : (
                      <div className="provision-media-grid">
                        <FieldRow
                          label="URL du fichier ISO"
                          hint="HTTPS direct, sans query, terminée par .iso"
                          className="provision-field-span-full"
                        >
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

                        <FieldRow label="Nom du fichier ISO" hint="Optionnel, extension .iso obligatoire">
                          <input
                            className="provision-input"
                            value={draft.isoFilename}
                            onChange={(event) => patchDraft({ isoFilename: event.target.value })}
                            placeholder="windows-server-2022.iso"
                          />
                        </FieldRow>

                        {draft.isoUrl.trim() && !isIsoUrlCandidate(draft.isoUrl) ? (
                          <p className="provision-inline-hint warning-text provision-field-span-full">
                            URL refusée: seuls les liens HTTPS directs, sans querystring, vers un fichier se terminant par <code>.iso</code> sont acceptés.
                          </p>
                        ) : null}
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <>
                  <FieldRow label="Template LXC" hint="Volume Proxmox type `vztmpl`">
                    <input
                      className="provision-input"
                      value={draft.lxcTemplate}
                      onChange={(event) => patchDraft({ lxcTemplate: event.target.value })}
                      placeholder="local:vztmpl/debian-12-standard_12.x_amd64.tar.zst"
                    />
                  </FieldRow>

                  <FieldRow label="Mot de passe root" hint="Optionnel">
                    <input
                      className="provision-input"
                      type="password"
                      value={draft.lxcPassword}
                      onChange={(event) => patchDraft({ lxcPassword: event.target.value })}
                      placeholder="Laisse vide si tu fournis ensuite SSH/console"
                    />
                  </FieldRow>
                </>
              )}
            </div>
          </section>
        ) : null}

        {wizardStep === "advanced" ? (
          <section className="provision-step-panel">
            <div className="panel-head">
              <h3>Options avancées</h3>
              <span className="muted">Firmware, agent invité et réglages système.</span>
            </div>
            <div className="provision-grid provision-step-grid">
              {isQemu ? (
                <>
                  <FieldRow label="Type CPU">
                    <input
                      className="provision-input"
                      value={draft.cpuType}
                      onChange={(event) => patchDraft({ cpuType: event.target.value })}
                      placeholder="host ou x86-64-v2-AES"
                    />
                  </FieldRow>

                  <FieldRow label="Firmware de la VM">
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
                        disabled={draft.bios === "ovmf"}
                        onChange={(event) =>
                          patchDraft({ machine: event.target.value as ProvisionDraft["machine"] })
                        }
                      >
                        <option value="q35">Q35</option>
                        <option value="i440fx">i440fx</option>
                      </select>
                    </div>
                  </FieldRow>

                  <div className="provision-field">
                    <span className="provision-field-label">Agent invité QEMU</span>
                    <div className="provision-segment">
                      <button
                        type="button"
                        className={`provision-seg-btn${draft.enableAgent ? " is-active" : ""}`}
                        onClick={() => patchDraft({ enableAgent: true })}
                      >
                        Activé
                      </button>
                      <button
                        type="button"
                        className={`provision-seg-btn${!draft.enableAgent ? " is-active" : ""}`}
                        onClick={() => patchDraft({ enableAgent: false })}
                      >
                        Désactivé
                      </button>
                    </div>
                  </div>

                  <div className="provision-field">
                    <span className="provision-field-label">TPM</span>
                    <div className="provision-segment">
                      <button
                        type="button"
                        className={`provision-seg-btn${draft.enableTpm ? " is-active" : ""}`}
                        onClick={() => patchDraft({ enableTpm: true })}
                        disabled={tpmUnsupported}
                      >
                        Activé
                      </button>
                      <button
                        type="button"
                        className={`provision-seg-btn${!draft.enableTpm ? " is-active" : ""}`}
                        onClick={() => patchDraft({ enableTpm: false })}
                      >
                        Désactivé
                      </button>
                    </div>
                  </div>
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
          </section>
        ) : null}

        {wizardStep === "review" ? (
          <section className="provision-step-panel">
            <div className="panel-head">
              <h3>Résumé final</h3>
              <span className="muted">Dernière vérification avant la création côté Proxmox.</span>
            </div>
            <div className="content-grid">
              <section className="hint-box provision-summary-card">
                <div className="row-line">
                  <span>Type</span>
                  <strong>{isQemu ? "VM QEMU" : "Conteneur LXC"}</strong>
                </div>
                <div className="row-line">
                  <span>Identité</span>
                  <strong>{draft.name || "Nom manquant"} • #{draft.vmid || "?"}</strong>
                </div>
                <div className="row-line">
                  <span>Nœud</span>
                  <strong>{draft.node || "À choisir"}</strong>
                </div>
                <div className="row-line">
                  <span>Stockage</span>
                  <strong>{draft.storage || "À choisir"}</strong>
                </div>
              </section>

              <section className="hint-box provision-summary-card">
                <div className="row-line">
                  <span>Ressources</span>
                  <strong>{draft.cores || "0"} vCPU • {draft.memoryMiB || "0"} MiB • {draft.diskGb || "0"} Go</strong>
                </div>
                <div className="row-line">
                  <span>Réseau</span>
                  <strong>{draft.bridge || "Aucun bridge"}</strong>
                </div>
                <div className="row-line">
                  <span>OS</span>
                  <strong>{isQemu ? draft.ostype || "À définir" : draft.lxcTemplate || "Template manquant"}</strong>
                </div>
                <div className="row-line">
                  <span>Média</span>
                  <strong>
                    {isQemu
                      ? draft.isoSourceMode === "existing"
                        ? draft.isoVolume || "ISO local manquant"
                        : draft.isoUrl || "URL ISO manquante"
                      : draft.lxcPassword
                        ? "Mot de passe root défini"
                        : "Mot de passe root vide"}
                  </strong>
                </div>
              </section>
            </div>
          </section>
        ) : null}

        {isQemu && draft.isoSourceMode === "url" && isoStorageOptions.length === 0 ? (
          <p className="warning">
            Aucun stockage Proxmox avec contenu `iso` détecté. Ajoute un datastore ISO avant
            d’utiliser le téléchargement par URL.
          </p>
        ) : null}

        {isQemu && tpmUnsupported ? (
          <p className="muted">
            TPM n’est disponible qu’en mode OVMF (UEFI). Il est désactivé automatiquement avec
            SeaBIOS.
          </p>
        ) : null}

        <div className="provision-actions">
          <button
            type="button"
            className="action-btn"
            onClick={() => setWizardStep(wizardSteps[Math.max(0, currentWizardIndex - 1)]?.id ?? "base")}
            disabled={currentWizardIndex <= 0 || isCreating}
          >
            Étape précédente
          </button>
          {wizardStep !== "review" ? (
            <button
              type="button"
              className="action-btn primary"
              onClick={() => setWizardStep(wizardSteps[Math.min(wizardSteps.length - 1, currentWizardIndex + 1)]?.id ?? "review")}
              disabled={!canMoveNext}
            >
              Étape suivante
            </button>
          ) : (
            <button
              type="button"
              className="action-btn primary"
              onClick={() => {
                startTransition(() => {
                  if (isQemu && draft.isoSourceMode === "url" && draft.isoUrl.trim()) {
                    setImportConfirmOpen(true);
                    return;
                  }
                  void createWorkload();
                });
              }}
              disabled={!canCreate || missingRequired}
            >
              {isCreating ? "Création..." : `Créer ${isQemu ? "la VM" : "le LXC"}`}
            </button>
          )}
          {vmidConflict ? (
            <span className="warning">VMID déjà utilisé.</span>
          ) : missingRequired ? (
            <span className="muted">
              {wizardStep === "review"
                ? "Complète les champs requis pour activer la création."
                : "Termine cette étape pour passer à la suivante."}
            </span>
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

        <StrongConfirmDialog
          key={importConfirmOpen ? "import-iso-open" : "import-iso-closed"}
          open={importConfirmOpen}
          title="Confirmer l’import ISO"
          message="Cette action déclenche un téléchargement ISO côté Proxmox avant la création de la VM."
          expectedText="IMPORT ISO"
          confirmLabel="Importer puis créer"
          busy={isCreating}
          onCancel={() => setImportConfirmOpen(false)}
          onConfirm={(confirmationText) => {
            setImportConfirmOpen(false);
            startTransition(() => {
              void createWorkload(confirmationText);
            });
          }}
        />
      </section>
    </div>
  );
}
