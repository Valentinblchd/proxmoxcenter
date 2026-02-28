import "server-only";

type WorkloadKind = "qemu" | "lxc";

function normalizeBase(baseUrl: string) {
  return baseUrl.replace(/\/+$/, "");
}

export function buildProxmoxWorkloadConsoleUrl(options: {
  baseUrl: string;
  node: string;
  vmid: number;
  kind: WorkloadKind;
}) {
  const params = new URLSearchParams();
  params.set("node", options.node);
  params.set("vmid", String(options.vmid));
  if (options.kind === "qemu") {
    params.set("console", "kvm");
    params.set("novnc", "1");
  } else {
    params.set("console", "lxc");
    params.set("xtermjs", "1");
  }
  return `${normalizeBase(options.baseUrl)}/?${params.toString()}`;
}

export function buildProxmoxNodeShellUrl(options: { baseUrl: string; node: string }) {
  const params = new URLSearchParams({
    node: options.node,
    console: "shell",
    xtermjs: "1",
  });
  return `${normalizeBase(options.baseUrl)}/?${params.toString()}`;
}

