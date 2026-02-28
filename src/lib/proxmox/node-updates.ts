import "server-only";

import { proxmoxRequest } from "@/lib/proxmox/client";
import { waitForNodeTask } from "@/lib/proxmox/tasks";

type PackageRecord = Record<string, unknown>;

export type NodeUpdateItem = {
  packageName: string;
  oldVersion: string | null;
  newVersion: string | null;
  origin: string | null;
  priority: string | null;
  title: string | null;
  description: string | null;
  changelog: string | null;
  security: boolean;
  urgent: boolean;
  rebootRequired: boolean;
  explanation: string;
  group: string;
  autoHotSafe: boolean;
};

export type NodeUpdatesSnapshot = {
  node: string;
  checkedAt: string;
  counts: {
    total: number;
    security: number;
    urgent: number;
    rebootRisk: number;
    autoHotSafe: number;
  };
  recommendation: string;
  updates: NodeUpdateItem[];
};

function asString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function getRecordField(record: PackageRecord, ...keys: string[]) {
  for (const key of keys) {
    const exact = record[key];
    const text = asString(exact);
    if (text) return text;
    const lowerMatch = Object.entries(record).find(([entryKey]) => entryKey.toLowerCase() === key.toLowerCase());
    if (lowerMatch) {
      const candidate = asString(lowerMatch[1]);
      if (candidate) return candidate;
    }
  }
  return null;
}

function normalizeChangelog(text: string | null) {
  if (!text) return null;
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 4)
    .join(" ");
}

function classifyPackageName(packageName: string) {
  const normalized = packageName.toLowerCase();

  if (
    normalized.includes("kernel") ||
    normalized.includes("microcode") ||
    normalized.startsWith("linux-image")
  ) {
    return {
      group: "kernel",
      explanation: "Impact noyau / microcode. Peut corriger stabilité, sécurité bas niveau ou matériel.",
      rebootRequired: true,
    };
  }

  if (normalized.startsWith("pve-manager") || normalized.startsWith("proxmox-ve")) {
    return {
      group: "platform",
      explanation: "Composant cœur Proxmox VE. Impacte l’interface, l’API et l’intégration cluster.",
      rebootRequired: false,
    };
  }

  if (normalized.startsWith("qemu") || normalized.includes("qemu-server")) {
    return {
      group: "virtualization",
      explanation: "Pile de virtualisation QEMU/KVM. Corrige VM, périphériques virtuels et compatibilité invité.",
      rebootRequired: false,
    };
  }

  if (normalized.startsWith("corosync") || normalized.startsWith("pve-ha-manager")) {
    return {
      group: "cluster",
      explanation: "Cluster/HA. Corrige quorum, orchestration haute dispo et coordination inter-nœuds.",
      rebootRequired: false,
    };
  }

  if (normalized.startsWith("ceph")) {
    return {
      group: "storage",
      explanation: "Stockage distribué Ceph. Corrige réplication, performance et résilience stockage.",
      rebootRequired: false,
    };
  }

  if (normalized.startsWith("openssl") || normalized.startsWith("curl") || normalized.startsWith("libssl")) {
    return {
      group: "security",
      explanation: "Bibliothèque de sécurité / crypto. Peut corriger TLS, certificats ou vulnérabilités réseau.",
      rebootRequired: false,
    };
  }

  return {
    group: "system",
    explanation: "Mise à jour système / dépendance. Sert surtout à corriger bugs, stabilité ou sécurité générale.",
    rebootRequired: false,
  };
}

function classifyUrgency(input: {
  packageName: string;
  origin: string | null;
  title: string | null;
  description: string | null;
  changelog: string | null;
}) {
  const combined = [
    input.packageName,
    input.origin ?? "",
    input.title ?? "",
    input.description ?? "",
    input.changelog ?? "",
  ]
    .join(" ")
    .toLowerCase();

  const hasSecuritySignal =
    /\bsecurity\b|\bcve-\d{4}-\d+\b|\bvulnerability\b|\bremote code execution\b|\brce\b|\bprivilege escalation\b|\bheap overflow\b|\bbuffer overflow\b/.test(
      combined,
    ) ||
    (input.origin ?? "").toLowerCase().includes("security");

  const classified = classifyPackageName(input.packageName);
  const urgent =
    hasSecuritySignal &&
    (classified.group === "kernel" ||
      classified.group === "security" ||
      classified.group === "platform" ||
      classified.group === "virtualization" ||
      classified.group === "cluster");

  return {
    security: hasSecuritySignal,
    urgent,
    rebootRequired: classified.rebootRequired,
    explanation: classified.explanation,
    group: classified.group,
  };
}

export async function scanNodeUpdates(node: string, options: { refresh?: boolean } = {}) {
  if (options.refresh) {
    const upid = await proxmoxRequest<string>(`nodes/${encodeURIComponent(node)}/apt/update`, {
      method: "POST",
    });
    await waitForNodeTask(node, upid, {
      timeoutMessage: "Timeout lors du rafraîchissement de l’index APT Proxmox.",
    });
  }

  const packagesRaw = await proxmoxRequest<unknown[]>(`nodes/${encodeURIComponent(node)}/apt/update`);
  const packages = Array.isArray(packagesRaw) ? packagesRaw : [];
  const normalized = await Promise.all(
    packages.slice(0, 120).map(async (entry, index) => {
      const record = (entry ?? {}) as PackageRecord;
      const packageName = getRecordField(record, "package", "Package", "name");
      if (!packageName) return null;

      const title = getRecordField(record, "title", "Title");
      const description = getRecordField(record, "description", "Description");
      const oldVersion = getRecordField(record, "oldversion", "OldVersion");
      const newVersion = getRecordField(record, "version", "Version");
      const origin = getRecordField(record, "origin", "Origin");
      const priority = getRecordField(record, "priority", "Priority");

      let changelog: string | null = null;
      if (index < 8) {
        try {
          const changelogRaw = await proxmoxRequest<string>(
            `nodes/${encodeURIComponent(node)}/apt/changelog?name=${encodeURIComponent(packageName)}${
              newVersion ? `&version=${encodeURIComponent(newVersion)}` : ""
            }`,
          );
          changelog = normalizeChangelog(changelogRaw);
        } catch {
          changelog = null;
        }
      }

      const classification = classifyUrgency({
        packageName,
        origin,
        title,
        description,
        changelog,
      });

      return {
        packageName,
        oldVersion,
        newVersion,
        origin,
        priority,
        title,
        description,
        changelog,
        ...classification,
        autoHotSafe: classification.security && !classification.rebootRequired,
      } satisfies NodeUpdateItem;
    }),
  );

  const updates = normalized.filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
  const urgentCount = updates.filter((entry) => entry.urgent).length;
  const securityCount = updates.filter((entry) => entry.security).length;
  const rebootRiskCount = updates.filter((entry) => entry.rebootRequired).length;
  const autoHotSafeCount = updates.filter((entry) => entry.autoHotSafe).length;

  return {
    node,
    checkedAt: new Date().toISOString(),
    counts: {
      total: updates.length,
      security: securityCount,
      urgent: urgentCount,
      rebootRisk: rebootRiskCount,
      autoHotSafe: autoHotSafeCount,
    },
    recommendation:
      urgentCount > 0
        ? rebootRiskCount > 0
          ? "Urgent sécurité détecté. Planifie une mise à jour en rolling update: migrer les workloads, patcher le nœud, puis redémarrer si requis."
          : "Urgent sécurité détecté sans redémarrage estimé. Application rapide possible sans coupure Proxmox attendue."
        : updates.length > 0
          ? "Mises à jour disponibles. Vérifie les paquets impactants avant application."
          : "Aucune mise à jour détectée.",
    updates,
  } satisfies NodeUpdatesSnapshot;
}
