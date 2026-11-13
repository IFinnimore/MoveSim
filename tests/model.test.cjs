"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function services() {
  const context = vm.createContext({ window: {} });
  for (const name of ["common", "clock", "messages", "presets", "wheel-input", "input", "model-base", "model-just-draw"]) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, "../js/" + name + ".js"), "utf8"), context, { filename: name + ".js" });
  }
  const sim = context.window.MoveSim;
  const input = sim.createInputHistory();
  input.clear("joystick", { sendEnabled: true, speeddmmPerSecond: 500 });
  const messages = sim.createMessageLog();
  function model(settings, id) {
    const parameters = Object.assign({}, settings);
    if (parameters.speeddmmPerSecond !== undefined) {
      const initial = input.history[0];
      input.record(0, initial.x, initial.y, initial.source, { sendEnabled: true, speeddmmPerSecond: parameters.speeddmmPerSecond });
      delete parameters.speeddmmPerSecond;
    }
    return sim.createJustDrawModel({ id, settings: parameters, input, messages });
  }
  return { sim, input, messages, model };
}

function close(actual, expected) { assert.ok(Math.abs(actual - expected) < 1e-7, actual + " should equal " + expected); }

test("master clock freezes and resumes without wall-time catch-up", function () {
  const { sim } = services();
  let wallTime = 100;
  const clock = sim.createClock(function () { return wallTime; });
  assert.equal(clock.isRunning(), false);
  wallTime = 145;
  assert.equal(clock.now(), 0);
  clock.resume();
  wallTime = 190;
  assert.equal(clock.now(), 45);
  clock.pause();
  wallTime = 10000;
  assert.equal(clock.now(), 45);
  clock.resume();
  wallTime += 25;
  assert.equal(clock.now(), 70);
  clock.pause();
  clock.clear();
  assert.equal(clock.now(), 0);
  assert.equal(clock.isRunning(), false);
});

test("inactivity pauses at 60 seconds, not before", function () {
  const { sim } = services();
  let wallTime = 0;
  const activity = sim.createActivityTimer(60000, function () { return wallTime; });
  wallTime = 59999;
  assert.equal(activity.shouldPause(false), false);
  wallTime = 60000;
  assert.equal(activity.shouldPause(false), true);
});

test("operator input and a fresh resume interval reset inactivity", function () {
  const { sim } = services();
  let wallTime = 0;
  const activity = sim.createActivityTimer(60000, function () { return wallTime; });
  wallTime = 45000;
  activity.noteInput();
  wallTime = 104999;
  assert.equal(activity.shouldPause(false), false);
  wallTime = 105000;
  assert.equal(activity.shouldPause(false), true);
  wallTime = 500000;
  activity.noteInput();
  assert.equal(activity.shouldPause(false), false);
});

test("a held direction remains active until a full minute after release", function () {
  const { sim } = services();
  let wallTime = 0;
  const activity = sim.createActivityTimer(60000, function () { return wallTime; });
  wallTime = 60000;
  assert.equal(activity.shouldPause(true), false);
  wallTime = 120000;
  assert.equal(activity.shouldPause(true), false);
  wallTime = 179999;
  assert.equal(activity.shouldPause(false), false);
  wallTime = 180000;
  assert.equal(activity.shouldPause(false), true);
});

test("Just Draw ignores magnitude and uses full speed separately on each axis", function () {
  const { input, model } = services();
  input.record(0, 0.2, -0.9, "joystick");
  const baseline = model();
  baseline.advanceTo(1000);
  const state = baseline.stateAt(1000);
  close(state.positionXdmm, 2500);
  close(state.positionYdmm, 1500);
  assert.equal(state.velocityXdmmPerSecond, 500);
  assert.equal(state.velocityYdmmPerSecond, -500);
});

test("sampling, send cadence and delay remain distinct", function () {
  const { input, messages, model } = services();
  input.record(5, 1, 0, "joystick");
  const baseline = model({ sampleIntervalMs: 20, messageIntervalMs: 30, deliveryDelayMs: 7 });
  baseline.advanceTo(36);
  close(baseline.stateAt(36).positionXdmm, 2000);
  assert.equal(messages.entries[1].sampledTimeMs, 20);
  assert.equal(messages.entries[1].sentTimeMs, 30);
  assert.equal(messages.entries[1].receivedTimeMs, null);
  baseline.advanceTo(47);
  assert.equal(messages.entries[1].receivedTimeMs, 37);
  close(baseline.stateAt(47).positionXdmm, 2005);
});

test("zero delay delivers in the same simulation event", function () {
  const { input, messages, model } = services();
  input.record(0, 1, 0, "joystick");
  const baseline = model();
  baseline.advanceTo(0);
  assert.equal(messages.entries[0].receivedTimeMs, 0);
  assert.equal(baseline.stateAt(0).velocityXdmmPerSecond, 500);
});

test("applying live settings retains position and history and starts new timing cycles", function () {
  const { input, messages, model } = services();
  input.record(0, 1, 0, "joystick");
  const baseline = model();
  baseline.advanceTo(100);
  const earlierPoints = JSON.stringify(baseline.points);
  const earlierMessageIds = Array.from(messages.entries, function (message) { return message.id; });
  input.record(101, 1, 0, "joystick", { sendEnabled: true, speeddmmPerSecond: 1000 });
  baseline.applySettings({ sampleIntervalMs: 10, messageIntervalMs: 25 }, 100);
  close(baseline.stateAt(100).positionXdmm, 2050);
  assert.equal(JSON.stringify(baseline.points), earlierPoints);
  baseline.advanceTo(200);
  close(baseline.stateAt(200).positionXdmm, 2137.5);
  close(baseline.stateAt(50).positionXdmm, 2025);
  assert.deepEqual(Array.from(messages.entries.slice(0, earlierMessageIds.length), function (message) { return message.id; }), earlierMessageIds);
  assert.equal(baseline.settingsHistory[1].timeMs, 100);
  assert.equal(baseline.settingsHistory[1].parameters.sampleIntervalMs, 10);
  baseline.clear();
  assert.equal(baseline.settingsHistory.length, 1);
  assert.equal(baseline.settingsHistory[0].timeMs, 0);
  assert.equal(baseline.settingsHistory[0].parameters.sampleIntervalMs, 10);
});

test("changing latency preserves old deliveries and permits earlier new arrivals", function () {
  const { input, messages, model } = services();
  input.record(0, 1, 0, "joystick");
  const baseline = model({ deliveryDelayMs: 100 });
  baseline.advanceTo(50);
  input.record(51, 1, 0, "joystick", { sendEnabled: true, speeddmmPerSecond: 1000 });
  baseline.applySettings({ deliveryDelayMs: 0 }, 50);
  baseline.advanceTo(105);
  assert.equal(messages.entries.find(function (message) { return message.sentTimeMs === 70; }).receivedTimeMs, 70);
  assert.equal(messages.entries[0].receivedTimeMs, 100);
  assert.equal(baseline.stateAt(105).velocityXdmmPerSecond, 500);
  close(baseline.stateAt(105).positionXdmm, 2032.5);
});

test("results and recorded points do not depend on rendering cadence", function () {
  function run(frameTimes) {
    const { input, messages, model } = services();
    for (const [time, x, y] of [[7, 0.8, 0], [149, 1, 1], [311, -1, 0], [801, 0, 0]]) input.record(time, x, y, "joystick");
    const baseline = model({ sampleIntervalMs: 17, messageIntervalMs: 23, deliveryDelayMs: 11 });
    for (const time of frameTimes) baseline.advanceTo(time);
    return JSON.stringify({ points: baseline.points, velocities: baseline.velocityHistory, messages: messages.entries, state: baseline.stateAt(1000) });
  }
  assert.equal(run([1000]), run([0, 1, 16, 73, 74, 200, 333, 999, 1000]));
});

test("a boundary stops only its axis, with exact hit timing and inward recovery", function () {
  const { input, model } = services();
  input.record(0, 1, 0, "joystick");
  input.record(201, 1, 1, "joystick");
  input.record(4501, -1, 0, "joystick");
  const baseline = model();
  baseline.advanceTo(4100);
  const wall = baseline.stateAt(4100);
  close(wall.positionXdmm, 4000);
  close(wall.positionYdmm, 3940);
  assert.equal(wall.velocityXdmmPerSecond, 0);
  assert.equal(wall.velocityYdmmPerSecond, 500);
  assert.ok(baseline.velocityHistory.some(function (point) { return point.timeMs === 4000 && point.velocityXdmmPerSecond === 0 && point.velocityYdmmPerSecond === 500; }));
  baseline.advanceTo(4600);
  close(baseline.stateAt(4600).positionXdmm, 3960);
  close(baseline.stateAt(4600).positionYdmm, 4000);
});

test("boundary hit can occur between samples at a fractional millisecond", function () {
  const { input, model } = services();
  input.record(0, 1, 0, "joystick");
  const baseline = model({ speeddmmPerSecond: 777 });
  baseline.advanceTo(3000);
  const stop = baseline.velocityHistory.find(function (point) { return point.velocityXdmmPerSecond === 0; });
  close(stop.timeMs, 2000 / 777 * 1000);
  close(baseline.stateAt(3000).positionXdmm, 4000);
});

test("fractional travel survives while public coordinates remain integers", function () {
  const { input, model } = services();
  input.record(0, 1, 0, "joystick");
  const baseline = model({ sampleIntervalMs: 1, messageIntervalMs: 1, speeddmmPerSecond: 1 });
  baseline.advanceTo(1000);
  close(baseline.stateAt(1000).positionXdmm, 2001);
  assert.ok(baseline.points.every(function (point) { return Number.isInteger(point.positionXdmm) && Number.isInteger(point.positionYdmm); }));
});

test("hidden and visible models share input and both record output", function () {
  const { input, model } = services();
  input.record(0, 1, 0, "joystick");
  const visible = model({}, "visible");
  const hidden = model({}, "hidden");
  hidden.visible = false;
  [visible, hidden].forEach(function (item) { item.advanceTo(100); });
  close(visible.stateAt(100).positionXdmm, 2050);
  close(hidden.stateAt(100).positionXdmm, 2050);
  assert.ok(hidden.points.length > 1);
});

test("history inspection does not rewind execution; clear resets pending delivery", function () {
  const { input, messages, model } = services();
  input.record(0, 1, 0, "joystick");
  const baseline = model({ deliveryDelayMs: 100 });
  baseline.advanceTo(200);
  close(baseline.stateAt(150).positionXdmm, 2025);
  assert.equal(baseline.latestTimeMs, 200);
  assert.throws(function () { baseline.advanceTo(100); }, /forwards/);
  input.clear();
  messages.clear();
  baseline.clear();
  assert.equal(baseline.points.length, 1);
  assert.equal(baseline.stateAt(0).positionXdmm, 2000);
  baseline.advanceTo(200);
  close(baseline.stateAt(200).positionXdmm, 2000);
  assert.ok(messages.entries.every(function (message) { return message.velocityXdmmPerSecond === 0; }));
});

test("gate intersection checks crossings, misses, tangencies, and stationary points", function () {
  const { sim } = services();
  const square = { positionXdmm: 100, positionYdmm: 100, sizedmm: 100 };
  const point = function (x, y) { return { positionXdmm: x, positionYdmm: y }; };
  assert.equal(sim.segmentIntersectsSquare(point(0, 150), point(300, 150), square), true);
  assert.equal(sim.segmentIntersectsSquare(point(0, 99), point(300, 99), square), false);
  assert.equal(sim.segmentIntersectsSquare(point(0, 100), point(300, 100), square), true);
  assert.equal(sim.segmentIntersectsSquare(point(150, 150), point(150, 150), square), true);
  assert.equal(sim.segmentIntersectsSquare(point(0, 0), point(0, 0), square), false);
});

test("Just Draw waits for Send before moving or sending messages", function () {
  const { sim, messages } = services();
  const input = sim.createInputHistory();
  input.record(0, 1, 0, "joystick");
  const model = sim.createJustDrawModel({ input, messages });
  model.advanceTo(100);
  assert.equal(input.at(0).sendEnabled, false);
  assert.equal(messages.entries.length, 0);
  close(model.stateAt(100).positionXdmm, 2000);
});

test("Just Draw stops between polls and cancels delayed commands, even while hidden", function () {
  const { input, messages, model } = services();
  input.record(0, 1, 0, "joystick");
  input.record(51, 1, 0, "joystick", { sendEnabled: false, speeddmmPerSecond: 500 });
  input.record(81, 0, 1, "joystick", { sendEnabled: true, speeddmmPerSecond: 500 });
  const baseline = model({ deliveryDelayMs: 30 });
  baseline.visible = false;
  baseline.advanceTo(200);
  close(baseline.stateAt(51).positionXdmm, 2010.5);
  close(baseline.stateAt(129).positionXdmm, 2010.5);
  close(baseline.stateAt(129).positionYdmm, 2000);
  close(baseline.stateAt(200).positionXdmm, 2010.5);
  close(baseline.stateAt(200).positionYdmm, 2035);
  assert.equal(baseline.stateAt(200).velocityXdmmPerSecond, 0);
  assert.equal(messages.entries.find(message => message.sentTimeMs === 40).cancelledTimeMs, 51);
  assert.equal(messages.entries.some(message => message.sentTimeMs > 51 && message.sentTimeMs < 81), false);
});

test("Just Draw proportional input scales both signed axes", function () {
  const { input, model } = services();
  input.record(0, 0.5, -0.2, "joystick");
  const baseline = model({ proportional: true });
  baseline.advanceTo(1000);
  close(baseline.stateAt(1000).positionXdmm, 2250);
  close(baseline.stateAt(1000).positionYdmm, 1900);
  baseline.applySettings({ proportional: false }, 1000);
  baseline.advanceTo(1100);
  assert.equal(baseline.stateAt(1100).velocityXdmmPerSecond, 500);
});

test("new messages use the current external speed even between input samples", function () {
  const { input, messages, model } = services();
  input.record(0, 1, 0, "joystick");
  input.record(5, 1, 0, "joystick", { sendEnabled: true, speeddmmPerSecond: 1000 });
  const baseline = model({ sampleIntervalMs: 100 });
  baseline.advanceTo(40);
  assert.equal(messages.entries[0].requestedSpeeddmmPerSecond, 500);
  assert.equal(messages.entries[1].requestedSpeeddmmPerSecond, 1000);
  assert.equal(messages.entries[1].sampledTimeMs, 0);
  close(baseline.stateAt(40).positionXdmm, 2030);
});
