import "server-only";
import { getAuthStatus } from "@/lib/auth/session";
import { getProxmoxConfig } from "@/lib/proxmox/config";
import type { DashboardSnapshot } from "@/lib/proxmox/dashboard";

export type AdvisorSeverity = "critical" | "high" | "medium" | "low";

export type AdvisorRecommendation = {
  id: string;
  severity: AdvisorSeverity;
  category: "security" | "greenit";
  title: string;
  rationale: string;
  action: string;
};

export type SecurityAdvisorResult = {
  score: number;
  mode: "heuristic";
  recommendations: AdvisorRecommendation[];
  signals: {
    authEnabled: boolean;
    authConfigured: boolean;
    proxmoxConfigured: boolean;
    insecureTls: boolean;
  };
};

export type GreenItAdvisorResult = {
  score: number;
  mode: "heuristic";
  recommendations: AdvisorRecommendation[];
  metrics: {
    estimatedPowerWatts: number;
    pue: number;
    effectivePowerWatts: number;
    annualKwh: number;
    annualCo2Kg: number;
    annualCost: number;
    avgNodeCpu: number;
    avgNodeMem: number;
  };
  config: {
    pue: number;
    co2FactorKgPerKwh: number;
    electricityPricePerKwh: number;
  };
};

function clampScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function parseNumberEnv(name: string, fallback: number) {
  const value = process.env[name];
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function buildSecurityAdvisor(snapshot: DashboardSnapshot): SecurityAdvisorResult {
  const auth = getAuthStatus();
  const proxmox = getProxmoxConfig();

  let score = 100;
  const recommendations: AdvisorRecommendation[] = [];

  const proxmoxConfigured = Boolean(proxmox);
  const insecureTls = Boolean(proxmox?.allowInsecureTls);

  if (!auth.active) {
    score -= 35;
    recommendations.push({
      id: "auth-enabled",
      severity: "critical",
      category: "security",
      title: "Activer l’authentification de l’interface",
      rationale:
        "Sans authentification active, les pages et actions sensibles sont exposées dès qu’un accès réseau existe.",
      action:
        "Configurer le compte local dans Paramètres > Utilisateurs locaux puis ajuster la session dans Paramètres > Session & accès.",
    });
  }

  if (auth.enabledFlag && !auth.configured) {
    score -= 18;
    recommendations.push({
      id: "auth-config",
      severity: "high",
      category: "security",
      title: "Finaliser la configuration d’auth",
      rationale:
        "Le drapeau d’auth est activé mais des variables critiques semblent manquantes.",
      action:
        "Reconfigurer les comptes locaux et la session dans Paramètres > Utilisateurs locaux et Paramètres > Session & accès.",
    });
  }

  if (!proxmoxConfigured) {
    score -= 12;
    recommendations.push({
      id: "proxmox-token",
      severity: "medium",
      category: "security",
      title: "Configurer un token API Proxmox dédié",
      rationale:
        "Un token dédié permet de limiter les droits et d’auditer clairement les appels API de ProxCenter.",
      action:
        "Créer un token API minimal (rôle restreint) puis le renseigner dans Paramètres > Connexions.",
    });
  }

  if (insecureTls) {
    score -= 24;
    recommendations.push({
      id: "tls-hardening",
      severity: "high",
      category: "security",
      title: "Désactiver le mode TLS non sécurisé",
      rationale:
        "Le mode TLS non sécurisé accepte les certificats non vérifiés et réduit la protection contre les MITM.",
      action:
        "Désactiver l’option TLS non sécurisé dans Paramètres > Connexions et installer un certificat valide (ou CA locale).",
    });
  }

  if (snapshot.summary.running > 0 && !auth.active) {
    score -= 10;
    recommendations.push({
      id: "protect-running-workloads",
      severity: "high",
      category: "security",
      title: "Protéger l’interface avant actions sur workloads actifs",
      rationale:
        "Des VM/CT actifs sont visibles; une action non authentifiée pourrait impacter la prod.",
      action: "Conserver le login obligatoire et ajouter des rôles/permissions avant exposition réseau.",
    });
  }

  if (recommendations.length === 0) {
    recommendations.push({
      id: "security-baseline-ok",
      severity: "low",
      category: "security",
      title: "Base de sécurité correcte",
      rationale:
        "Auth locale active et configuration Proxmox utilisable. Les bases sont en place pour durcir la suite.",
      action:
        "Étapes suivantes: RBAC, audit logs, rotation des tokens, 2FA/SSO, reverse proxy/VPN.",
    });
  }

  return {
    score: clampScore(score),
    mode: "heuristic",
    recommendations,
    signals: {
      authEnabled: auth.enabledFlag,
      authConfigured: auth.configured,
      proxmoxConfigured,
      insecureTls,
    },
  };
}

export function buildGreenItAdvisor(snapshot: DashboardSnapshot): GreenItAdvisorResult {
  const pue = parseNumberEnv("GREENIT_PUE", 1.45);
  const co2FactorKgPerKwh = parseNumberEnv("GREENIT_CO2_FACTOR_KG_PER_KWH", 0.052);
  const electricityPricePerKwh = parseNumberEnv("GREENIT_ELECTRICITY_PRICE", 0.18);

  const avgNodeCpu =
    snapshot.nodes.length > 0
      ? snapshot.nodes.reduce((sum, node) => sum + node.cpuLoad, 0) / snapshot.nodes.length
      : 0;
  const avgNodeMem =
    snapshot.nodes.length > 0
      ? snapshot.nodes.reduce((sum, node) => {
          const ratio = node.memoryTotal > 0 ? node.memoryUsed / node.memoryTotal : 0;
          return sum + Math.max(0, Math.min(ratio, 1));
        }, 0) / snapshot.nodes.length
      : 0;

  // Very rough homelab/datacenter estimate: base node overhead + CPU + RAM contribution.
  const estimatedPowerWatts =
    snapshot.nodes.length > 0
      ? snapshot.nodes.reduce((sum, node) => {
          const memRatio = node.memoryTotal > 0 ? node.memoryUsed / node.memoryTotal : 0;
          return sum + (110 + node.cpuLoad * 220 + memRatio * 90);
        }, 0)
      : 0;

  const effectivePowerWatts = estimatedPowerWatts * pue;
  const annualKwh = (effectivePowerWatts * 24 * 365) / 1000;
  const annualCo2Kg = annualKwh * co2FactorKgPerKwh;
  const annualCost = annualKwh * electricityPricePerKwh;

  let score = 100;
  const recommendations: AdvisorRecommendation[] = [];

  if (avgNodeCpu < 0.18 && snapshot.summary.running > 0 && snapshot.summary.nodes >= 2) {
    score -= 18;
    recommendations.push({
      id: "greenit-consolidation",
      severity: "medium",
      category: "greenit",
      title: "Consolider les workloads sous-chargés",
      rationale:
        "CPU moyen bas sur plusieurs nœuds: une consolidation peut réduire la consommation totale et l’empreinte carbone.",
      action:
        "Identifier les VM/CT faibles consommateurs et regrouper sur moins de nœuds (avec HA/maintenance planifiée).",
    });
  }

  if (avgNodeMem > 0.82) {
    score -= 14;
    recommendations.push({
      id: "greenit-memory-pressure",
      severity: "medium",
      category: "greenit",
      title: "Réduire la pression mémoire",
      rationale:
        "Une RAM très chargée dégrade l’efficacité (swap, contention) et augmente la consommation relative.",
      action:
        "Revoir le dimensionnement RAM des VM et supprimer les surallocations inutiles.",
    });
  }

  const stoppedCount = snapshot.summary.vms + snapshot.summary.cts - snapshot.summary.running;
  if (stoppedCount > 0) {
    score -= 8;
    recommendations.push({
      id: "greenit-cleanup-stopped",
      severity: "low",
      category: "greenit",
      title: "Nettoyer les VM/CT arrêtés non utilisés",
      rationale:
        "Les workloads arrêtés occupent du stockage, compliquent l’inventaire et freinent les optimisations.",
      action:
        "Tagger/archive/supprimer les VM/CT obsolètes et compacter les disques inutilisés.",
    });
  }

  if (snapshot.mode === "offline") {
    score -= 12;
    recommendations.push({
      id: "greenit-live-metrics",
      severity: "low",
      category: "greenit",
      title: "Connecter Proxmox pour des estimations GreenIT fiables",
      rationale:
        "Sans métriques Proxmox réelles, l’estimation énergétique et carbone reste approximative.",
      action:
        "Configurer l’accès API Proxmox puis calibrer les paramètres GreenIT (PUE, CO2, coût élec).",
    });
  }

  if (recommendations.length === 0) {
    recommendations.push({
      id: "greenit-baseline-ok",
      severity: "low",
      category: "greenit",
      title: "Efficacité globale correcte",
      rationale:
        "Les signaux de charge sont raisonnables. Tu peux maintenant affiner avec métriques historiques et power meters réels.",
      action:
        "Ajouter une télémétrie énergétique par nœud (IPMI/PDUs) pour un score GreenIT plus précis.",
    });
  }

  return {
    score: clampScore(score),
    mode: "heuristic",
    recommendations,
    metrics: {
      estimatedPowerWatts: Math.round(estimatedPowerWatts),
      pue,
      effectivePowerWatts: Math.round(effectivePowerWatts),
      annualKwh: Math.round(annualKwh),
      annualCo2Kg: Math.round(annualCo2Kg),
      annualCost: Math.round(annualCost),
      avgNodeCpu,
      avgNodeMem,
    },
    config: {
      pue,
      co2FactorKgPerKwh,
      electricityPricePerKwh,
    },
  };
}
