"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
function services() {
  const context = vm.createContext({ window: { MoveSim: {} } });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../js/wheel-input.js"), "utf8"), context);
  return context.window.MoveSim;
}
// Clockwise rotation is negative in the display's Y-up angular convention.
const pulse = -Math.PI * 2 / 100;
function close(actual, expected) { assert.ok(Math.abs(actual - expected) < 1e-8, actual + " should equal " + expected); }

test("clockwise advances both axes and counterclockwise reverses them at every scale", function () {
  const sim = services();
  assert.deepEqual(Array.from(sim.wheelScalesdmm), [1000,500,100,2540,254]);
  for (const scale of sim.wheelScalesdmm) {
    const wheel = sim.createWheelInput();
    wheel.setScale(scale);
    wheel.setActive(true);
    for (let count = 0; count < 100; count++) { wheel.turn(0, pulse); wheel.turn(1, pulse); }
    close(wheel.snapshot().wheelTotalXdmm, scale);
    close(wheel.snapshot().wheelTotalYdmm, scale);
    wheel.turn(0, 2 * Math.PI);
    wheel.turn(1, 2 * Math.PI);
    close(wheel.snapshot().wheelTotalXdmm, 0);
    close(wheel.snapshot().wheelTotalYdmm, 0);
  }
});

test("sub-pulse angles accumulate and signed reversal cancels fractions", function () {
  const wheel = services().createWheelInput();
  wheel.setActive(true);
  wheel.turn(0, pulse * 0.6);
  wheel.turn(0, -pulse * 0.2);
  assert.equal(wheel.snapshot().wheelTotalXdmm, 0);
  wheel.turn(0, pulse * 0.6);
  assert.equal(wheel.snapshot().wheelTotalXdmm, 10);
  wheel.turn(1, -pulse * 3);
  assert.equal(wheel.snapshot().wheelTotalYdmm, -30);
});

test("free play and gate transitions discard angular fractions and unsampled old distance", function () {
  const sim = services();
  const wheel = sim.createWheelInput();
  const sampler = sim.createWheelSampler();
  wheel.turn(0, pulse * 100);
  wheel.setActive(true);
  wheel.turn(0, pulse * 2.5);
  wheel.setActive(false);
  wheel.turn(0, pulse * 100);
  wheel.setActive(true);
  wheel.turn(0, pulse * 0.5);
  assert.equal(wheel.snapshot().wheelTotalXdmm, 20);
  wheel.turn(0, pulse * 0.5);
  const sample = sampler.sample(Object.assign({sendEnabled:true}, wheel.snapshot()), 100);
  assert.equal(sample.deltaXdmm, 10);
  assert.equal(sample.velocityXdmmPerSecond, 100);
});

test("models with different intervals read independent totals and later scale changes affect new pulses", function () {
  const sim = services();
  const wheel = sim.createWheelInput();
  const fast = sim.createWheelSampler();
  const slow = sim.createWheelSampler();
  wheel.setActive(true);
  wheel.turn(0, pulse);
  const first = Object.assign({sendEnabled:true}, wheel.snapshot());
  assert.equal(fast.sample(first, 20).deltaXdmm, 10);
  wheel.setScale(254);
  wheel.turn(0, pulse);
  const second = Object.assign({sendEnabled:true}, wheel.snapshot());
  close(fast.sample(second, 40).deltaXdmm, 2.54);
  close(slow.sample(second, 100).deltaXdmm, 12.54);
  assert.equal(slow.sample(second, 200).deltaXdmm, 0);
});

test("fine bumps are exact dmm increments independent of scale and discarded during free play", function () {
  const sim=services();
  const input=sim.createWheelInput();
  const fast=sim.createWheelSampler();
  const slow=sim.createWheelSampler();
  input.bump(1,1);
  assert.equal(input.snapshot().bumpTotalXdmm,0);
  input.setActive(true);
  input.setScale(2540);
  input.bump(1,-1);
  const stream=Object.assign({sendEnabled:true},input.snapshot());
  assert.equal(fast.sample(stream,20).bumpVelocityXdmmPerSecond,50);
  assert.equal(slow.sample(stream,100).bumpDeltaXdmm,1);
  assert.equal(input.snapshot().bumpTotalYdmm,-1);
  input.setActive(false);
  input.bump(10,10);
  input.setActive(true);
  const resumed=Object.assign({sendEnabled:true},input.snapshot());
  assert.equal(slow.sample(resumed,200).bumpDeltaXdmm,0);
});
