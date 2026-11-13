"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function services() {
  const saved = new Map();
  const storage = { getItem: function (key) { return saved.has(key) ? saved.get(key) : null; }, setItem: function (key, value) { saved.set(key, value); } };
  const context = vm.createContext({ window: { localStorage: storage } });
  for (const name of ["common", "machine-settings", "model-base"]) vm.runInContext(fs.readFileSync(path.join(__dirname, "../js/" + name + ".js"), "utf8"), context);
  return { sim: context.window.MoveSim, saved };
}

test("machine acceleration uses integer dmm/s² and persists independently of model presets", function () {
  const { sim } = services();
  const machine = sim.createMachineSettings();
  assert.equal(machine.values.maxAccelerationdmmPerSecondSquared, 20000);
  machine.setMaxAcceleration(12345);
  assert.equal(sim.createMachineSettings().values.maxAccelerationdmmPerSecondSquared, 12345);
  assert.throws(function () { machine.setMaxAcceleration(0); });
  assert.throws(function () { machine.setMaxAcceleration(NaN); });
  assert.throws(function () { machine.setMaxAcceleration(1.5); });
  assert.equal(machine.values.maxAccelerationdmmPerSecondSquared, 12345);
});

test("every model receives the same live machine settings object", function () {
  const { sim } = services();
  const machine = sim.createMachineSettings();
  const first = sim.createModelBase({ id: "first", machineSettings: machine.values });
  const second = sim.createModelBase({ id: "second", machineSettings: machine.values });
  machine.setMaxAcceleration(30000);
  assert.equal(first.machineSettings, second.machineSettings);
  assert.equal(first.machineSettings.maxAccelerationdmmPerSecondSquared, 30000);
});

test("machine settings remain usable when storage is unavailable or unreadable", function () {
  const { sim, saved } = services();
  saved.set("movesim.machine.v1", "unreadable");
  const recovered = sim.createMachineSettings();
  assert.equal(recovered.values.maxAccelerationdmmPerSecondSquared, 20000);
  assert.match(recovered.notice(), /could not be read/);
  assert.equal(saved.get("movesim.machine.v1"), "unreadable");
  const temporary = sim.createMachineSettings(null);
  temporary.setMaxAcceleration(10000);
  assert.equal(temporary.values.maxAccelerationdmmPerSecondSquared, 10000);
  assert.match(temporary.notice(), /this tab only/);
});
