import { NextRequest, NextResponse } from "next/server";
import {
  rememberAssistantFirstName,
  rememberAssistantProvisionDraft,
  rememberAssistantQuestion,
  rememberAssistantWorkloadAction,
  type AssistantMemory,
} from "@/lib/assistant/memory";
import { AUTH_COOKIE_NAME, verifySessionToken } from "@/lib/auth/session";
import { hasRuntimeCapability } from "@/lib/auth/rbac";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { ensureSameOriginRequest, getClientIp } from "@/lib/security/request-guards";
import {
  buildPromptPreviewForAudit,
  evaluateAssistantPromptSafety,
} from "@/lib/security/assistant-guardrails";
import type {
  AssistantIntentResponse,
  ProvisionDraft,
  ProvisionKind,
  WorkloadPowerAction,
} from "@/lib/provision/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type IntentBody = {
  prompt?: unknown;
};

type SizeUnit = "m" | "g" | "t" | null;

type WorkloadContext = {
  kind: ProvisionKind;
  isWindows: boolean;
  isUbuntu: boolean;
  isDebian: boolean;
  isRocky: boolean;
  isAlma: boolean;
  isFedora: boolean;
  isOpenSuse: boolean;
};

type ParsedPowerAction = {
  action: WorkloadPowerAction;
  targetType: "vm" | "lxc" | "workload";
  vmid?: string;
  node?: string;
};

const ASSISTANT_INTENT_LIMIT = {
  windowMs: 60_000,
  max: 30,
  blockMs: 2 * 60_000,
} as const;

const ASSISTANT_UNSAFE_LIMIT = {
  windowMs: 10 * 60_000,
  max: 8,
  blockMs: 30 * 60_000,
} as const;

function normalizeText(value: string) {
  const normalized = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/[_/\\]+/g, " ")
    .replace(/-+/g, " ");

  let rewritten = ` ${normalized} `;
  const rewrites: Array<{ pattern: RegExp; value: string }> = [
    { pattern: /\bpr\b/g, value: " pour " },
    { pattern: /\b(?:srv|svr)\b/g, value: " serveur " },
    { pattern: /\bserver\b/g, value: " serveur " },
    { pattern: /\bwebserver\b/g, value: " serveur web " },
    { pattern: /\bfw\b/g, value: " firewall " },
    { pattern: /\bpare\s*feu\b/g, value: " firewall " },
    { pattern: /\b(?:regls|rgls)\b/g, value: " regles " },
  ];

  for (const rewrite of rewrites) {
    rewritten = rewritten.replace(rewrite.pattern, rewrite.value);
  }

  return rewritten.replace(/\s+/g, " ").trim();
}

function personalizeMessage(message: string, firstName: string | null) {
  if (!firstName) return message;
  return `${firstName}, ${message}`;
}

function extractDeclaredFirstName(promptRaw: string) {
  const patterns = [
    /(?:je\s*m['’]?\s*appelle|mon\s+prenom\s+est|prenom\s*[:=])\s+([A-Za-zÀ-ÿ' -]{2,40})/i,
    /(?:my\s+name\s+is|i\s+am)\s+([A-Za-zÀ-ÿ' -]{2,40})/i,
  ];

  for (const pattern of patterns) {
    const match = promptRaw.match(pattern);
    if (!match?.[1]) continue;
    const token = match[1].trim().split(/\s+/)[0];
    if (!token) continue;
    return token;
  }

  return null;
}

function wantsNameMemoryRecall(normalizedPrompt: string) {
  return /\b(quel est mon prenom|comment je m appelle|tu connais mon prenom|mon prenom)\b/i.test(
    normalizedPrompt,
  );
}

function wantsQuestionHistoryRecall(normalizedPrompt: string) {
  return /\b(dernieres questions|mes questions precedentes|historique des questions|last questions)\b/i.test(
    normalizedPrompt,
  );
}

function wantsParamsRecall(normalizedPrompt: string) {
  return /\b(derniers params|dernieres params|derniers parametres|last params|dernieres config)\b/i.test(
    normalizedPrompt,
  );
}

function summarizeLastParams(memory: AssistantMemory) {
  const parts: string[] = [];
  if (memory.lastProvisionDraft?.kind) parts.push(`type ${memory.lastProvisionDraft.kind.toUpperCase()}`);
  if (memory.lastProvisionDraft?.node) parts.push(`node ${memory.lastProvisionDraft.node}`);
  if (memory.lastProvisionDraft?.vmid) parts.push(`vmid ${memory.lastProvisionDraft.vmid}`);
  if (memory.lastProvisionDraft?.name) parts.push(`nom ${memory.lastProvisionDraft.name}`);
  if (memory.lastProvisionDraft?.storage) parts.push(`storage ${memory.lastProvisionDraft.storage}`);
  if (memory.lastProvisionDraft?.bridge) parts.push(`bridge ${memory.lastProvisionDraft.bridge}`);
  if (memory.lastProvisionDraft?.cores) parts.push(`${memory.lastProvisionDraft.cores} vCPU`);
  if (memory.lastProvisionDraft?.memoryMiB) {
    const ramGiB = Math.round(Number.parseInt(memory.lastProvisionDraft.memoryMiB, 10) / 1024);
    if (Number.isFinite(ramGiB) && ramGiB > 0) {
      parts.push(`${ramGiB} Go RAM`);
    }
  }
  if (memory.lastProvisionDraft?.diskGb) parts.push(`${memory.lastProvisionDraft.diskGb} Go disk`);
  return parts.length > 0 ? parts.join(", ") : null;
}

function buildMemoryRecallResponse(normalizedPrompt: string, memory: AssistantMemory): AssistantIntentResponse | null {
  if (wantsNameMemoryRecall(normalizedPrompt)) {
    return {
      ok: true,
      intent: "unknown",
      message: memory.firstName
        ? `Ton prénom mémorisé est: ${memory.firstName}.`
        : "Je n’ai pas encore ton prénom en mémoire. Tu peux dire: `Je m'appelle ...`.",
    };
  }

  if (wantsQuestionHistoryRecall(normalizedPrompt)) {
    const history = memory.lastQuestions.slice(-5);
    return {
      ok: true,
      intent: "unknown",
      message:
        history.length > 0
          ? "Dernières questions mémorisées."
          : "Aucune question mémorisée pour le moment.",
      followUps: history.length > 0 ? history.map((item, index) => `${index + 1}. ${item}`) : undefined,
    };
  }

  if (wantsParamsRecall(normalizedPrompt)) {
    const summary = summarizeLastParams(memory);
    return {
      ok: true,
      intent: "unknown",
      message: summary ? `Derniers paramètres: ${summary}.` : "Je n’ai pas encore de paramètres VM/LXC mémorisés.",
      followUps: memory.lastWorkloadAction
        ? [
            `Dernière action: ${memory.lastWorkloadAction.action} ${memory.lastWorkloadAction.kind.toUpperCase()} #${memory.lastWorkloadAction.vmid} sur ${memory.lastWorkloadAction.node}.`,
          ]
        : undefined,
    };
  }

  return null;
}

type SecurityWorkloadRole = "management" | "web" | "database" | "backup" | "application";

function inferRoleFromName(name: string | undefined) {
  if (!name) return null;
  const normalized = normalizeText(name);
  if (/(pve|proxmox|mgmt|admin|bastion|monitor)/i.test(normalized)) return "management";
  if (/(db|mysql|mariadb|postgres|pgsql|mongo|redis|sql)/i.test(normalized)) return "database";
  if (/(web|nginx|apache|proxy|front|wordpress)/i.test(normalized)) return "web";
  if (/(backup|pbs|vault|archive)/i.test(normalized)) return "backup";
  return null;
}

function inferSecurityWorkloadRole(
  normalizedPrompt: string,
  memory: AssistantMemory,
): SecurityWorkloadRole {
  if (/(proxmox|pve|hypervisor|node|noeud|admin|management|bastion)/i.test(normalizedPrompt)) {
    return "management";
  }
  if (/(mysql|mariadb|postgres|pgsql|mongo|redis|database|base de donnee|sql)/i.test(normalizedPrompt)) {
    return "database";
  }
  if (/(web|serveur web|web app|nginx|apache|reverse proxy|frontend|wordpress|http|https|waf)/i.test(normalizedPrompt)) {
    return "web";
  }
  if (/(backup|pbs|sauvegarde|replication)/i.test(normalizedPrompt)) {
    return "backup";
  }

  const fromMemoryName = inferRoleFromName(
    typeof memory.lastProvisionDraft?.name === "string" ? memory.lastProvisionDraft.name : undefined,
  );
  if (fromMemoryName) return fromMemoryName;

  return "application";
}

function buildVlanRecommendation(role: SecurityWorkloadRole) {
  if (role === "management") {
    return {
      vlan: "VLAN Management dédié (ex: VLAN 10)",
      firewall: "Autoriser seulement bastion/VPN admin -> SSH(22), Proxmox(8006). Bloquer le reste.",
      rationale:
        "Le plan de management est la surface la plus critique. Le séparer réduit fortement le risque de mouvement latéral.",
      risk: 84,
    };
  }

  if (role === "web") {
    return {
      vlan: "VLAN DMZ / Front (ex: VLAN 20)",
      firewall: "Entrant Internet strictement 80/443; sorties limitées vers backend requis.",
      rationale:
        "Les services web sont exposés. Une DMZ limite l’impact si un service est compromis.",
      risk: 72,
    };
  }

  if (role === "database") {
    return {
      vlan: "VLAN Data privé (ex: VLAN 30)",
      firewall: "Aucun accès Internet direct. Autoriser uniquement les VLAN applicatifs sur ports DB nécessaires.",
      rationale:
        "La base de données doit rester non exposée et accessible uniquement depuis les workloads autorisés.",
      risk: 79,
    };
  }

  if (role === "backup") {
    return {
      vlan: "VLAN Backup isolé (ex: VLAN 40)",
      firewall: "Autoriser seulement flux backup/restore depuis nœuds Proxmox/PBS autorisés.",
      rationale:
        "Les backups contiennent les données les plus sensibles. Une isolation réseau dédiée est recommandée.",
      risk: 76,
    };
  }

  return {
    vlan: "VLAN Applicatif privé (ex: VLAN 50)",
    firewall: "Pas d’exposition directe Internet; entrée via reverse proxy/WAF uniquement.",
    rationale:
      "La segmentation applicative réduit le blast radius et améliore la lisibilité des flux.",
    risk: 66,
  };
}

function isTechnicalSecurityPrompt(normalizedPrompt: string) {
  return /\b(vlan|firewall|regle|regles|acl|policy|segmentation|segmente|dmz|hardening|securite|security|isolation|rbac|permission|zero trust|micro seg)\b/i.test(
    normalizedPrompt,
  );
}

function buildTechnicalSecurityResponse(
  normalizedPrompt: string,
  memory: AssistantMemory,
): AssistantIntentResponse | null {
  if (!isTechnicalSecurityPrompt(normalizedPrompt)) return null;

  const role = inferSecurityWorkloadRole(normalizedPrompt, memory);
  const recommendation = buildVlanRecommendation(role);
  const roleLabel =
    role === "management"
      ? "management"
      : role === "database"
        ? "database"
        : role === "web"
          ? "web"
          : role === "backup"
            ? "backup"
            : "app";
  const targetName =
    typeof memory.lastProvisionDraft?.name === "string" ? memory.lastProvisionDraft.name : null;
  const targetNode =
    typeof memory.lastProvisionDraft?.node === "string" ? memory.lastProvisionDraft.node : null;
  const targetHint = targetName
    ? `Cible mémoire: ${targetName}${targetNode ? ` sur ${targetNode}` : ""}.`
    : "Pas de workload récent en mémoire, recommandation générique.";

  return {
    ok: true,
    intent: "unknown",
    message: `Reco VLAN (${roleLabel}): ${recommendation.vlan}.`,
    followUps: [
      `Pourquoi: ${recommendation.rationale}`,
      `Règle firewall: ${recommendation.firewall}`,
      `Score de risque estimé sans segmentation: ${recommendation.risk}/100`,
      `Action Proxmox: créer bridge/VLAN tag dédié puis appliquer les règles au niveau Datacenter + VM.`,
      targetHint,
    ],
  };
}

function parsePositiveNumber(value: string | undefined) {
  if (!value) return null;
  const parsed = Number.parseFloat(value.replace(",", "."));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function parsePositiveInt(value: string | undefined) {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function normalizeUnit(raw: string | undefined): SizeUnit {
  if (!raw) return null;
  const unit = raw.toLowerCase();
  if (unit.startsWith("t")) return "t";
  if (unit.startsWith("g")) return "g";
  if (unit.startsWith("m")) return "m";
  return null;
}

function toMiB(value: number, unit: SizeUnit) {
  if (unit === "t") return Math.round(value * 1024 * 1024);
  if (unit === "g") return Math.round(value * 1024);
  if (unit === "m") return Math.round(value);
  return value <= 256 ? Math.round(value * 1024) : Math.round(value);
}

function toGb(value: number, unit: SizeUnit) {
  if (unit === "t") return Math.max(1, Math.round(value * 1024));
  if (unit === "m") return Math.max(1, Math.round(value / 1024));
  if (unit === "g") return Math.max(1, Math.round(value));
  return Math.max(1, Math.round(value));
}

function uniqueItems(values: string[]) {
  return [...new Set(values.filter((item) => item.trim().length > 0))];
}

function extractLabeledSize(
  normalizedPrompt: string,
  patterns: RegExp[],
): { value: number; unit: SizeUnit } | null {
  for (const pattern of patterns) {
    const match = normalizedPrompt.match(pattern);
    if (!match) continue;
    const numberValue = parsePositiveNumber(match[1]);
    if (!numberValue) continue;
    return { value: numberValue, unit: normalizeUnit(match[2]) };
  }
  return null;
}

function extractRamMiB(normalizedPrompt: string) {
  const extracted = extractLabeledSize(normalizedPrompt, [
    /(?:ram|memoire|memory)\s*[:=]?\s*(\d+(?:[.,]\d+)?)\s*([tgm](?:ib|b|o)?)?/i,
    /(\d+(?:[.,]\d+)?)\s*([tgm](?:ib|b|o)?)\s*(?:de\s*)?(?:ram|memoire|memory)/i,
  ]);
  if (!extracted) return null;
  return toMiB(extracted.value, extracted.unit);
}

function extractDiskGb(normalizedPrompt: string) {
  const extracted = extractLabeledSize(normalizedPrompt, [
    /(?:disk|disque|storage|stockage|rootfs)\s*[:=]?\s*(\d+(?:[.,]\d+)?)\s*([tgm](?:ib|b|o)?)?/i,
    /(\d+(?:[.,]\d+)?)\s*([tgm](?:ib|b|o)?)\s*(?:de\s*)?(?:disk|disque|storage|stockage|rootfs)/i,
  ]);
  if (!extracted) return null;
  return toGb(extracted.value, extracted.unit);
}

function extractNumber(normalizedPrompt: string, regex: RegExp) {
  const match = normalizedPrompt.match(regex);
  return parsePositiveInt(match?.[1]);
}

function extractValue(prompt: string, regex: RegExp) {
  const match = prompt.match(regex);
  return match?.[1] ?? null;
}

function extractName(prompt: string) {
  const patterns = [
    /(?:nom|name|hostname|host)\s*[:=]?\s*["']?([a-z0-9][a-z0-9._-]{1,63})["']?/i,
    /(?:nomme|nommee|appele|appelee|called)\s+["']?([a-z0-9][a-z0-9._-]{1,63})["']?/i,
  ];
  for (const pattern of patterns) {
    const match = prompt.match(pattern);
    if (match?.[1]) return match[1];
  }
  return null;
}

function inferContext(normalizedPrompt: string): WorkloadContext {
  const isWindows = /(windows|winserver|win srv|win11|win10|w2k22|w2k19|w2k16)/i.test(
    normalizedPrompt,
  );
  const isUbuntu = /ubuntu/i.test(normalizedPrompt);
  const isDebian = /debian/i.test(normalizedPrompt);
  const isRocky = /rocky/i.test(normalizedPrompt);
  const isAlma = /(alma|almalinux)/i.test(normalizedPrompt);
  const isFedora = /fedora/i.test(normalizedPrompt);
  const isOpenSuse = /(opensuse|suse)/i.test(normalizedPrompt);
  const wantsLxc = /\b(lxc|ct|conteneur|container)\b/i.test(normalizedPrompt);

  return {
    kind: wantsLxc && !isWindows ? "lxc" : "qemu",
    isWindows,
    isUbuntu,
    isDebian,
    isRocky,
    isAlma,
    isFedora,
    isOpenSuse,
  };
}

function inferPresetId(context: WorkloadContext): ProvisionDraft["presetId"] {
  if (context.isWindows) return "windows-server";
  if (context.kind === "lxc") {
    if (context.isUbuntu) return "ubuntu-lxc";
    return "debian-lxc";
  }
  if (
    context.isUbuntu ||
    context.isDebian ||
    context.isRocky ||
    context.isAlma ||
    context.isFedora ||
    context.isOpenSuse
  ) {
    return "linux-vm";
  }
  return "generic";
}

function inferDefaultName(context: WorkloadContext) {
  if (context.isWindows) return "win-server";
  if (context.kind === "lxc") {
    if (context.isUbuntu) return "ubuntu-lxc";
    if (context.isDebian) return "debian-lxc";
    return "linux-lxc";
  }
  if (context.isUbuntu) return "ubuntu-vm";
  if (context.isDebian) return "debian-vm";
  if (context.isRocky) return "rocky-vm";
  if (context.isAlma) return "alma-vm";
  if (context.isFedora) return "fedora-vm";
  if (context.isOpenSuse) return "suse-vm";
  return "linux-vm";
}

function inferLxcTemplate(context: WorkloadContext) {
  if (context.isUbuntu) {
    return "local:vztmpl/ubuntu-22.04-standard_22.04-1_amd64.tar.zst";
  }
  if (context.isDebian) {
    return "local:vztmpl/debian-12-standard_12.2-1_amd64.tar.zst";
  }
  return "";
}

function normalizeIsoVolume(rawIso: string | null) {
  if (!rawIso) return undefined;
  const trimmed = rawIso.trim();
  if (!trimmed) return undefined;
  if (/^https?:\/\//i.test(trimmed)) return undefined;
  if (trimmed.includes(":")) return trimmed;
  return `local:iso/${trimmed.replace(/^.*\//, "")}`;
}

function normalizeIsoUrl(rawIsoUrl: string | null) {
  if (!rawIsoUrl) return undefined;
  const trimmed = rawIsoUrl.trim();
  if (!trimmed || !/^https?:\/\//i.test(trimmed)) return undefined;
  return trimmed;
}

function normalizeTemplateVolume(rawTemplate: string | null) {
  if (!rawTemplate) return undefined;
  const trimmed = rawTemplate.trim();
  if (!trimmed) return undefined;
  if (trimmed.includes(":")) return trimmed;
  return `local:vztmpl/${trimmed.replace(/^.*\//, "")}`;
}

function parsePowerAction(normalizedPrompt: string): ParsedPowerAction | null {
  let action: ParsedPowerAction["action"] | null = null;
  if (/\b(reboot|restart|redemarrer|redemarre|relancer)\b/i.test(normalizedPrompt)) {
    action = "reboot";
  } else if (/\b(shutdown|eteindre|poweroff)\b/i.test(normalizedPrompt)) {
    action = "shutdown";
  } else if (/\b(stop|arreter)\b/i.test(normalizedPrompt)) {
    action = "stop";
  } else if (/\b(start|demarrer|lancer|allumer)\b/i.test(normalizedPrompt)) {
    action = "start";
  }

  if (!action) return null;

  const targetType: ParsedPowerAction["targetType"] = /\b(lxc|ct|conteneur|container)\b/i.test(
    normalizedPrompt,
  )
    ? "lxc"
    : /\b(vm|qemu|machine|serveur|server)\b/i.test(normalizedPrompt)
      ? "vm"
      : "workload";

  const vmidMatch =
    normalizedPrompt.match(/(?:vmid|id)\s*[:=]?\s*(\d{2,7})/i) ??
    normalizedPrompt.match(/\b(?:vm|ct|lxc)\s*#?\s*(\d{2,7})\b/i) ??
    normalizedPrompt.match(/#(\d{2,7})\b/);

  const nodeMatch = normalizedPrompt.match(
    /(?:node|noeud)\s*[:=]?\s*([a-z0-9][a-z0-9._-]{1,62})/i,
  );

  return {
    action,
    targetType,
    vmid: vmidMatch?.[1],
    node: nodeMatch?.[1],
  };
}

function hydratePowerActionFromMemory(
  parsed: ParsedPowerAction,
  memory: AssistantMemory,
): ParsedPowerAction & { inferredKind?: ProvisionKind } {
  const fallbackNode =
    memory.lastWorkloadAction?.node ??
    (typeof memory.lastProvisionDraft?.node === "string" ? memory.lastProvisionDraft.node : undefined);
  const fallbackVmid =
    memory.lastWorkloadAction?.vmid ??
    (typeof memory.lastProvisionDraft?.vmid === "string" ? memory.lastProvisionDraft.vmid : undefined);
  const fallbackKind =
    memory.lastWorkloadAction?.kind ??
    (memory.lastProvisionDraft?.kind === "qemu" || memory.lastProvisionDraft?.kind === "lxc"
      ? memory.lastProvisionDraft.kind
      : undefined);

  return {
    ...parsed,
    node: parsed.node ?? fallbackNode,
    vmid: parsed.vmid ?? fallbackVmid,
    inferredKind:
      parsed.targetType === "vm"
        ? "qemu"
        : parsed.targetType === "lxc"
          ? "lxc"
          : fallbackKind,
  };
}

function applyDraftMemoryDefaults(
  draft: Partial<ProvisionDraft>,
  memory: AssistantMemory,
): Partial<ProvisionDraft> {
  const remembered = memory.lastProvisionDraft;
  if (!remembered) return draft;
  return {
    ...draft,
    node: draft.node ?? remembered.node,
    storage: draft.storage ?? remembered.storage,
    bridge: draft.bridge ?? remembered.bridge,
  };
}

function formatPowerActionLabel(action: ParsedPowerAction["action"]) {
  if (action === "start") return "démarrage";
  if (action === "stop") return "arrêt";
  if (action === "shutdown") return "arrêt propre";
  return "redémarrage";
}

function buildTechnicalHelpResponse(
  normalizedPrompt: string,
  memory: AssistantMemory,
): AssistantIntentResponse {
  const powerAction = parsePowerAction(normalizedPrompt);
  if (powerAction) {
    const explicitNodeInPrompt = Boolean(powerAction.node);
    const explicitVmidInPrompt = Boolean(powerAction.vmid);
    const hydrated = hydratePowerActionFromMemory(powerAction, memory);
    const targetLabel =
      hydrated.targetType === "lxc"
        ? "LXC/CT"
        : hydrated.targetType === "vm"
          ? "VM"
          : hydrated.inferredKind === "qemu"
            ? "VM"
            : hydrated.inferredKind === "lxc"
              ? "LXC/CT"
              : "workload";
    const vmidPart = hydrated.vmid ? ` #${hydrated.vmid}` : "";
    const nodePart = hydrated.node ? ` (node ${hydrated.node})` : "";

    const actionDraft: NonNullable<AssistantIntentResponse["actionDraft"]> = {
      action: hydrated.action,
      vmid: hydrated.vmid,
      node: hydrated.node,
      kind: hydrated.inferredKind,
    };

    const actionReady = Boolean(
      actionDraft.action &&
      actionDraft.kind &&
      actionDraft.node &&
      actionDraft.vmid &&
      explicitNodeInPrompt &&
      explicitVmidInPrompt,
    );

    return {
      ok: true,
      intent: "workload-action",
      message: actionReady
        ? `Action prête: ${formatPowerActionLabel(hydrated.action)} ${targetLabel}${vmidPart}${nodePart}.`
        : `Action détectée: ${formatPowerActionLabel(hydrated.action)} ${targetLabel}${vmidPart}${nodePart}.`,
      actionDraft,
      actionReady,
      followUps: uniqueItems([
        explicitVmidInPrompt
          ? ""
          : "Par sécurité, donne explicitement l’ID VM/CT (VMID) dans ta demande.",
        explicitNodeInPrompt
          ? ""
          : "Par sécurité, indique explicitement le nœud Proxmox (node=...) dans ta demande.",
        actionDraft.kind ? "" : "Précise si c’est une VM ou un LXC/CT.",
        actionReady ? "" : "Aucune action ne sera exécutable tant que node + VMID ne sont pas explicitement donnés.",
      ]),
    };
  }

  if (/(401|403|forbidden|permission denied|unauthorized|access denied|refuse)/i.test(normalizedPrompt)) {
    return {
      ok: true,
      intent: "unknown",
      message:
        "Erreur d’accès API détectée. Vérifie le Token ID/Secret, le realm du user token et les permissions (VM.PowerMgmt, VM.Console, Datastore.Audit selon besoins).",
      followUps: [
        "URL Proxmox correcte (https://IP:8006) ?",
        "Token ID au format user@realm!token ?",
        "Le token a bien les droits sur le nœud/VM ciblé ?",
      ],
    };
  }

  if (/(token|api|connexion|connection|auth|authentification|login)/i.test(normalizedPrompt)) {
    return {
      ok: true,
      intent: "unknown",
      message:
        "Pour connecter Proxmox: URL `https://IP:8006`, Token ID (`user@realm!token`) et Token Secret dans Paramètres -> Connexions.",
      followUps: [
        "Tu peux coller URL + Token ID + Secret, je te dis si le format est valide.",
      ],
    };
  }

  if (/(shell|console|terminal|ssh)/i.test(normalizedPrompt)) {
    return {
      ok: true,
      intent: "unknown",
      message:
        "La vue Console/Shell est disponible dans le menu Console. Pour une VM/CT précise, passe par Inventaire puis action Console.",
      followUps: ["Si tu veux, donne VMID + node et je te guide pas à pas."],
    };
  }

  if (/(backup|backups|sauvegarde|retention|rpo|rto|onedrive|gdrive|aws|s3|blob)/i.test(normalizedPrompt)) {
    return {
      ok: true,
      intent: "unknown",
      message:
        "Tu peux configurer les backups dans Opérations -> Planification: scope (toutes VM/CT ou sélection), fréquence hebdo, rétention (années/mois) et cible cloud.",
      followUps: [
        "Exemple: 2 backups/semaine, rétention 1 an 3 mois.",
        "Cibles cloud supportées: OneDrive, Google Drive, AWS S3, Azure Blob.",
        "Les secrets cloud sont stockés chiffrés côté serveur (jamais affichés en clair).",
      ],
    };
  }

  return {
    ok: true,
    intent: "unknown",
    message:
      "Je peux t’aider à créer une VM/LXC et préparer un brouillon précis. Exemple: `Crée une VM Windows 4 vCPU 8 Go 120 Go node pve1 storage local-lvm bridge vmbr0`.",
  };
}

function wantsCreateWorkload(normalizedPrompt: string) {
  const hasCreateVerb =
    /\b(cree|creer|creation|create|provision|deploy|deploie|lance|installe|ajoute|nouveau|nouvelle|new)\b/i.test(
      normalizedPrompt,
    );
  const hasWorkloadNoun =
    /\b(vm|machine|serveur|server|instance|qemu|kvm|lxc|ct|conteneur|container|windows|linux|debian|ubuntu|rocky|alma|fedora|opensuse)\b/i.test(
      normalizedPrompt,
    );
  const hasSizingHints =
    /\b(vcpu|cpu|core|coeur|ram|memoire|memory|disk|disque|stockage|storage|vmid|node|noeud|vmbr)\b/i.test(
      normalizedPrompt,
    );
  return hasWorkloadNoun && (hasCreateVerb || hasSizingHints);
}

function buildSummaryMessage(kind: ProvisionKind, draft: Partial<ProvisionDraft>) {
  const kindLabel = kind === "qemu" ? "VM" : "LXC";
  const parts: string[] = [];
  if (draft.name) parts.push(`nom ${draft.name}`);
  if (draft.cores) parts.push(`${draft.cores} vCPU`);
  if (draft.memoryMiB) {
    const gib = Number.parseInt(draft.memoryMiB, 10) / 1024;
    parts.push(`${Number.isFinite(gib) ? Math.round(gib) : draft.memoryMiB} Go RAM`);
  }
  if (draft.diskGb) parts.push(`${draft.diskGb} Go disque`);
  if (draft.node) parts.push(`node ${draft.node}`);
  return parts.length > 0
    ? `${kindLabel} détecté (${parts.join(", ")}).`
    : `${kindLabel} détecté.`;
}

function buildCreateIntent(promptRaw: string, memory: AssistantMemory): AssistantIntentResponse {
  const normalizedPrompt = normalizeText(promptRaw);
  if (!wantsCreateWorkload(normalizedPrompt)) {
    return buildTechnicalHelpResponse(normalizedPrompt, memory);
  }

  const context = inferContext(normalizedPrompt);
  const kind: ProvisionKind = context.kind;
  const presetId = inferPresetId(context);

  const ramMiB = extractRamMiB(normalizedPrompt);
  const diskGb = extractDiskGb(normalizedPrompt);
  const cores =
    extractNumber(normalizedPrompt, /(?:vcpu|cpu|cores?|coeurs?)\s*[:=]?\s*(\d{1,3})/i) ??
    extractNumber(normalizedPrompt, /(\d{1,3})\s*(?:vcpu|cpu|cores?|coeurs?)/i);
  const sockets = extractNumber(normalizedPrompt, /(?:sockets?|socket)\s*[:=]?\s*(\d{1,2})/i);
  const vmid = extractNumber(normalizedPrompt, /(?:vmid|id)\s*[:=]?\s*(\d{2,7})/i);
  const swapMiB = extractNumber(
    normalizedPrompt,
    /(?:swap)\s*[:=]?\s*(\d+(?:[.,]\d+)?)\s*([tgm](?:ib|b|o)?)?/i,
  );

  const node = extractValue(
    normalizedPrompt,
    /(?:node|noeud)\s*[:=]?\s*([a-z0-9][a-z0-9._-]{1,62})/i,
  );
  const storage =
    extractValue(
      normalizedPrompt,
      /(?:storage|stockage|datastore)\s*[:=]?\s*([a-z0-9][a-z0-9._-]{1,62})/i,
    ) ??
    extractValue(
      normalizedPrompt,
      /\b(local-lvm|local-zfs|local|ceph[a-z0-9._-]*|rbd[a-z0-9._-]*|nfs[a-z0-9._-]*|zfs[a-z0-9._-]*)\b/i,
    );
  const bridge =
    extractValue(normalizedPrompt, /\b(vmbr[0-9a-z._-]{0,16})\b/i) ??
    extractValue(
      normalizedPrompt,
      /(?:bridge|pont)\s*[:=]?\s*([a-z0-9][a-z0-9._-]{1,62})/i,
    );

  const isoUrl = normalizeIsoUrl(
    extractValue(promptRaw, /(https?:\/\/[^\s"'`]+\.iso)\b/i),
  );

  const isoVolume = normalizeIsoVolume(
    extractValue(promptRaw, /([a-z0-9._-]+:iso\/[^\s"'`]+\.iso)/i) ??
      extractValue(promptRaw, /(?:iso)\s*[:=]?\s*([^\s"'`]+\.iso)/i),
  );

  const explicitTemplate = normalizeTemplateVolume(
    extractValue(promptRaw, /([a-z0-9._-]+:vztmpl\/[^\s"'`]+\.tar\.(?:zst|gz|xz))/i) ??
      extractValue(promptRaw, /(?:template|vztmpl)\s*[:=]?\s*([^\s"'`]+\.tar\.(?:zst|gz|xz))/i),
  );

  const wantsSeabios = /\bseabios\b/i.test(normalizedPrompt);
  const wantsI440fx = /\bi440fx\b/i.test(normalizedPrompt);
  const wantsHostCpu = /\bcpu\s*host\b|\bhost cpu\b|\btype cpu host\b/i.test(normalizedPrompt);
  const disableTpm = /\b(sans|without|no)\s+tpm\b/i.test(normalizedPrompt);
  const disableAgent = /\b(sans|without|no)\s+(qemu\s*)?agent\b/i.test(normalizedPrompt);
  const privilegedLxc = /\b(privileged|privilegie|privilegiee|priviligie)\b/i.test(normalizedPrompt);
  const explicitUefi = /\b(uefi|ovmf)\b/i.test(normalizedPrompt);
  const name = extractName(promptRaw) ?? inferDefaultName(context);

  const parsedDraft: Partial<ProvisionDraft> = {
    kind,
    presetId,
    name,
    node: node ?? undefined,
    storage: storage ?? undefined,
    bridge: bridge ?? undefined,
    vmid: vmid ? String(vmid) : undefined,
    memoryMiB: ramMiB ? String(ramMiB) : undefined,
    diskGb: diskGb ? String(diskGb) : undefined,
    cores: cores ? String(cores) : undefined,
    sockets: sockets ? String(sockets) : undefined,
    ostype: context.isWindows ? "win11" : "l26",
    cpuType: wantsHostCpu ? "host" : undefined,
    bios: wantsSeabios ? "seabios" : explicitUefi || context.isWindows ? "ovmf" : undefined,
    machine: wantsI440fx ? "i440fx" : "q35",
    enableAgent: kind === "qemu" ? !disableAgent : undefined,
    enableTpm: kind === "qemu" ? (context.isWindows ? !disableTpm : false) : undefined,
    isoSourceMode: kind === "qemu" && isoUrl ? "url" : kind === "qemu" && isoVolume ? "existing" : undefined,
    isoVolume: kind === "qemu" ? isoVolume : undefined,
    isoUrl: kind === "qemu" ? isoUrl : undefined,
    lxcTemplate: kind === "lxc" ? (explicitTemplate ?? inferLxcTemplate(context)) : undefined,
    lxcSwapMiB: kind === "lxc" && swapMiB ? String(swapMiB) : undefined,
    lxcUnprivileged: kind === "lxc" ? !privilegedLxc : undefined,
  };
  const draft = applyDraftMemoryDefaults(parsedDraft, memory);

  const followUps = uniqueItems([
    draft.node ? "" : "Sur quel nœud Proxmox ?",
    draft.storage ? "" : "Quel stockage utiliser (ex: local-lvm, ceph-vm) ?",
    draft.bridge ? "" : "Quel bridge réseau (ex: vmbr0) ?",
    draft.vmid ? "" : "Tu veux imposer un VMID ou laisser l’auto-allocation ?",
    draft.cores ? "" : "Combien de vCPU ?",
    draft.memoryMiB ? "" : "Combien de RAM ?",
    draft.diskGb ? "" : "Quelle taille de disque ?",
    kind === "qemu" && !draft.isoVolume && !draft.isoUrl
      ? "Quel ISO monter ou quelle URL ISO importer ?"
      : "",
    kind === "lxc" && !draft.lxcTemplate ? "Quel template LXC (vztmpl) utiliser ?" : "",
  ]).slice(0, 6);

  return {
    ok: true,
    intent: "create-workload",
    message: `${buildSummaryMessage(kind, draft)} Complète les champs puis lance la création.`,
    draft,
    suggestedKind: kind,
    followUps,
  };
}

function buildUnknownResponse(promptRaw: string, memory: AssistantMemory): AssistantIntentResponse {
  return buildTechnicalHelpResponse(normalizeText(promptRaw), memory);
}

export async function POST(request: NextRequest) {
  const originCheck = ensureSameOriginRequest(request);
  if (!originCheck.ok) {
    return NextResponse.json(
      { ok: false, error: "Forbidden", details: originCheck.reason },
      { status: 403 },
    );
  }

  const gate = consumeRateLimit(`assistant:intent:${getClientIp(request)}`, ASSISTANT_INTENT_LIMIT);
  if (!gate.ok) {
    return NextResponse.json(
      { ok: false, error: "Trop de requêtes. Réessaie dans quelques instants." },
      { status: 429 },
    );
  }

  let body: IntentBody;
  try {
    body = (await request.json()) as IntentBody;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }

  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt) {
    return NextResponse.json({ ok: false, error: "Prompt requis." }, { status: 400 });
  }

  const safety = evaluateAssistantPromptSafety(prompt);
  if (!safety.ok) {
    const unsafeGate = consumeRateLimit(
      `assistant:unsafe:${getClientIp(request)}`,
      ASSISTANT_UNSAFE_LIMIT,
    );
    if (!unsafeGate.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: "Trop de demandes rejetées pour sécurité. Réessaie plus tard.",
        },
        { status: 429 },
      );
    }

    console.warn("[assistant-guardrail-block]", {
      category: safety.category,
      ip: getClientIp(request),
      promptPreview: buildPromptPreviewForAudit(prompt),
    });

    return NextResponse.json({
      ok: true,
      intent: "unknown",
      message: safety.message,
      followUps: safety.followUps,
    } satisfies AssistantIntentResponse);
  }

  const token = request.cookies.get(AUTH_COOKIE_NAME)?.value;
  const session = token ? await verifySessionToken(token) : null;
  const memoryScope = session?.username ?? "default";

  let memory = rememberAssistantQuestion(safety.prompt, memoryScope);
  const declaredFirstName = extractDeclaredFirstName(safety.prompt);
  if (declaredFirstName) {
    memory = rememberAssistantFirstName(declaredFirstName, memoryScope);
  }
  const normalizedPrompt = normalizeText(safety.prompt);
  const requiresOperateRole = wantsCreateWorkload(normalizedPrompt) || Boolean(parsePowerAction(normalizedPrompt));

  if (requiresOperateRole && !hasRuntimeCapability(session?.role, "operate")) {
    return NextResponse.json({
      ok: true,
      intent: "unknown",
      message: "Mode lecture: les créations VM/LXC et actions power sont bloquées pour ce compte.",
      followUps: ["Utilise un compte opérateur ou admin pour exécuter des actions sur Proxmox."],
    } satisfies AssistantIntentResponse);
  }

  const memoryRecall = buildMemoryRecallResponse(normalizedPrompt, memory);
  if (memoryRecall) {
    return NextResponse.json({
      ...memoryRecall,
      message: personalizeMessage(memoryRecall.message, memory.firstName),
    });
  }

  if (
    declaredFirstName &&
    /^.*(?:je\s*m['’]?\s*appelle|mon\s+prenom\s+est|my\s+name\s+is|i\s+am).*$/.test(prompt) &&
    !wantsCreateWorkload(normalizedPrompt) &&
    !parsePowerAction(normalizedPrompt)
  ) {
    return NextResponse.json({
      ok: true,
      intent: "unknown",
      message: personalizeMessage("Parfait, je m’en souviendrai pour les prochaines réponses.", memory.firstName),
    } satisfies AssistantIntentResponse);
  }

  if (!wantsCreateWorkload(normalizedPrompt) && !parsePowerAction(normalizedPrompt)) {
    const securityAdvice = buildTechnicalSecurityResponse(normalizedPrompt, memory);
    if (securityAdvice) {
      return NextResponse.json({
        ...securityAdvice,
        message: personalizeMessage(securityAdvice.message, memory.firstName),
      });
    }
  }

  let response: AssistantIntentResponse;
  if (wantsCreateWorkload(normalizedPrompt)) {
    response = buildCreateIntent(safety.prompt, memory);
    if (response.intent === "create-workload" && response.draft) {
      rememberAssistantProvisionDraft(response.draft, memoryScope);
    }
  } else {
    response = buildUnknownResponse(safety.prompt, memory);
  }

  if (
    response.intent === "workload-action" &&
    response.actionReady &&
    response.actionDraft?.action &&
    (response.actionDraft.kind === "qemu" || response.actionDraft.kind === "lxc") &&
    response.actionDraft.node &&
    response.actionDraft.vmid
  ) {
    rememberAssistantWorkloadAction({
      action: response.actionDraft.action,
      kind: response.actionDraft.kind,
      node: response.actionDraft.node,
      vmid: response.actionDraft.vmid,
    }, memoryScope);
  }

  return NextResponse.json({
    ...response,
    message: personalizeMessage(response.message, memory.firstName),
  });
}
