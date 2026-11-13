"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function fixture(settings, acceleration) {
  const context = vm.createContext({ window: {} });
  for (const name of ["common", "presets", "messages", "wheel-input", "input", "model-base", "model-g91-incremental"]) vm.runInContext(fs.readFileSync(path.join(__dirname, "../js/" + name + ".js"), "utf8"), context);
  const sim = context.window.MoveSim;
  const input = sim.createInputHistory();
  const messages = sim.createMessageLog();
  const machine = { maxAccelerationdmmPerSecondSquared: acceleration || 20000 };
  const model = sim.createG91Model({ input, messages, settings, machineSettings: machine });
  function record(timeMs, x, y, run, speed) { input.record(timeMs, x, y, "joystick", { sendEnabled: run, speeddmmPerSecond: speed === undefined ? 500 : speed }); }
  return { input, messages, machine, model, record };
}
function close(actual, expected) { assert.ok(Math.abs(actual - expected) < 1e-6, actual + " should equal " + expected); }

test("G91 waits for run and its first duration boundary", function () {
  const { model, record } = fixture();
  record(0, 1, 0, false);
  model.advanceTo(100);
  assert.equal(model.blocks.length, 0);
  record(101, 1, 0, true);
  model.advanceTo(199);
  close(model.stateAt(199).positionXdmm, 2000);
  model.advanceTo(200);
  assert.equal(model.blocks[0].startTimeMs, 200);
  assert.equal(model.blocks[0].durationMs, 100);
});

test("G91 integrates acceleration exactly and then holds the target", function () {
  const { model, record } = fixture();
  record(0, 1, 0.5, true);
  model.advanceTo(200);
  close(model.stateAt(110).velocityXdmmPerSecond, 200);
  close(model.stateAt(110).positionXdmm, 2001);
  close(model.stateAt(200).positionXdmm, 2043.75);
  close(model.stateAt(200).positionYdmm, 2023.4375);
  close(model.stateAt(200).velocityXdmmPerSecond, 500);
  assert.equal(model.blocks[1].nodes[0].velocityXdmmPerSecond, 500);
});

test("a target too far away carries the velocity reached across fixed blocks", function () {
  const { model, record } = fixture({}, 1000);
  record(0, 1, 0, true);
  model.advanceTo(300);
  close(model.stateAt(200).velocityXdmmPerSecond, 100);
  close(model.stateAt(300).velocityXdmmPerSecond, 200);
  close(model.stateAt(300).positionXdmm, 2020);
  assert.equal(model.blocks[0].durationMs, 100);
  assert.equal(model.blocks[1].durationMs, 100);
});

test("a created block is immutable and reversal uses the next boundary's latest input", function () {
  const { model, record } = fixture();
  record(0, 1, 0, true);
  record(150, -1, 0, true);
  model.advanceTo(140);
  const saved = JSON.stringify(model.blocks[0]);
  model.advanceTo(300);
  assert.equal(JSON.stringify(model.blocks[0]), saved);
  close(model.stateAt(175).velocityXdmmPerSecond, 500);
  close(model.stateAt(225).velocityXdmmPerSecond, 0);
  close(model.stateAt(300).velocityXdmmPerSecond, -500);
  close(model.stateAt(300).positionXdmm, 2018.75);
});

test("stop finishes the current block and then ramps to zero", function () {
  const { model, record } = fixture();
  record(0, 1, 0, true);
  record(150, 1, 0, false);
  model.advanceTo(200);
  assert.equal(model.blocks[0].stopping, false);
  assert.equal(model.blocks[1].stopping, true);
  close(model.stateAt(199).velocityXdmmPerSecond, 500);
  model.advanceTo(500);
  close(model.stateAt(225).velocityXdmmPerSecond, 0);
  close(model.stateAt(500).positionXdmm, 2050);
  assert.equal(model.status, "stopped");
  assert.equal(model.blocks.length, 2);
});

test("stop can require several fixed windows and remains acceleration limited", function () {
  const { model, record } = fixture({}, 1000);
  record(0, 1, 0, true);
  record(250, 1, 0, false);
  model.advanceTo(600);
  close(model.stateAt(300).velocityXdmmPerSecond, 200);
  close(model.stateAt(400).velocityXdmmPerSecond, 100);
  close(model.stateAt(500).velocityXdmmPerSecond, 0);
  close(model.stateAt(600).positionXdmm, 2040);
  assert.equal(model.status, "stopped");
});

test("settings and machine changes leave the current block intact", function () {
  const { model, machine, record } = fixture();
  record(0, 0.5, 0, true);
  model.advanceTo(150);
  const saved = JSON.stringify(model.blocks[0]);
  machine.maxAccelerationdmmPerSecondSquared = 1000;
  model.applySettings({ proportional: false, moveDurationMs: 50 }, 150);
  model.advanceTo(250);
  assert.equal(JSON.stringify(model.blocks[0]), saved);
  assert.equal(model.blocks[1].startTimeMs, 200);
  assert.equal(model.blocks[1].durationMs, 50);
  assert.equal(model.blocks[1].targetVelocityXdmmPerSecond, 500);
  assert.equal(model.blocks[1].maximumAccelerationdmmPerSecondSquared, 1000);
});

test("walls cancel only the blocked axis for the rest of the block", function () {
  const { model, record } = fixture();
  record(0, 1, 0.1, true, 10000);
  model.advanceTo(700);
  close(model.stateAt(700).positionXdmm, 4000);
  close(model.stateAt(700).velocityXdmmPerSecond, 0);
  close(model.stateAt(700).positionYdmm, 2575);
  close(model.stateAt(700).velocityYdmmPerSecond, 1000);
  assert.ok(model.points.every(function (point) { return Number.isInteger(point.positionXdmm) && point.positionXdmm >= 0 && point.positionXdmm <= 4000; }));
});

test("G91 results and recorded plans do not depend on frame cadence", function () {
  function run(frames) {
    const { model, record, messages } = fixture();
    record(0, 0.6, -0.2, true);
    record(149, -0.3, 0.8, true, 750);
    record(451, 1, 1, false);
    record(701, 0.1, -1, true, 200);
    frames.forEach(function (timeMs) { model.advanceTo(timeMs); });
    return JSON.stringify({ points: model.points, velocities: model.velocityHistory, blocks: model.blocks, messages: messages.entries });
  }
  assert.equal(run([1000]), run([0, 17, 101, 150, 208, 450, 601, 777, 1000]));
});
