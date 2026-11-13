"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function services() {
  const values = new Map();
  const storage = { getItem: function (key) { return values.has(key) ? values.get(key) : null; }, setItem: function (key, value) { values.set(key, value); } };
  const context = vm.createContext({ window: { MoveSim: {}, localStorage: storage } });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../js/button-controls.js"), "utf8"), context);
  return { values, create: context.window.MoveSim.createButtonSettings };
}

test("button defaults are R1 clock, Start/Menu clear, R2 send and ABXY speeds", function () {
  const { create } = services();
  const settings = create().get();
  assert.equal(settings.mapping.clock, 5);
  assert.equal(settings.mapping.clear, 9);
  assert.equal(settings.mapping.send, 7);
  assert.equal(settings.mapping.bump, 4);
  assert.deepEqual(Array.from(settings.speedsdmmPerSecond), [10, 100, 500, 1000]);
  assert.equal(settings.selectedSpeed, 2);
  assert.equal("sendEnabled" in settings, false);
});

test("adding the Clear default preserves existing Start/Menu assignments", function () {
  const { create, values } = services();
  const oldSettings = create().get();
  delete oldSettings.mapping.clear;
  values.set("movesim.buttons.v1", JSON.stringify(oldSettings));
  assert.equal(create().get().mapping.clear, 9);
  oldSettings.mapping.speed0 = 9;
  values.set("movesim.buttons.v1", JSON.stringify(oldSettings));
  assert.equal(create().get().mapping.clear, null);
  assert.equal(create().get().mapping.speed0, 9);
});

test("last assignment owns a button and persists across all controllers", function () {
  const { create } = services();
  const preferences = create();
  preferences.assign("clock", 0);
  assert.equal(create().get().mapping.clock, 0);
  assert.equal(create().get().mapping.speed0, null);
  preferences.assign("send", 0);
  assert.equal(create().get().mapping.clock, null);
  assert.equal(create().get().mapping.send, 0);
});

test("edited speed slots and the selected slot persist without changing other settings", function () {
  const { create } = services();
  const preferences = create();
  preferences.setSpeed(1, 125);
  preferences.selectSpeed(1);
  const copy = create().get();
  assert.equal(copy.speedsdmmPerSecond[1], 125);
  assert.equal(copy.selectedSpeed, 1);
  copy.speedsdmmPerSecond[1] = 999;
  assert.equal(preferences.get().speedsdmmPerSecond[1], 125);
  assert.throws(function () { preferences.setSpeed(1, 0); });
  assert.throws(function () { preferences.assign("clock", -1); });
});

test("storage failure still permits in-tab button configuration", function () {
  const { create } = services();
  const preferences = create(null);
  preferences.assign("send", 6);
  preferences.setSpeed(0, 20);
  assert.equal(preferences.get().mapping.send, 6);
  assert.match(preferences.notice(), /this tab only/);
});

test("stick clicks are reserved for wheel mode and cannot learn other actions", function () {
  const { create, values } = services();
  const preferences = create();
  assert.throws(function () { preferences.assign("clock", 10); }, /fixed/);
  assert.throws(function () { preferences.assign("send", 11); }, /fixed/);
  const saved = preferences.get();
  saved.mapping.clock = 10;
  saved.mapping.send = 11;
  values.set("movesim.buttons.v1", JSON.stringify(saved));
  const restored = create();
  assert.equal(restored.get().mapping.clock, null);
  assert.equal(restored.get().mapping.send, null);
  assert.equal(restored.get().mapping.clear, 9);
  assert.match(restored.notice(), /reserved/);
});

test("adding Fine bump preserves an older assignment already using L1", function () {
  const {create,values} = services();
  const saved = create().get();
  delete saved.mapping.bump;
  values.set("movesim.buttons.v1",JSON.stringify(saved));
  assert.equal(create().get().mapping.bump,4);
  saved.mapping.clock=4;
  values.set("movesim.buttons.v1",JSON.stringify(saved));
  assert.equal(create().get().mapping.clock,4);
  assert.equal(create().get().mapping.bump,null);
});
