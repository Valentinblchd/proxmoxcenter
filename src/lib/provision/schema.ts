export type ProvisionKind = "qemu" | "lxc";
export type WorkloadPowerAction = "start" | "stop" | "shutdown" | "reboot";

export type ProvisionPresetId =
  | "windows-server"
  | "linux-vm"
  | "debian-lxc"
  | "ubuntu-lxc"
  | "generic";

export type ProvisionDraft = {
  kind: ProvisionKind;
  presetId: ProvisionPresetId;
  node: string;
  vmid: string;
  name: string;
  memoryMiB: string;
  cores: string;
  sockets: string;
  diskGb: string;
  storage: string;
  bridge: string;
  ostype: string;
  cpuType: string;
  isoSourceMode: "existing" | "url";
  isoVolume: string;
  isoUrl: string;
  isoStorage: string;
  isoFilename: string;
  bios: "seabios" | "ovmf";
  machine: "i440fx" | "q35";
  enableAgent: boolean;
  enableTpm: boolean;
  lxcTemplate: string;
  lxcSwapMiB: string;
  lxcPassword: string;
  lxcUnprivileged: boolean;
};

export type ProvisionPreset = {
  id: ProvisionPresetId;
  label: string;
  kind: ProvisionKind | "any";
  description: string;
  draftPatch: Partial<ProvisionDraft>;
};

export const DEFAULT_QEMU_DRAFT: ProvisionDraft = {
  kind: "qemu",
  presetId: "generic",
  node: "",
  vmid: "",
  name: "",
  memoryMiB: "4096",
  cores: "2",
  sockets: "1",
  diskGb: "64",
  storage: "local-lvm",
  bridge: "vmbr0",
  ostype: "l26",
  cpuType: "x86-64-v2-AES",
  isoSourceMode: "existing",
  isoVolume: "",
  isoUrl: "",
  isoStorage: "",
  isoFilename: "",
  bios: "ovmf",
  machine: "q35",
  enableAgent: true,
  enableTpm: false,
  lxcTemplate: "",
  lxcSwapMiB: "512",
  lxcPassword: "",
  lxcUnprivileged: true,
};

export const DEFAULT_LXC_DRAFT: ProvisionDraft = {
  ...DEFAULT_QEMU_DRAFT,
  kind: "lxc",
  presetId: "debian-lxc",
  memoryMiB: "2048",
  cores: "2",
  diskGb: "16",
  ostype: "l26",
  bios: "ovmf",
  machine: "q35",
  enableAgent: false,
  enableTpm: false,
  lxcTemplate: "",
};

export const PROVISION_PRESETS: ProvisionPreset[] = [
  {
    id: "windows-server",
    label: "Windows Server (VM)",
    kind: "qemu",
    description: "VM QEMU prête pour Windows Server (UEFI/Q35, TPM optionnel).",
    draftPatch: {
      kind: "qemu",
      memoryMiB: "8192",
      cores: "4",
      sockets: "1",
      diskGb: "120",
      ostype: "win11",
      bios: "ovmf",
      machine: "q35",
      enableAgent: true,
      enableTpm: true,
      presetId: "windows-server",
    },
  },
  {
    id: "linux-vm",
    label: "Linux VM",
    kind: "qemu",
    description: "VM Linux générique (QEMU) avec virtio + guest agent.",
    draftPatch: {
      kind: "qemu",
      memoryMiB: "4096",
      cores: "2",
      diskGb: "40",
      ostype: "l26",
      bios: "ovmf",
      machine: "q35",
      enableAgent: true,
      enableTpm: false,
      presetId: "linux-vm",
    },
  },
  {
    id: "debian-lxc",
    label: "Debian LXC",
    kind: "lxc",
    description: "Conteneur Debian léger (DHCP, rootfs local).",
    draftPatch: {
      kind: "lxc",
      memoryMiB: "2048",
      cores: "2",
      diskGb: "12",
      lxcSwapMiB: "512",
      lxcUnprivileged: true,
      presetId: "debian-lxc",
    },
  },
  {
    id: "ubuntu-lxc",
    label: "Ubuntu LXC",
    kind: "lxc",
    description: "Conteneur Ubuntu standard pour services/apps.",
    draftPatch: {
      kind: "lxc",
      memoryMiB: "2048",
      cores: "2",
      diskGb: "16",
      lxcSwapMiB: "512",
      lxcUnprivileged: true,
      presetId: "ubuntu-lxc",
    },
  },
  {
    id: "generic",
    label: "Générique",
    kind: "any",
    description: "Formulaire libre pour VM ou LXC.",
    draftPatch: {
      presetId: "generic",
    },
  },
];

export function getDefaultDraft(kind: ProvisionKind): ProvisionDraft {
  return kind === "lxc" ? { ...DEFAULT_LXC_DRAFT } : { ...DEFAULT_QEMU_DRAFT };
}

export function getPresetById(presetId: string | null | undefined) {
  return PROVISION_PRESETS.find((preset) => preset.id === presetId) ?? null;
}

export function applyPresetToDraft(draft: ProvisionDraft, presetId: ProvisionPresetId) {
  const preset = getPresetById(presetId);
  if (!preset) return draft;
  const nextKind =
    preset.kind === "any" ? draft.kind : preset.kind;
  const base = getDefaultDraft(nextKind);
  return {
    ...base,
    ...draft,
    ...preset.draftPatch,
    kind: nextKind,
    presetId,
  };
}

export function coerceProvisionKind(value: string | null | undefined): ProvisionKind {
  return value === "lxc" ? "lxc" : "qemu";
}

export type AssistantIntentResponse = {
  ok: boolean;
  intent: "create-workload" | "workload-action" | "unknown";
  message: string;
  draft?: Partial<ProvisionDraft>;
  suggestedKind?: ProvisionKind;
  followUps?: string[];
  actionDraft?: {
    action?: WorkloadPowerAction;
    kind?: ProvisionKind;
    node?: string;
    vmid?: string;
  };
  actionReady?: boolean;
};
