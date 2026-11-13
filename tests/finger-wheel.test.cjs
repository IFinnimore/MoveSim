"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function wheel() {
  const context = vm.createContext({ window: { MoveSim: {} } });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../js/finger-wheel.js"), "utf8"), context);
  return context.window.MoveSim.createFingerWheel();
}
function close(actual, expected) { assert.ok(Math.abs(actual - expected) < 1e-9, actual + " should equal " + expected); }
function point(wheel, degrees, radius) {
  const angle = degrees * Math.PI / 180;
  wheel.update(Math.cos(angle) * (radius || 1), Math.sin(angle) * (radius || 1));
}

test("wheel mode uses angular changes beyond the radial 0.75 band", function () {
  const value = wheel();
  value.toggle();
  value.update(0.75, 0);
  value.update(0, 0.75);
  close(value.state.angleRadians, 0);
  value.update(0.6, 0.6);
  value.update(-0.6, 0.6);
  close(value.state.angleRadians, Math.PI / 2);
  point(value, 135);
  close(value.state.angleRadians, Math.PI / 2);
});

test("neutral and new wheel mode establish fresh references without jumps", function () {
  const value = wheel();
  point(value, 70);
  value.toggle();
  close(value.state.angleRadians, 0);
  point(value, 100);
  close(value.state.angleRadians, Math.PI / 6);
  value.update(0, 0);
  point(value, -80);
  close(value.state.angleRadians, Math.PI / 6);
  point(value, -110);
  close(value.state.angleRadians, 0);
  value.toggle();
  point(value, 10);
  close(value.state.angleRadians, 0);
  value.toggle();
  point(value, 40);
  close(value.state.angleRadians, Math.PI / 6);
});

test("wheel turns smoothly across the seam in both directions and over multiple turns", function () {
  const value = wheel();
  value.toggle();
  point(value, 179);
  point(value, -179);
  close(value.state.angleRadians, 2 * Math.PI / 180);
  point(value, 179);
  close(value.state.angleRadians, 0);
  for (let angle = 179 + 10; angle <= 179 + 720; angle += 10) point(value, angle);
  close(value.state.angleRadians, 4 * Math.PI);
});

test("release retains orientation, home resets orientation and neither changes mode", function () {
  const value = wheel();
  value.toggle();
  point(value, 0);
  point(value, 90);
  value.release();
  point(value, -90);
  close(value.state.angleRadians, Math.PI / 2);
  value.home();
  assert.equal(value.state.enabled, true);
  close(value.state.angleRadians, 0);
  point(value, 170);
  close(value.state.angleRadians, 0);
});
