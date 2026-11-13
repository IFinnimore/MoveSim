"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function notebook() {
  const values = new Map();
  const storage = { getItem: function (key) { return values.has(key) ? values.get(key) : null; }, setItem: function (key, value) { values.set(key, value); } };
  const context = vm.createContext({ window: { localStorage: storage } });
  for (const name of ["common", "presets"]) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, "../js/" + name + ".js"), "utf8"), context, { filename: name + ".js" });
  }
  const sim = context.window.MoveSim;
  const schema = {
    speed: { label: "speed", defaultValue: 500, minimum: 1, maximum: 10000, integer: true },
    sampleMs: { label: "sample time", defaultValue: 20, minimum: 1, maximum: 10000, integer: true }
  };
  function store(modelId, suppliedStorage) {
    return sim.createPresetStore({ modelId: modelId || "test-model", parameterSchema: schema, storage: suppliedStorage === undefined ? storage : suppliedStorage });
  }
  return { sim, values, storage, schema, store };
}

test("an empty notebook offers model defaults without changing browser storage", function () {
  const { store, values } = notebook();
  const sets = store();
  assert.equal(sets.list().length, 1);
  assert.equal(sets.get("Defaults").parameters.speed, 500);
  assert.equal(sets.get("Defaults").note, "");
  assert.equal(values.size, 0);
});

test("save and reload preserve parameters and multiline observations per model", function () {
  const { store } = notebook();
  const sets = store();
  sets.save("  Slow approach  ", "Coarse near gates.\nRetest X/Y ± direction.", { speed: 125, sampleMs: 50 });
  const loaded = store().get("Slow approach");
  assert.equal(loaded.name, "Slow approach");
  assert.equal(loaded.note, "Coarse near gates.\nRetest X/Y ± direction.");
  assert.equal(loaded.parameters.speed, 125);
  assert.equal(loaded.parameters.sampleMs, 50);
  assert.equal(store("another-model").list().length, 1);
});

test("saving an existing name updates the set instead of making a duplicate", function () {
  const { store } = notebook();
  const sets = store();
  sets.save("Trial", "First", { speed: 100, sampleMs: 10 });
  sets.save("trial", "Updated", { speed: 200, sampleMs: 25 });
  assert.equal(sets.list().length, 2);
  assert.equal(sets.get("TRIAL").note, "Updated");
  assert.equal(sets.get("Trial").parameters.speed, 200);
});

test("the list stays alphabetical after save and rename, and deletion selects its neighbour", function () {
  const { store } = notebook();
  const sets = store();
  sets.save("zebra", "", { speed: 100, sampleMs: 20 });
  sets.save("Alpha", "", { speed: 200, sampleMs: 20 });
  assert.deepEqual(Array.from(sets.list(), function (preset) { return preset.name; }), ["Alpha", "Defaults", "zebra"]);
  sets.rename("zebra", "Beta");
  assert.deepEqual(Array.from(store().list(), function (preset) { return preset.name; }), ["Alpha", "Beta", "Defaults"]);
  assert.equal(sets.remove("Alpha").preset.name, "Beta");
});

test("rename preserves observations and parameters and rejects collisions", function () {
  const { store } = notebook();
  const sets = store();
  sets.save("Trial", "Keep this observation", { speed: 100, sampleMs: 10 });
  sets.rename("Trial", "Slalom");
  assert.equal(sets.get("Slalom").note, "Keep this observation");
  assert.equal(sets.get("Slalom").parameters.speed, 100);
  assert.throws(function () { sets.get("Trial"); }, /Choose a saved set/);
  assert.throws(function () { sets.rename("Slalom", "defaults"); }, /already in use/);
  assert.equal(store().get("Slalom").parameters.sampleMs, 10);
});

test("deleting the last set restores factory defaults even if Defaults was edited", function () {
  const { store } = notebook();
  const sets = store();
  sets.save("Defaults", "Edited default", { speed: 999, sampleMs: 999 });
  sets.save("Trial", "Observation", { speed: 100, sampleMs: 10 });
  assert.equal(sets.remove("Defaults").resetToDefaults, false);
  const result = sets.remove("Trial");
  assert.equal(result.resetToDefaults, true);
  assert.equal(result.preset.name, "Defaults");
  assert.equal(result.preset.note, "");
  assert.equal(result.preset.parameters.speed, 500);
  assert.equal(store().list().length, 1);
});

test("returned data cannot modify the notebook or its factory defaults", function () {
  const { store } = notebook();
  const sets = store();
  const read = sets.get("Defaults");
  read.parameters.speed = 1;
  read.note = "Changed elsewhere";
  sets.list().pop();
  assert.equal(sets.get("Defaults").parameters.speed, 500);
  assert.equal(sets.get("Defaults").note, "");
  assert.equal(sets.list().length, 1);
});

test("invalid parameter values or names do not replace a saved experiment", function () {
  const { store } = notebook();
  const sets = store();
  sets.save("Trial", "Keep", { speed: 100, sampleMs: 20 });
  for (const sampleMs of [0, -1, 1.5, Infinity, NaN, "20"]) {
    assert.throws(function () { sets.save("Trial", "Bad replacement", { speed: 100, sampleMs }); }, /sample time/);
  }
  assert.throws(function () { sets.save(" ", "", { speed: 100 }); }, /name/);
  assert.throws(function () { sets.save("Long note", "a".repeat(2001), { speed: 100 }); }, /2,000/);
  assert.equal(store().get("Trial").note, "Keep");
});

test("unreadable saved data is left untouched until an explicit write", function () {
  const { store, values } = notebook();
  const key = store().storageKey;
  values.set(key, "not a notebook");
  const sets = store();
  assert.equal(sets.get("Defaults").parameters.speed, 500);
  assert.match(sets.notice(), /could not be read/);
  assert.equal(values.get(key), "not a notebook");
});

test("blocked or full browser storage leaves an honest in-tab notebook", function () {
  const { store } = notebook();
  for (const storage of [null, { getItem: function () { return null; }, setItem: function () { throw new Error("Full"); } }]) {
    const sets = store("blocked", storage);
    sets.save("Trial", "Still available here", { speed: 100, sampleMs: 20 });
    assert.equal(sets.get("Trial").note, "Still available here");
    assert.match(sets.notice(), /this tab only/);
  }
});
