import "server-only";

export const ASSISTANT_PROMPT_MAX_CHARS = 1600;

export type AssistantGuardrailCategory =
  | "prompt-too-long"
  | "hate-content"
  | "policy-bypass"
  | "security-abuse";

export type AssistantGuardrailDecision =
  | {
      ok: true;
      prompt: string;
    }
  | {
      ok: false;
      category: AssistantGuardrailCategory;
      message: string;
      followUps?: string[];
    };

const CONTROL_CHARS_PATTERN = /[\u0000-\u0008\u000B-\u001F\u007F]/g;

const HATE_PATTERNS: RegExp[] = [
  /\b(?:race inferieure|suprematie blanche|white supremacy)\b/i,
  /\b(?:sale|fucking|putain de)\s+(?:noir|arabe|juif|asiatique|rom|musulman|gay|lesbienne)\b/i,
  /\b(?:nigger|kike|chink|paki)\b/i,
  /\b(?:tuer|exterminer|eliminer)\s+(?:les|tous les|tout les)\s+(?:juifs|arabes|noirs|blancs|musulmans|gays|lesbiennes)\b/i,
];

const POLICY_BYPASS_PATTERNS: RegExp[] = [
  /\b(?:ignore|oublie|bypass|contourne|desactive|disable|skip)\b.{0,50}\b(?:instruction|consigne|regle|policy|guardrail|filtre|securite|security)\b/i,
  /\b(?:jailbreak|developer mode|mode dan|mode developpeur)\b/i,
];

const SECURITY_TECHNIQUE_PATTERN =
  /\b(?:hack|pirat(?:er|age)?|cracker?|brute ?force|credential stuffing|password spray|rce|sql injection|xss|reverse shell|payload|ddos|exploit(?:er)?)\b/i;
const SECURITY_TARGET_PATTERN =
  /\b(?:auth|authentification|mot de passe|password|token|session|rbac|acl|firewall|waf|proxmox|node|serveur|vm|vlan|api)\b/i;
const HOWTO_PATTERN = /\b(?:comment|how|donne|fais|faire|montre|script|commande|guide|etape|steps)\b/i;
const DEFENSIVE_CONTEXT_PATTERN =
  /\b(?:proteger|protection|mitiger|mitigation|prevenir|prevention|hardening|audit|defense|securiser|best practice|bonne pratique|detection|monitoring)\b/i;

function sanitizePrompt(raw: string) {
  return raw.replace(CONTROL_CHARS_PATTERN, " ").replace(/\s+/g, " ").trim();
}

function matchesAny(value: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(value));
}

export function evaluateAssistantPromptSafety(promptRaw: string): AssistantGuardrailDecision {
  const prompt = sanitizePrompt(promptRaw);

  if (!prompt) {
    return {
      ok: false,
      category: "policy-bypass",
      message: "Message vide ou invalide.",
    };
  }

  if (prompt.length > ASSISTANT_PROMPT_MAX_CHARS) {
    return {
      ok: false,
      category: "prompt-too-long",
      message: `Message trop long (${prompt.length} caractères). Maximum: ${ASSISTANT_PROMPT_MAX_CHARS}.`,
      followUps: ["Raccourcis la demande au strict nécessaire."],
    };
  }

  const normalized = prompt
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  if (matchesAny(normalized, HATE_PATTERNS)) {
    return {
      ok: false,
      category: "hate-content",
      message:
        "Je ne traite pas les contenus haineux, racistes ou discriminatoires. Reformule avec une demande technique professionnelle.",
      followUps: ["Je peux aider sur sécurité, VLAN, firewall, backups et opérations Proxmox."],
    };
  }

  if (matchesAny(normalized, POLICY_BYPASS_PATTERNS)) {
    return {
      ok: false,
      category: "policy-bypass",
      message:
        "Refus: tentative de contournement des règles de sécurité détectée. Je reste limité à l’assistance technique légitime.",
      followUps: ["Je peux proposer une approche sécurisée conforme (RBAC, ACL, firewall, hardening)."],
    };
  }

  const isOffensiveSecurityRequest =
    SECURITY_TECHNIQUE_PATTERN.test(normalized) &&
    (HOWTO_PATTERN.test(normalized) || SECURITY_TARGET_PATTERN.test(normalized)) &&
    !DEFENSIVE_CONTEXT_PATTERN.test(normalized);

  if (isOffensiveSecurityRequest) {
    return {
      ok: false,
      category: "security-abuse",
      message:
        "Je ne fournis pas d’instructions pour attaquer, contourner l’authentification ou compromettre des systèmes.",
      followUps: [
        "Je peux aider à durcir l’infra: 2FA, RBAC minimal, segmentation VLAN, règles firewall, rotation des secrets.",
      ],
    };
  }

  return { ok: true, prompt };
}

export function buildPromptPreviewForAudit(prompt: string, maxChars = 140) {
  const clean = sanitizePrompt(prompt);
  if (clean.length <= maxChars) return clean;
  return `${clean.slice(0, maxChars)}…`;
}

