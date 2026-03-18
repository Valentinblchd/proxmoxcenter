import "server-only";

import { proxmoxRequest } from "@/lib/proxmox/client";

export const OBSERVABILITY_HISTORY_RANGES = [
  { id: "10m", label: "10 min", timeframe: "hour", maxAgeSeconds: 10 * 60 },
  { id: "1h", label: "1 h", timeframe: "hour", maxAgeSeconds: 60 * 60 },
  { id: "1d", label: "1 jour", timeframe: "day", maxAgeSeconds: 24 * 60 * 60 },
  { id: "1w", label: "1 semaine", timeframe: "week", maxAgeSeconds: 7 * 24 * 60 * 60 },
  { id: "1m", label: "1 mois", timeframe: "month", maxAgeSeconds: 31 * 24 * 60 * 60 },
  { id: "1y", label: "1 an", timeframe: "year", maxAgeSeconds: 366 * 24 * 60 * 60 },
] as const;

export type ObservabilityHistoryRangeId = (typeof OBSERVABILITY_HISTORY_RANGES)[number]["id"];

type ProxmoxNodeHistorySample = {
  time?: number;
  cpu?: number;
  maxcpu?: number;
  memused?: number;
  memtotal?: number;
  netin?: number;
  netout?: number;
  rootused?: number;
  roottotal?: number;
  iowait?: number;
};

type AggregatePoint = {
  time: number;
  cpuWeighted: number;
  cpuWeight: number;
  memUsed: number;
  memTotal: number;
  netBytesPerSecond: number;
  diskUsed: number;
  diskTotal: number;
  ioWaitWeighted: number;
  ioWaitWeight: number;
};

export type ObservabilityHistoryPoint = {
  timestamp: string;
  cpuRatio: number;
  memoryRatio: number;
  networkBytesPerSecond: number;
  diskRatio: number;
  ioWaitRatio: number;
};

export type ObservabilityHistorySeries = {
  range: {
    id: ObservabilityHistoryRangeId;
    label: string;
  };
  points: ObservabilityHistoryPoint[];
  summary: {
    cpuRatio: number;
    memoryRatio: number;
    networkBytesPerSecond: number;
    diskRatio: number;
    ioWaitRatio: number;
  } | null;
};

function clampRatio(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(value, 1));
}

function asNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function resolveRange(rangeId: string | null | undefined) {
  return OBSERVABILITY_HISTORY_RANGES.find((entry) => entry.id === rangeId) ?? OBSERVABILITY_HISTORY_RANGES[1];
}

function mergePoint(target: AggregatePoint, sample: ProxmoxNodeHistorySample) {
  const cpuWeight = asNumber(sample.maxcpu) > 0 ? asNumber(sample.maxcpu) : 1;
  target.cpuWeighted += clampRatio(sample.cpu) * cpuWeight;
  target.cpuWeight += cpuWeight;

  target.memUsed += asNumber(sample.memused);
  target.memTotal += asNumber(sample.memtotal);
  target.netBytesPerSecond += Math.max(0, asNumber(sample.netin)) + Math.max(0, asNumber(sample.netout));
  target.diskUsed += asNumber(sample.rootused);
  target.diskTotal += asNumber(sample.roottotal);
  target.ioWaitWeighted += clampRatio(sample.iowait) * cpuWeight;
  target.ioWaitWeight += cpuWeight;
}

export async function readClusterObservabilityHistory(
  nodeNames: string[],
  rangeId: string | null | undefined,
): Promise<ObservabilityHistorySeries> {
  const range = resolveRange(rangeId);
  const dedupedNodes = Array.from(new Set(nodeNames.map((node) => node.trim()).filter(Boolean)));

  if (dedupedNodes.length === 0) {
    return {
      range: {
        id: range.id,
        label: range.label,
      },
      points: [],
      summary: null,
    };
  }

  const histories = await Promise.all(
    dedupedNodes.map(async (node) => {
      try {
        const data = await proxmoxRequest<ProxmoxNodeHistorySample[]>(
          `nodes/${encodeURIComponent(node)}/rrddata?timeframe=${encodeURIComponent(range.timeframe)}&cf=AVERAGE`,
        );
        return Array.isArray(data) ? data : [];
      } catch {
        return [] as ProxmoxNodeHistorySample[];
      }
    }),
  );

  const nowSeconds = Math.floor(Date.now() / 1000);
  const cutoffSeconds = nowSeconds - range.maxAgeSeconds;
  const pointsByTime = new Map<number, AggregatePoint>();

  for (const history of histories) {
    for (const sample of history) {
      const time = typeof sample.time === "number" && Number.isFinite(sample.time) ? sample.time : null;
      if (!time || time < cutoffSeconds) continue;
      const current =
        pointsByTime.get(time) ??
        ({
          time,
          cpuWeighted: 0,
          cpuWeight: 0,
          memUsed: 0,
          memTotal: 0,
          netBytesPerSecond: 0,
          diskUsed: 0,
          diskTotal: 0,
          ioWaitWeighted: 0,
          ioWaitWeight: 0,
        } satisfies AggregatePoint);
      mergePoint(current, sample);
      pointsByTime.set(time, current);
    }
  }

  const points = Array.from(pointsByTime.values())
    .sort((left, right) => left.time - right.time)
    .map((point) => ({
      timestamp: new Date(point.time * 1000).toISOString(),
      cpuRatio: point.cpuWeight > 0 ? point.cpuWeighted / point.cpuWeight : 0,
      memoryRatio: point.memTotal > 0 ? point.memUsed / point.memTotal : 0,
      networkBytesPerSecond: point.netBytesPerSecond,
      diskRatio: point.diskTotal > 0 ? point.diskUsed / point.diskTotal : 0,
      ioWaitRatio: point.ioWaitWeight > 0 ? point.ioWaitWeighted / point.ioWaitWeight : 0,
    }));

  const latest = points.at(-1) ?? null;

  return {
    range: {
      id: range.id,
      label: range.label,
    },
    points,
    summary: latest
      ? {
          cpuRatio: latest.cpuRatio,
          memoryRatio: latest.memoryRatio,
          networkBytesPerSecond: latest.networkBytesPerSecond,
          diskRatio: latest.diskRatio,
          ioWaitRatio: latest.ioWaitRatio,
        }
      : null,
  };
}
