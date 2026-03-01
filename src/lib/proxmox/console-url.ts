import "server-only";

type WorkloadKind = "qemu" | "lxc";

function encodeNode(node: string) {
  return encodeURIComponent(node);
}

export function buildProxmoxWorkloadConsoleUrl(options: {
  baseUrl: string;
  node: string;
  vmid: number;
  kind: WorkloadKind;
}) {
  const params = new URLSearchParams({
    node: options.node,
    mode: options.kind === "qemu" ? "console" : "xtermjs",
  });
  return `/console/workload/${options.kind}/${options.vmid}?${params.toString()}`;
}

export function buildProxmoxWorkloadNoVncUrl(options: {
  baseUrl: string;
  node: string;
  vmid: number;
}) {
  const params = new URLSearchParams({
    node: options.node,
    mode: "novnc",
  });
  return `/console/workload/qemu/${options.vmid}?${params.toString()}`;
}

export function buildProxmoxWorkloadSpiceUrl(options: {
  baseUrl: string;
  node: string;
  vmid: number;
}) {
  const params = new URLSearchParams({
    node: options.node,
    mode: "spice",
  });
  return `/console/workload/qemu/${options.vmid}?${params.toString()}`;
}

export function buildProxmoxWorkloadXtermUrl(options: {
  baseUrl: string;
  node: string;
  vmid: number;
}) {
  const params = new URLSearchParams({
    node: options.node,
    mode: "xtermjs",
  });
  return `/console/workload/lxc/${options.vmid}?${params.toString()}`;
}

export function buildProxmoxNodeShellUrl(options: { baseUrl: string; node: string }) {
  return `/console/node/${encodeNode(options.node)}`;
}
