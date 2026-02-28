export type NavItem = {
  id: string;
  label: string;
  glyph: string;
  href: string;
};

export type NavSection = {
  id: string;
  title: string;
  items: NavItem[];
  collapsible?: boolean;
  defaultOpen?: boolean;
};

export type SectionPageConfig = {
  slug: string;
  label: string;
  eyebrow: string;
  title: string;
  description: string;
  focus: string[];
};

export const MAIN_MENU_SECTIONS: NavSection[] = [
  {
    id: "pilotage",
    title: "Pilotage",
    defaultOpen: true,
    items: [
      { id: "dashboard", label: "Accueil", glyph: "DB", href: "/" },
      { id: "inventory", label: "Inventaire", glyph: "IV", href: "/inventory" },
      { id: "provision", label: "Création", glyph: "CR", href: "/provision" },
    ],
  },
  {
    id: "plateforme",
    title: "Exploitation",
    defaultOpen: true,
    items: [
      { id: "observability", label: "Observabilité", glyph: "OB", href: "/observability" },
      { id: "operations", label: "Opérations", glyph: "OP", href: "/operations" },
      { id: "backups", label: "Sauvegardes", glyph: "BK", href: "/backups" },
      { id: "security", label: "Sécurité", glyph: "SC", href: "/security" },
      { id: "resources", label: "Ressources", glyph: "RC", href: "/resources" },
      { id: "console", label: "Console / Shell", glyph: "SH", href: "/console" },
    ],
  },
];

export const ACCOUNT_MENU_SECTION: NavSection = {
  id: "account",
  title: "Configuration",
  collapsible: false,
  defaultOpen: true,
  items: [
    { id: "settings", label: "Paramètres", glyph: "ST", href: "/settings" },
  ],
};

export const SECTION_PAGES: Record<string, SectionPageConfig> = {
  nodes: {
    slug: "nodes",
    label: "Nœuds",
    eyebrow: "Infrastructure",
    title: "Nœuds Proxmox",
    description:
      "Vue dédiée aux nœuds du cluster (CPU, RAM, état, charge, maintenance).",
    focus: ["Statut des nœuds", "Charge CPU/RAM", "Maintenance / reboot"],
  },
  inventory: {
    slug: "inventory",
    label: "Inventaire",
    eyebrow: "Inventaire",
    title: "Inventaire global",
    description:
      "Liste centralisée des VM, CT, disques, interfaces et métadonnées du cluster.",
    focus: ["VM / CT", "Disques et NIC", "Tags et recherche"],
  },
  network: {
    slug: "network",
    label: "Réseau",
    eyebrow: "Réseau",
    title: "Réseau et bridges",
    description:
      "Configuration réseau, bridges, VLAN et connectivité des workloads.",
    focus: ["Bridges", "VLAN", "Liaisons VM/CT"],
  },
  storage: {
    slug: "storage",
    label: "Stockage",
    eyebrow: "Stockage",
    title: "Stockage Proxmox",
    description:
      "Suivi des stockages locaux et distants (ZFS, LVM, NFS, Ceph, etc.).",
    focus: ["Capacité", "IO / usage", "Politiques de stockage"],
  },
  templates: {
    slug: "templates",
    label: "Templates",
    eyebrow: "Templates",
    title: "Templates VM / CT",
    description:
      "Gestion des templates pour déploiement rapide de VM et conteneurs.",
    focus: ["Templates disponibles", "Versions", "Clone rapide"],
  },
  sync: {
    slug: "sync",
    label: "Rescan",
    eyebrow: "Synchronisation",
    title: "Rescan / synchronisation",
    description:
      "Déclenchement de rescan de données et rafraîchissement manuel de l’interface.",
    focus: ["Rescan manuel", "Dernière synchro", "Statut du job"],
  },
  security: {
    slug: "security",
    label: "Sécurité",
    eyebrow: "Sécurité",
    title: "Sécurité plateforme",
    description:
      "Contrôle des accès, tokens API, permissions et durcissement de l’interface.",
    focus: ["Tokens API", "Permissions", "Journal d’accès"],
  },
  health: {
    slug: "health",
    label: "Santé",
    eyebrow: "Santé",
    title: "État de santé",
    description:
      "Vue rapide de l’état général des services, ressources et erreurs critiques.",
    focus: ["Statut global", "Erreurs critiques", "Disponibilité"],
  },
  resources: {
    slug: "resources",
    label: "Ressources",
    eyebrow: "Resources / GreenIT",
    title: "Capacité, efficacité et GreenIT",
    description:
      "Pilotage de capacité, efficacité énergétique et recommandations GreenIT.",
    focus: ["Capacité", "Énergie / CO2", "Optimisation"],
  },
  monitor: {
    slug: "monitor",
    label: "Monitoring",
    eyebrow: "Monitoring",
    title: "Monitoring",
    description:
      "Métriques temps réel et graphiques d’usage (CPU, RAM, disque, réseau).",
    focus: ["Métriques temps réel", "Graphiques", "Seuils"],
  },
  calendar: {
    slug: "calendar",
    label: "Planification",
    eyebrow: "Planification",
    title: "Planification",
    description:
      "Calendrier des tâches planifiées: backups, snapshots, maintenance, scripts.",
    focus: ["Calendrier", "Tâches planifiées", "Fenêtres de maintenance"],
  },
  alerts: {
    slug: "alerts",
    label: "Alertes",
    eyebrow: "Alertes",
    title: "Alertes",
    description:
      "Configuration et visualisation des alertes (seuils, incidents, notifications).",
    focus: ["Seuils", "Incidents", "Canaux de notification"],
  },
  logs: {
    slug: "logs",
    label: "Journaux",
    eyebrow: "Logs",
    title: "Journaux d’activité",
    description:
      "Journalisation des actions utilisateur, opérations Proxmox et erreurs d’intégration.",
    focus: ["Actions UI", "Événements Proxmox", "Erreurs"],
  },
  reports: {
    slug: "reports",
    label: "Rapports",
    eyebrow: "Rapports",
    title: "Rapports",
    description:
      "Rapports d’usage, disponibilité et capacité pour suivi d’exploitation.",
    focus: ["Usage", "Capacité", "Disponibilité"],
  },
  profile: {
    slug: "profile",
    label: "Profil",
    eyebrow: "Compte",
    title: "Profil utilisateur",
    description:
      "Préférences d’interface, options d’affichage et configuration personnelle.",
    focus: ["Préférences", "Affichage", "Sessions"],
  },
  "account-security": {
    slug: "account-security",
    label: "Sécurité du compte",
    eyebrow: "Compte",
    title: "Sécurité du compte",
    description:
      "Paramètres de sécurité du compte, sessions actives et protections d’accès.",
    focus: ["Sessions", "Tokens", "Audit d’accès"],
  },
};

export function getSectionPage(slug: string): SectionPageConfig | null {
  return SECTION_PAGES[slug] ?? null;
}

export function getSectionSlugs() {
  return Object.keys(SECTION_PAGES);
}
