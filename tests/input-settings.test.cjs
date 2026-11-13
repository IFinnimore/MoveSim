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
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../js/input-settings.js"), "utf8"), context);
  return { values, storage, create: context.window.MoveSim.createInputSettings };
}

test("source, controller identity and both stick mappings persist immediately", function () {
  const { create, values } = services();
  const preferences = create();
  preferences.update({ source: "gamepad", controllerId: "Chosen controller", controllerIndex: 2, deadZone: 0.25,
    leftAxisX: 4, leftAxisY: 5, leftInvertX: true, leftInvertY: false,
    rightAxisX: 0, rightAxisY: 1, rightInvertX: true, rightInvertY: false });
  const saved = JSON.parse(values.get(preferences.storageKey));
  assert.equal(saved.source, "gamepad");
  assert.equal(saved.controllerId, "Chosen controller");
  assert.equal(saved.controllerIndex, 2);
  assert.equal(saved.deadZone, 0.25);
  assert.equal(saved.leftAxisX, 4);
  assert.equal(saved.rightAxisY, 1);
  assert.equal(saved.rightInvertY, false);
  assert.equal(JSON.stringify(create().get()), JSON.stringify(preferences.get()));
});

test("incomplete and invalid edits preserve the previous valid selections", function () {
  const { create } = services();
  const preferences = create();
  preferences.update({ leftAxisX: 4, deadZone: 0.25 });
  preferences.update({ source: "invalid", controllerIndex: -1, deadZone: NaN, leftAxisX: 2.5, leftAxisY: 16, rightInvertX: "yes" });
  const current = preferences.get();
  assert.equal(current.source, "joystick");
  assert.equal(current.controllerIndex, null);
  assert.equal(current.deadZone, 0.25);
  assert.equal(current.leftAxisX, 4);
  assert.equal(current.leftAxisY, 1);
  assert.equal(current.rightInvertX, false);
  current.leftAxisX = 9;
  assert.equal(preferences.get().leftAxisX, 4);
});

test("damaged saved fields use defaults while valid fields are restored", function () {
  const { create, values } = services();
  values.set("movesim.input.v1", JSON.stringify({ version: 1, source: "gamepad", rightAxisX: -1, rightAxisY: 7, deadZone: 2, leftInvertY: false }));
  const loaded = create().get();
  assert.equal(loaded.source, "gamepad");
  assert.equal(loaded.rightAxisX, 2);
  assert.equal(loaded.rightAxisY, 7);
  assert.equal(loaded.deadZone, 0.15);
  assert.equal(loaded.leftInvertY, false);
});

test("unreadable saved settings remain untouched until an explicit selection change", function () {
  const { create, values } = services();
  values.set("movesim.input.v1", "invalid JSON");
  const loaded = create();
  assert.equal(loaded.get().source, "joystick");
  assert.match(loaded.notice(), /could not be read/);
  assert.equal(values.get("movesim.input.v1"), "invalid JSON");
  loaded.update({ source: "gamepad" });
  assert.equal(JSON.parse(values.get("movesim.input.v1")).source, "gamepad");
});

test("unavailable or full storage keeps selections usable in the current tab", function () {
  const { create } = services();
  for (const storage of [null, { getItem: function () { return null; }, setItem: function () { throw new Error("Full"); } }]) {
    const preferences = create(storage);
    preferences.update({ source: "gamepad", rightAxisX: 5 });
    assert.equal(preferences.get().rightAxisX, 5);
    assert.match(preferences.notice(), /this tab only/);
  }
});

test("shared wheel scale defaults to 100 mm/rev and saves only the five choices", function () {
  const {create} = services();
  const preferences = create();
  assert.equal(preferences.get().wheelRevolutiondmm, 1000);
  preferences.update({wheelRevolutiondmm:254});
  assert.equal(create().get().wheelRevolutiondmm, 254);
  preferences.update({wheelRevolutiondmm:2000});
  assert.equal(preferences.get().wheelRevolutiondmm, 254);
});
