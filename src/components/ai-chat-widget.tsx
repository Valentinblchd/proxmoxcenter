"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { hasRuntimeCapability, type RuntimeAuthUserRole } from "@/lib/auth/rbac";
import type {
  AssistantGuidedMode,
  ProvisionDraft,
  ProvisionKind,
  WorkloadPowerAction,
} from "@/lib/provision/schema";

type WorkloadActionDraft = {
  action?: WorkloadPowerAction;
  kind?: ProvisionKind;
  node?: string;
  vmid?: string;
};

type AssistantApiResponse = {
  ok: boolean;
  intent?: "create-workload" | "workload-action" | "unknown";
  message?: string;
  draft?: Partial<ProvisionDraft>;
  suggestedKind?: ProvisionKind;
  followUps?: string[];
  guidedModes?: AssistantGuidedMode[];
  guidedAutoStart?: AssistantGuidedMode;
  actionDraft?: WorkloadActionDraft;
  actionReady?: boolean;
  error?: string;
};

type WorkloadActionRequest = {
  action: WorkloadPowerAction;
  kind: ProvisionKind;
  node: string;
  vmid: number;
};

type WorkloadActionApiResponse = {
  ok?: boolean;
  error?: string;
  upid?: string;
  message?: string;
  node?: string;
  kind?: string;
  action?: string;
  vmid?: number;
};

type ChatMessage = {
  id: string;
  role: "assistant" | "user" | "system";
  text: string;
  followUps?: string[];
  guidedModes?: GuidedFlowMode[];
  actionHref?: string;
  actionLabel?: string;
  actionRequest?: WorkloadActionRequest;
};

type ProvisionOptionsResponse = {
  ok: boolean;
  options?: {
    nodes: string[];
    storages: Array<{ name: string }>;
    bridges: string[];
  };
  error?: string;
};

type GuidedFlowMode = AssistantGuidedMode;
type GuidedVmidMode = "auto" | "manual";

type GuidedProvisionForm = {
  mode: GuidedFlowMode;
  version: string;
  customVersion: string;
  name: string;
  node: string;
  vmidMode: GuidedVmidMode;
  vmid: string;
  storage: string;
  bridge: string;
  cores: string;
  memoryGiB: string;
  diskGb: string;
  isoVolume: string;
  lxcTemplate: string;
};

const AI_WIDGET_STATE_KEY = "proxcenter_ai_widget_state_v1";
const AI_WIDGET_SHORTCUTS_KEY = "proxcenter_ai_shortcuts_v1";
const MAX_ASSISTANT_PROMPT_CHARS = 1600;
const MAX_DYNAMIC_SHORTCUTS = 4;

type DynamicShortcutKind = "guided";

type DynamicShortcut = {
  id: string;
  label: string;
  kind: DynamicShortcutKind;
  mode: GuidedFlowMode;
  count: number;
  lastUsedAt: number;
};

const WINDOWS_VERSION_OPTIONS = [
  "Windows Server 2025",
  "Windows Server 2022",
  "Windows Server 2019",
  "Windows 11",
  "Windows 10",
];

const LINUX_VM_VERSION_OPTIONS = [
  "Debian 12",
  "Ubuntu 24.04",
  "Ubuntu 22.04",
  "Rocky Linux 9",
  "AlmaLinux 9",
  "Fedora 41",
  "OpenSUSE Leap 15.6",
];

const DEBIAN_VERSION_OPTIONS = ["Debian 13", "Debian 12", "Debian 11"];

const DEFAULT_GUIDED_MODES: GuidedFlowMode[] = ["windows-vm", "linux-vm", "debian-lxc"];

function makeId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function getInitialMessages(): ChatMessage[] {
  return [
    {
      id: makeId("hello"),
      role: "assistant",
      text: "Je suis là. On peut discuter un peu, préparer une création pas à pas, ou piloter une VM/CT.",
    },
  ];
}

function getProvisionQuickLink(data: AssistantApiResponse) {
  if (data.intent !== "create-workload") return null;
  const params = new URLSearchParams();
  if (data.suggestedKind) params.set("kind", data.suggestedKind);
  const search = params.toString();
  return search ? `/provision?${search}` : "/provision";
}

function asPowerAction(value: unknown): WorkloadPowerAction | null {
  if (value === "start" || value === "stop" || value === "shutdown" || value === "reboot") {
    return value;
  }
  return null;
}

function asKind(value: unknown): ProvisionKind | null {
  return value === "qemu" || value === "lxc" ? value : null;
}

function asNode(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 63) return null;
  return trimmed;
}

function asVmid(value: unknown) {
  if (typeof value !== "string") return null;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 9_999_999) return null;
  return parsed;
}

function getActionRequest(data: AssistantApiResponse): WorkloadActionRequest | null {
  if (data.intent !== "workload-action") return null;
  const draft = data.actionDraft;
  const action = asPowerAction(draft?.action);
  const kind = asKind(draft?.kind);
  const node = asNode(draft?.node);
  const vmid = asVmid(draft?.vmid);
  if (!action || !kind || !node || vmid === null) return null;
  return { action, kind, node, vmid };
}

function getActionFallbackLink(data: AssistantApiResponse) {
  if (data.intent !== "workload-action") return null;
  const vmid = data.actionDraft?.vmid?.trim();
  if (vmid) {
    return `/inventory?q=${encodeURIComponent(vmid)}`;
  }
  return "/inventory";
}

function getGenericQuickLink(data: AssistantApiResponse) {
  return getProvisionQuickLink(data) ?? getActionFallbackLink(data);
}

function getGuidedModes(data: AssistantApiResponse): GuidedFlowMode[] {
  return (data.guidedModes ?? []).filter(
    (mode): mode is GuidedFlowMode =>
      mode === "windows-vm" || mode === "linux-vm" || mode === "debian-lxc",
  );
}

function createGuidedForm(mode: GuidedFlowMode): GuidedProvisionForm {
  return {
    mode,
    version: "",
    customVersion: "",
    name: "",
    node: "",
    vmidMode: "auto",
    vmid: "",
    storage: "",
    bridge: "",
    cores: "",
    memoryGiB: "",
    diskGb: "",
    isoVolume: "",
    lxcTemplate: "",
  };
}

function applyGuidedProvisionDefaults(
  form: GuidedProvisionForm,
  options: ProvisionOptionsResponse["options"],
) {
  if (!options) return form;
  return {
    ...form,
    node: form.node.trim() || (options.nodes.length === 1 ? options.nodes[0] : form.node),
    storage:
      form.storage.trim() ||
      (options.storages.length === 1 ? options.storages[0]?.name ?? form.storage : form.storage),
    bridge: form.bridge.trim() || (options.bridges.length === 1 ? options.bridges[0] : form.bridge),
  };
}

function getGuidedModeLabel(mode: GuidedFlowMode) {
  if (mode === "windows-vm") return "VM Windows";
  if (mode === "linux-vm") return "VM Linux";
  return "LXC Debian";
}

function getGuidedQuestionnaireLabel(mode: GuidedFlowMode) {
  if (mode === "windows-vm") return "Questionnaire VM Windows";
  if (mode === "linux-vm") return "Questionnaire VM Linux";
  return "Questionnaire LXC Debian";
}

function resolveVersionValue(form: GuidedProvisionForm) {
  if (form.version === "__custom__") return form.customVersion.trim();
  return form.version.trim();
}

function isPositiveIntegerString(value: string) {
  if (!value.trim()) return false;
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0;
}

function buildGuidedPrompt(form: GuidedProvisionForm) {
  const version = resolveVersionValue(form);
  const commonParts = [
    `nom ${form.name.trim()}`,
    `node ${form.node.trim()}`,
    form.vmidMode === "manual" && form.vmid.trim() ? `vmid ${form.vmid.trim()}` : "",
    `${form.cores.trim()} vCPU`,
    `${form.memoryGiB.trim()} Go RAM`,
    `${form.diskGb.trim()} Go disque`,
    `storage ${form.storage.trim()}`,
    form.bridge.trim() ? `bridge ${form.bridge.trim()}` : "",
  ].filter(Boolean);

  if (form.mode === "windows-vm") {
    return [
      `Crée une VM Windows version ${version}`,
      ...commonParts,
      form.isoVolume.trim()
        ? /^https?:\/\//i.test(form.isoVolume.trim())
          ? `url iso ${form.isoVolume.trim()}`
          : `iso ${form.isoVolume.trim()}`
        : "",
    ]
      .filter(Boolean)
      .join(", ");
  }

  if (form.mode === "linux-vm") {
    return [
      `Crée une VM Linux version ${version}`,
      ...commonParts,
      form.isoVolume.trim()
        ? /^https?:\/\//i.test(form.isoVolume.trim())
          ? `url iso ${form.isoVolume.trim()}`
          : `iso ${form.isoVolume.trim()}`
        : "",
    ]
      .filter(Boolean)
      .join(", ");
  }

  return [
    `Crée un conteneur Debian LXC version ${version}`,
    ...commonParts,
    form.lxcTemplate.trim() ? `template ${form.lxcTemplate.trim()}` : "",
  ]
    .filter(Boolean)
    .join(", ");
}

function getShortcutLabel(mode: GuidedFlowMode) {
  if (mode === "windows-vm") return "Créer VM Windows";
  if (mode === "linux-vm") return "Créer VM Linux";
  return "Créer LXC Debian";
}

function getShortcutId(mode: GuidedFlowMode) {
  return `guided:${mode}`;
}

function parseShortcutStorage(raw: string | null): DynamicShortcut[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as { shortcuts?: unknown };
    if (!Array.isArray(parsed.shortcuts)) return [];
    return parsed.shortcuts
      .map((entry) => {
        if (!entry || typeof entry !== "object") return null;
        const item = entry as Partial<DynamicShortcut>;
        if (item.kind !== "guided") return null;
        if (item.mode !== "windows-vm" && item.mode !== "linux-vm" && item.mode !== "debian-lxc") return null;
        if (typeof item.id !== "string" || !item.id.trim()) return null;
        if (typeof item.label !== "string" || !item.label.trim()) return null;
        const count = Number.isInteger(item.count) && (item.count ?? 0) > 0 ? (item.count as number) : 1;
        const lastUsedAt =
          Number.isFinite(item.lastUsedAt) && (item.lastUsedAt as number) > 0
            ? (item.lastUsedAt as number)
            : Date.now();
        return {
          id: item.id,
          label: item.label,
          kind: "guided",
          mode: item.mode,
          count,
          lastUsedAt,
        } satisfies DynamicShortcut;
      })
      .filter((item): item is DynamicShortcut => Boolean(item))
      .sort((a, b) => {
        const byCount = b.count - a.count;
        if (byCount !== 0) return byCount;
        return b.lastUsedAt - a.lastUsedAt;
      });
  } catch {
    return [];
  }
}

function inferGuidedShortcutFromPrompt(prompt: string): GuidedFlowMode | null {
  const normalized = prompt
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  const wantsCreate = /\b(cree|creer|create|creation|nouveau|nouvelle|provision)\b/.test(normalized);
  if (!wantsCreate) return null;

  const mentionsWindows = /\b(windows|win11|win10|server)\b/.test(normalized);
  if (mentionsWindows) return "windows-vm";

  const mentionsDebian = /\b(debian)\b/.test(normalized);
  const mentionsLxc = /\b(lxc|ct|conteneur|container)\b/.test(normalized);
  if (mentionsDebian && mentionsLxc) return "debian-lxc";

  const mentionsLinuxVm =
    /\b(linux|debian|ubuntu|rocky|alma|almalinux|fedora|opensuse|suse)\b/.test(normalized) &&
    /\b(vm|qemu|machine)\b/.test(normalized);
  if (mentionsLinuxVm) return "linux-vm";

  return null;
}

export default function AiChatWidget({ sessionRole }: { sessionRole: RuntimeAuthUserRole | null }) {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [actionBusyId, setActionBusyId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>(getInitialMessages);
  const [guidedFlow, setGuidedFlow] = useState<GuidedProvisionForm | null>(null);
  const [guidedStep, setGuidedStep] = useState(1);
  const [provisionOptions, setProvisionOptions] = useState<ProvisionOptionsResponse["options"] | null>(
    null,
  );
  const [dynamicShortcuts, setDynamicShortcuts] = useState<DynamicShortcut[]>([]);
  const [optionsLoading, setOptionsLoading] = useState(false);
  const [optionsError, setOptionsError] = useState<string | null>(null);
  const canOperate = hasRuntimeCapability(sessionRole, "operate");
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const canSend = input.trim().length > 0 && !isSending;
  const step1Valid = Boolean(
    guidedFlow && resolveVersionValue(guidedFlow) && guidedFlow.name.trim().length > 0,
  );
  const step2Valid = Boolean(
    guidedFlow &&
      guidedFlow.node.trim() &&
      guidedFlow.storage.trim() &&
      (guidedFlow.vmidMode === "auto" || isPositiveIntegerString(guidedFlow.vmid)),
  );
  const step3Valid = Boolean(
    guidedFlow &&
      isPositiveIntegerString(guidedFlow.cores) &&
      isPositiveIntegerString(guidedFlow.memoryGiB) &&
      isPositiveIntegerString(guidedFlow.diskGb),
  );
  const visibleShortcuts = dynamicShortcuts.slice(0, MAX_DYNAMIC_SHORTCUTS);
  const starterModes = DEFAULT_GUIDED_MODES.filter(
    (mode) => !visibleShortcuts.some((shortcut) => shortcut.mode === mode),
  );

  useEffect(() => {
    const container = bodyRef.current;
    if (!container) return;
    container.scrollTop = container.scrollHeight;
  }, [messages, open, guidedFlow, guidedStep]);

  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(AI_WIDGET_STATE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as { expanded?: unknown };
      if (typeof parsed.expanded === "boolean") {
        setExpanded(parsed.expanded);
      }
    } catch {
      // Ignore storage parsing errors.
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(AI_WIDGET_STATE_KEY, JSON.stringify({ expanded }));
    } catch {
      // Ignore storage write errors.
    }
  }, [expanded]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(AI_WIDGET_SHORTCUTS_KEY);
      setDynamicShortcuts(parseShortcutStorage(raw));
    } catch {
      setDynamicShortcuts([]);
    }
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && open) {
        setOpen(false);
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "i") {
        event.preventDefault();
        setOpen(true);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  const title = expanded ? "Assistant IA - Grand format" : "Assistant IA";

  function trackGuidedShortcutUsage(mode: GuidedFlowMode) {
    const id = getShortcutId(mode);
    const label = getShortcutLabel(mode);
    setDynamicShortcuts((current) => {
      const now = Date.now();
      const existing = current.find((item) => item.id === id);
      const next = existing
        ? current.map((item) =>
            item.id === id ? { ...item, count: item.count + 1, lastUsedAt: now, label } : item,
          )
        : [
            ...current,
            {
              id,
              label,
              kind: "guided",
              mode,
              count: 1,
              lastUsedAt: now,
            } satisfies DynamicShortcut,
          ];

      const sorted = [...next]
        .sort((a, b) => {
          const byCount = b.count - a.count;
          if (byCount !== 0) return byCount;
          return b.lastUsedAt - a.lastUsedAt;
        })
        .slice(0, 20);

      try {
        window.localStorage.setItem(AI_WIDGET_SHORTCUTS_KEY, JSON.stringify({ shortcuts: sorted }));
      } catch {
        // Ignore storage write errors.
      }
      return sorted;
    });
  }

  function resetGuidedFlow() {
    setGuidedFlow(null);
    setGuidedStep(1);
    setOptionsError(null);
  }

  function resetChat() {
    setMessages(getInitialMessages());
    setInput("");
    setActionBusyId(null);
    resetGuidedFlow();
  }

  function runDynamicShortcut(shortcut: DynamicShortcut) {
    if (shortcut.kind === "guided") {
      startGuidedFlow(shortcut.mode, true);
    }
  }

  function patchGuidedFlow(patch: Partial<GuidedProvisionForm>) {
    setGuidedFlow((current) => (current ? { ...current, ...patch } : current));
  }

  async function ensureProvisionOptions() {
    if (provisionOptions || optionsLoading) return;
    setOptionsLoading(true);
    setOptionsError(null);
    try {
      const response = await fetch("/api/provision/options", { cache: "no-store" });
      const data = (await response.json()) as ProvisionOptionsResponse;
      if (!response.ok || !data.ok) {
        throw new Error(data.error || "Options Proxmox indisponibles.");
      }
      const nextOptions = data.options ?? { nodes: [], storages: [], bridges: [] };
      setProvisionOptions(nextOptions);
      setGuidedFlow((current) => {
        if (!current) return current;
        return applyGuidedProvisionDefaults(current, nextOptions);
      });
    } catch (error) {
      setOptionsError(error instanceof Error ? error.message : "Erreur options.");
    } finally {
      setOptionsLoading(false);
    }
  }

  function startGuidedFlow(mode: GuidedFlowMode, shouldTrack = true) {
    if (!canOperate) {
      setMessages((current) => [
        ...current,
        {
          id: makeId("rbac"),
          role: "system",
          text: "Mode lecture: création et actions Proxmox bloquées.",
        },
      ]);
      return;
    }
    if (shouldTrack) {
      trackGuidedShortcutUsage(mode);
    }
    setGuidedFlow(
      provisionOptions ? applyGuidedProvisionDefaults(createGuidedForm(mode), provisionOptions) : createGuidedForm(mode),
    );
    setGuidedStep(1);
    setInput("");
    setMessages((current) => [
      ...current,
      {
        id: makeId("guide"),
        role: "assistant",
        text: `${getGuidedQuestionnaireLabel(mode)} lancé.`,
      },
    ]);
    if (!provisionOptions) {
      void ensureProvisionOptions();
    }
  }

  function handleGuidedChoice(mode: GuidedFlowMode) {
    startGuidedFlow(mode, true);
  }

  async function executeAction(message: ChatMessage) {
    if (!message.actionRequest || actionBusyId) return;
    if (!canOperate) {
      setMessages((current) => [
        ...current,
        {
          id: makeId("rbac-action"),
          role: "system",
          text: "Mode lecture: action refusée.",
        },
      ]);
      return;
    }

    const { action, kind, node, vmid } = message.actionRequest;
    let confirmationText: string | undefined;
    if (action === "stop" || action === "shutdown") {
      const expectedText = `${action.toUpperCase()} ${vmid}`;
      const typed = window.prompt(
        `Action sensible sur ${kind.toUpperCase()} #${vmid} (${node}). Tape exactement: ${expectedText}`,
        "",
      );
      if (!typed) return;
      confirmationText = typed;
    } else {
      const confirmed = window.confirm(
        `Confirmer ${action.toUpperCase()} sur ${kind.toUpperCase()} #${vmid} (${node}) ?`,
      );
      if (!confirmed) return;
    }

    setActionBusyId(message.id);
    try {
      const response = await fetch("/api/workloads/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ node, kind, vmid, action, confirmationText }),
      });
      const payload = (await response.json()) as WorkloadActionApiResponse;
      if (!response.ok || !payload.ok) {
        setMessages((current) => [
          ...current,
          {
            id: makeId("action-err"),
            role: "system",
            text: payload.error || "Action refusée.",
          },
        ]);
        return;
      }

      setMessages((current) => [
        ...current,
        {
          id: makeId("action-ok"),
          role: "assistant",
          text: payload.message || `Action ${action} envoyée pour ${kind}/${vmid}.`,
          followUps: payload.upid ? [`UPID: ${payload.upid}`] : undefined,
        },
      ]);
    } catch (error) {
      setMessages((current) => [
        ...current,
        {
          id: makeId("action-neterr"),
          role: "system",
          text: error instanceof Error ? error.message : "Erreur réseau action.",
        },
      ]);
    } finally {
      setActionBusyId(null);
    }
  }

  async function handleSend(
    promptOverride?: string,
    options?: { trackShortcut?: boolean },
  ) {
    const prompt = (promptOverride ?? input).trim();
    if (!prompt || isSending) return;
    const inferredShortcutMode = inferGuidedShortcutFromPrompt(prompt);
    if (options?.trackShortcut !== false && inferredShortcutMode) {
      trackGuidedShortcutUsage(inferredShortcutMode);
    }

    setMessages((current) => [
      ...current,
      {
        id: makeId("user"),
        role: "user",
        text: prompt,
      },
    ]);
    setInput("");
    setIsSending(true);

    try {
      const response = await fetch("/api/assistant/intent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });
      const data = (await response.json()) as AssistantApiResponse;

      if (!response.ok || !data.ok) {
        setMessages((current) => [
          ...current,
          {
            id: makeId("err"),
            role: "system",
            text: data.error || "Erreur assistant.",
          },
        ]);
        return;
      }

      const actionRequest = getActionRequest(data);
      const guidedModes = getGuidedModes(data);
      const shouldExposeQuickLink =
        guidedModes.length === 0 &&
        (Boolean(actionRequest) ||
          data.intent !== "create-workload" ||
          (data.followUps?.length ?? 0) === 0);
      const quickLink = shouldExposeQuickLink ? getGenericQuickLink(data) : null;
      const actionLabel = quickLink
        ? data.intent === "create-workload"
          ? "Ouvrir la création"
          : "Ouvrir inventaire"
        : "Ouvrir l’assistant complet";

      setMessages((current) => [
        ...current,
        {
          id: makeId("assistant"),
          role: "assistant",
          text: data.message || "Réponse reçue.",
          followUps: data.followUps,
          guidedModes,
          actionHref: actionRequest ? quickLink ?? "/inventory" : quickLink ?? undefined,
          actionLabel,
          actionRequest: actionRequest ?? undefined,
        },
      ]);
      if (canOperate && data.guidedAutoStart && guidedModes.includes(data.guidedAutoStart)) {
        startGuidedFlow(data.guidedAutoStart, false);
      }
    } catch (error) {
      setMessages((current) => [
        ...current,
        {
          id: makeId("neterr"),
          role: "system",
          text: error instanceof Error ? error.message : "Erreur réseau.",
        },
      ]);
    } finally {
      setIsSending(false);
    }
  }

  async function submitGuidedFlow() {
    if (!guidedFlow || !step1Valid || !step2Valid || !step3Valid) return;
    const prompt = buildGuidedPrompt(guidedFlow);
    resetGuidedFlow();
    await handleSend(prompt, { trackShortcut: false });
  }

  return (
    <div className={`ai-widget-root${open ? " is-open" : ""}`}>
      <button
        type="button"
        className={`ai-fab${open ? " is-hidden" : ""}`}
        aria-label="Ouvrir l’assistant IA"
        title="Assistant IA"
        onClick={() => {
          setOpen(true);
          setExpanded(false);
        }}
      >
        <span className="ai-fab-core" aria-hidden="true">
          IA
        </span>
      </button>

      {open ? (
        <>
          <button
            type="button"
            className="ai-widget-backdrop"
            aria-label="Fermer l’assistant IA"
            onClick={() => setOpen(false)}
            tabIndex={-1}
          />
          <section
            className={`ai-widget-panel${expanded ? " is-expanded" : ""}`}
            role="dialog"
            aria-label="Assistant IA"
            aria-modal="false"
          >
            <header className="ai-widget-head">
              <span className="ai-widget-drag-handle" aria-hidden="true" />
              <div className="ai-widget-title-wrap">
                <span className="ai-widget-badge" aria-hidden="true">
                  IA
                </span>
                <div className="ai-widget-title">
                  <strong>{title}</strong>
                  <small>Discussion + actions Proxmox guidées</small>
                </div>
              </div>

              <div className="ai-widget-head-actions">
                <button
                  type="button"
                  className="ai-widget-head-btn"
                  title="Nouveau chat"
                  aria-label="Nouveau chat"
                  onClick={resetChat}
                >
                  ↺
                </button>
                <button
                  type="button"
                  className="ai-widget-head-btn"
                  title={expanded ? "Réduire" : "Agrandir"}
                  aria-label={expanded ? "Réduire" : "Agrandir"}
                  onClick={() => setExpanded((current) => !current)}
                >
                  {expanded ? "▢" : "⛶"}
                </button>
                <button
                  type="button"
                  className="ai-widget-head-btn"
                  title="Fermer"
                  aria-label="Fermer"
                  onClick={() => setOpen(false)}
                >
                  ✕
                </button>
              </div>
            </header>

            <div className="ai-widget-body" ref={bodyRef}>
              <div className="ai-widget-chip-row">
                {!canOperate ? (
                  <span className="ai-widget-chip-empty">
                    Mode lecture: chat technique disponible, actions désactivées.
                  </span>
                ) : (
                  <>
                    {starterModes.map((mode) => (
                      <button
                        key={`starter-${mode}`}
                        type="button"
                        className="ai-widget-chip"
                        onClick={() => handleGuidedChoice(mode)}
                      >
                        {getShortcutLabel(mode)}
                      </button>
                    ))}
                    {visibleShortcuts.map((shortcut) => (
                      <button
                        key={shortcut.id}
                        type="button"
                        className="ai-widget-chip"
                        onClick={() => runDynamicShortcut(shortcut)}
                      >
                        {shortcut.label}
                      </button>
                    ))}
                    {visibleShortcuts.length === 0 ? (
                      <span className="ai-widget-chip-empty">
                        Tu peux aussi écrire simplement: création, backup, VLAN ou modifie une VM.
                      </span>
                    ) : null}
                  </>
                )}
              </div>

              {guidedFlow ? (
                <section className="ai-guide-card">
                  <div className="ai-guide-head">
                    <strong>{getGuidedQuestionnaireLabel(guidedFlow.mode)}</strong>
                    <span>Étape {guidedStep}/3</span>
                  </div>

                  {optionsLoading ? <p className="ai-guide-note">Chargement des options Proxmox...</p> : null}
                  {optionsError ? <p className="warning">{optionsError}</p> : null}

                  {guidedStep === 1 ? (
                    <div className="ai-guide-grid">
                      <label className="ai-guide-field">
                        <span>Version OS</span>
                        <select
                          className="ai-guide-input"
                          value={guidedFlow.version}
                          onChange={(event) =>
                            patchGuidedFlow({ version: event.target.value, customVersion: "" })
                          }
                        >
                          <option value="">Sélectionner</option>
                          {(guidedFlow.mode === "windows-vm"
                            ? WINDOWS_VERSION_OPTIONS
                            : guidedFlow.mode === "linux-vm"
                              ? LINUX_VM_VERSION_OPTIONS
                              : DEBIAN_VERSION_OPTIONS
                          ).map((option) => (
                            <option key={option} value={option}>
                              {option}
                            </option>
                          ))}
                          <option value="__custom__">Autre version</option>
                        </select>
                      </label>

                      {guidedFlow.version === "__custom__" ? (
                        <label className="ai-guide-field">
                          <span>Version personnalisée</span>
                          <input
                            className="ai-guide-input"
                            type="text"
                            value={guidedFlow.customVersion}
                            onChange={(event) =>
                              patchGuidedFlow({ customVersion: event.target.value })
                            }
                            placeholder="Ex: Windows Server 2016"
                          />
                        </label>
                      ) : null}

                      <label className="ai-guide-field">
                        <span>Nom instance</span>
                        <input
                          className="ai-guide-input"
                          type="text"
                          value={guidedFlow.name}
                          onChange={(event) => patchGuidedFlow({ name: event.target.value })}
                          placeholder={
                            guidedFlow.mode === "windows-vm"
                              ? "win-app-01"
                              : guidedFlow.mode === "linux-vm"
                                ? "linux-app-01"
                                : "debian-app-01"
                          }
                        />
                      </label>
                    </div>
                  ) : null}

                  {guidedStep === 2 ? (
                    <div className="ai-guide-grid">
                      <label className="ai-guide-field">
                        <span>Nœud Proxmox</span>
                        <input
                          className="ai-guide-input"
                          list="ai-guide-node-list"
                          value={guidedFlow.node}
                          onChange={(event) => patchGuidedFlow({ node: event.target.value })}
                          placeholder="pve1"
                        />
                        <datalist id="ai-guide-node-list">
                          {(provisionOptions?.nodes ?? []).map((item) => (
                            <option key={item} value={item} />
                          ))}
                        </datalist>
                      </label>

                      <div className="ai-guide-field">
                        <span>VMID</span>
                        <div className="ai-guide-inline">
                          <button
                            type="button"
                            className={`ai-guide-toggle${guidedFlow.vmidMode === "auto" ? " is-active" : ""}`}
                            onClick={() => patchGuidedFlow({ vmidMode: "auto", vmid: "" })}
                          >
                            Auto
                          </button>
                          <button
                            type="button"
                            className={`ai-guide-toggle${guidedFlow.vmidMode === "manual" ? " is-active" : ""}`}
                            onClick={() => patchGuidedFlow({ vmidMode: "manual" })}
                          >
                            Manuel
                          </button>
                        </div>
                        {guidedFlow.vmidMode === "manual" ? (
                          <input
                            className="ai-guide-input"
                            type="number"
                            min={1}
                            value={guidedFlow.vmid}
                            onChange={(event) => patchGuidedFlow({ vmid: event.target.value })}
                            placeholder="100"
                          />
                        ) : null}
                      </div>

                      <label className="ai-guide-field">
                        <span>Stockage</span>
                        <input
                          className="ai-guide-input"
                          list="ai-guide-storage-list"
                          value={guidedFlow.storage}
                          onChange={(event) => patchGuidedFlow({ storage: event.target.value })}
                          placeholder="local-lvm"
                        />
                        <datalist id="ai-guide-storage-list">
                          {(provisionOptions?.storages ?? []).map((item) => (
                            <option key={item.name} value={item.name} />
                          ))}
                        </datalist>
                      </label>

                      <label className="ai-guide-field">
                        <span>Bridge réseau (optionnel)</span>
                        <input
                          className="ai-guide-input"
                          list="ai-guide-bridge-list"
                          value={guidedFlow.bridge}
                          onChange={(event) => patchGuidedFlow({ bridge: event.target.value })}
                          placeholder="vmbr0 ou vide"
                        />
                        <datalist id="ai-guide-bridge-list">
                          {(provisionOptions?.bridges ?? []).map((item) => (
                            <option key={item} value={item} />
                          ))}
                        </datalist>
                      </label>
                    </div>
                  ) : null}

                  {guidedStep === 3 ? (
                    <div className="ai-guide-grid">
                      <label className="ai-guide-field">
                        <span>vCPU</span>
                        <input
                          className="ai-guide-input"
                          type="number"
                          min={1}
                          value={guidedFlow.cores}
                          onChange={(event) => patchGuidedFlow({ cores: event.target.value })}
                          placeholder="4"
                        />
                      </label>

                      <label className="ai-guide-field">
                        <span>RAM (Go)</span>
                        <input
                          className="ai-guide-input"
                          type="number"
                          min={1}
                          value={guidedFlow.memoryGiB}
                          onChange={(event) => patchGuidedFlow({ memoryGiB: event.target.value })}
                          placeholder="8"
                        />
                      </label>

                      <label className="ai-guide-field">
                        <span>Disque (Go)</span>
                        <input
                          className="ai-guide-input"
                          type="number"
                          min={1}
                          value={guidedFlow.diskGb}
                          onChange={(event) => patchGuidedFlow({ diskGb: event.target.value })}
                          placeholder="32"
                        />
                      </label>

                      {guidedFlow.mode !== "debian-lxc" ? (
                        <label className="ai-guide-field">
                          <span>ISO volume ou URL .iso (optionnel)</span>
                          <input
                            className="ai-guide-input"
                            type="text"
                            value={guidedFlow.isoVolume}
                            onChange={(event) => patchGuidedFlow({ isoVolume: event.target.value })}
                            placeholder={
                              guidedFlow.mode === "windows-vm"
                                ? "local:iso/Windows2022.iso ou https://.../Windows2022.iso"
                                : "local:iso/debian-12.iso ou https://.../debian-12.iso"
                            }
                          />
                        </label>
                      ) : (
                        <label className="ai-guide-field">
                          <span>Template LXC (optionnel)</span>
                          <input
                            className="ai-guide-input"
                            type="text"
                            value={guidedFlow.lxcTemplate}
                            onChange={(event) => patchGuidedFlow({ lxcTemplate: event.target.value })}
                            placeholder="local:vztmpl/debian-12-standard_12.2-1_amd64.tar.zst"
                          />
                        </label>
                      )}
                    </div>
                  ) : null}

                  <div className="ai-guide-actions">
                    <button type="button" className="action-btn" onClick={resetGuidedFlow}>
                      Annuler
                    </button>
                    {guidedStep > 1 ? (
                      <button
                        type="button"
                        className="action-btn"
                        onClick={() => setGuidedStep((current) => Math.max(1, current - 1))}
                      >
                        Précédent
                      </button>
                    ) : null}
                    {guidedStep < 3 ? (
                      <button
                        type="button"
                        className="action-btn primary"
                        disabled={(guidedStep === 1 && !step1Valid) || (guidedStep === 2 && !step2Valid)}
                        onClick={() => setGuidedStep((current) => Math.min(3, current + 1))}
                      >
                        Continuer
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="action-btn primary"
                        disabled={!step1Valid || !step2Valid || !step3Valid || isSending}
                        onClick={() => {
                          void submitGuidedFlow();
                        }}
                      >
                        Générer demande IA
                      </button>
                    )}
                  </div>
                </section>
              ) : null}

              <div className="ai-widget-messages" role="log" aria-live="polite">
                {messages.map((message) => (
                  <article key={message.id} className={`ai-msg ${message.role}`}>
                    <div className="ai-msg-meta">
                      {message.role === "assistant"
                        ? "IA"
                        : message.role === "user"
                          ? "Toi"
                          : "Système"}
                    </div>
                    <p>{message.text}</p>
                    {message.followUps?.length ? (
                      <ul className="ai-msg-list">
                        {message.followUps.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    ) : null}
                    {message.guidedModes?.length || message.actionHref || message.actionRequest ? (
                      <div className="ai-msg-actions">
                        {message.guidedModes?.map((mode) => (
                          <button
                            key={`${message.id}-${mode}`}
                            type="button"
                            className="ai-msg-action-btn"
                            onClick={() => handleGuidedChoice(mode)}
                          >
                            {getShortcutLabel(mode)}
                          </button>
                        ))}
                        {message.actionRequest ? (
                          <button
                            type="button"
                            className="ai-msg-action-btn"
                            onClick={() => {
                              void executeAction(message);
                            }}
                            disabled={actionBusyId !== null}
                          >
                            {actionBusyId === message.id ? "Exécution..." : "Exécuter action"}
                          </button>
                        ) : null}
                        {message.actionHref ? (
                          <Link href={message.actionHref} className="ai-msg-action-link">
                            {message.actionLabel ?? "Ouvrir"}
                          </Link>
                        ) : null}
                      </div>
                    ) : null}
                  </article>
                ))}
              </div>
            </div>

            <form
              className="ai-widget-inputbar"
              onSubmit={(event) => {
                event.preventDefault();
                void handleSend();
              }}
            >
              <input
                ref={inputRef}
                className="ai-widget-input"
                value={input}
                onChange={(event) => setInput(event.target.value)}
                maxLength={MAX_ASSISTANT_PROMPT_CHARS}
                placeholder="Parle-moi normalement ou demande une action Proxmox..."
                aria-label="Message à l'assistant IA"
              />
              <button type="submit" className="ai-widget-send" disabled={!canSend}>
                {isSending ? "..." : "Envoyer"}
              </button>
            </form>
          </section>
        </>
      ) : null}
    </div>
  );
}
