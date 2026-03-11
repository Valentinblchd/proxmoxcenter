import assert from "node:assert/strict";
import test from "node:test";
import ilo5MemoryAbsent from "@/lib/hardware/__fixtures__/hpe-ilo5-memory-absent.json";
import ilo5Power from "@/lib/hardware/__fixtures__/hpe-ilo5-power.json";
import ilo5Processor from "@/lib/hardware/__fixtures__/hpe-ilo5-processor.json";
import ilo5Thermal from "@/lib/hardware/__fixtures__/hpe-ilo5-thermal.json";
import ilo6DriveWarning from "@/lib/hardware/__fixtures__/hpe-ilo6-drive-warning.json";
import ilo6MemoryPresent from "@/lib/hardware/__fixtures__/hpe-ilo6-memory-present.json";
import ilo6Power from "@/lib/hardware/__fixtures__/hpe-ilo6-power.json";
import { __redfishTestUtils } from "@/lib/hardware/redfish-shared";

test("collectTemperatureSensors ignores absent HPE sensors and keeps CPU readings", () => {
  const sensors = __redfishTestUtils.collectTemperatureSensors(ilo5Thermal, "/redfish/v1/Chassis/1/Thermal");
  assert.equal(sensors.length, 4);
  assert.equal(sensors.some((sensor) => sensor.name === "18-PCI 1"), false);
  assert.equal(
    sensors.find((sensor) => sensor.name === "30-CPU 1 PkgTmp")?.readingC,
    47,
  );
});

test("parseProcessor derives CPU temperature from HPE thermal payload", () => {
  const sensors = __redfishTestUtils.collectTemperatureSensors(ilo5Thermal, "/redfish/v1/Chassis/1/Thermal");
  const processor = __redfishTestUtils.parseProcessor(ilo5Processor, sensors);
  assert.equal(processor.totalCores, 14);
  assert.equal(processor.temperatureC, 47);
  assert.equal(processor.health, "ok");
});

test("parseMemoryModule skips absent slots and keeps enabled DIMMs", () => {
  assert.equal(__redfishTestUtils.parseMemoryModule(ilo5MemoryAbsent), null);
  const module = __redfishTestUtils.parseMemoryModule(ilo6MemoryPresent);
  assert.ok(module);
  assert.equal(module?.capacityBytes, 16384 * 1024 * 1024);
  assert.equal(module?.health, "ok");
});

test("parseDrive flags warning NVMe drive with predicted failure", () => {
  const drive = __redfishTestUtils.parseDrive(ilo6DriveWarning);
  assert.ok(drive);
  assert.equal(drive?.health, "warning");
  assert.equal(drive?.predictedFailure, true);
  assert.equal(drive?.temperatureC, 54);
});

test("parsePowerMetrics supports HPE iLO5 and iLO6 power payloads", () => {
  const ilo5Metrics = __redfishTestUtils.parsePowerMetrics(ilo5Power, "ilo5");
  assert.ok(ilo5Metrics);
  assert.equal(ilo5Metrics?.currentWatts, 103);
  assert.equal(ilo5Metrics?.averageWatts, 90);
  assert.equal(ilo5Metrics?.cpuWatts, 28);
  assert.equal(ilo5Metrics?.memoryWatts, 3);

  const ilo6Metrics = __redfishTestUtils.parsePowerMetrics(ilo6Power, "ilo6");
  assert.ok(ilo6Metrics);
  assert.equal(ilo6Metrics?.currentWatts, 248);
  assert.equal(ilo6Metrics?.maxWatts, 271);
  assert.equal(ilo6Metrics?.gpuWatts, 18);
});
