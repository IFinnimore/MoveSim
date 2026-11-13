"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
function fixture(sampleMs, acceleration, scale) {
  const context = vm.createContext({ window: {} });
  for (const name of ["common","presets","messages","wheel-input","input","model-base","model-just-draw","model-g91-incremental"]) {
    vm.runInContext(fs.readFileSync(path.join(__dirname,"../js/"+name+".js"),"utf8"), context);
  }
  const sim = context.window.MoveSim;
  const input = sim.createInputHistory();
  const wheel = sim.createWheelInput();
  const messages = sim.createMessageLog();
  const machineSettings = {maxAccelerationdmmPerSecondSquared: acceleration || 1000};
  wheel.setScale(scale || 1000);
  wheel.setActive(true);
  let stream = {sendEnabled:true,speeddmmPerSecond:50,wheelX:true,wheelY:true};
  function record(timeMs, pulsesX, pulsesY, changes) {
    stream = Object.assign({},stream,changes);
    wheel.setActive(stream.sendEnabled);
    wheel.turn(0, -(pulsesX || 0) * Math.PI * 2 / 100);
    wheel.turn(1, -(pulsesY || 0) * Math.PI * 2 / 100);
    input.record(timeMs, stream.x === undefined ? 1 : stream.x, stream.y === undefined ? 0.5 : stream.y, "joystick", Object.assign({},stream,wheel.snapshot()));
  }
  record(0);
  const draw = sim.createJustDrawModel({input,messages,settings:{sampleIntervalMs:sampleMs || 100,messageIntervalMs:20,proportional:false}});
  const g91 = sim.createG91Model({input,messages,machineSettings,settings:{proportional:false}});
  return {input,wheel,messages,draw,g91,record};
}
function close(actual, expected) { assert.ok(Math.abs(actual - expected) < 1e-7, actual+" should equal "+expected); }

test("wheel axes use sampled distance/time and ignore speed and proportional switches", function () {
  const {draw,g91,record} = fixture();
  record(40, 1, -2, {speeddmmPerSecond:10000});
  draw.advanceTo(200);
  g91.advanceTo(100);
  close(draw.stateAt(200).positionXdmm, 2010);
  close(draw.stateAt(200).positionYdmm, 1980);
  assert.equal(g91.blocks[0].targetVelocityXdmmPerSecond, 100);
  assert.equal(g91.blocks[0].targetVelocityYdmmPerSecond, -200);
  assert.equal(g91.blocks[0].requestedDeltaXdmm, 10);
});

test("G91 exposes missed wheel distance and never adds catch-up in later blocks", function () {
  const {draw,g91,record,messages} = fixture();
  record(50, 10, 0);
  draw.advanceTo(500);
  g91.advanceTo(500);
  close(draw.stateAt(500).positionXdmm, 2100);
  close(g91.stateAt(200).positionXdmm, 2005);
  close(g91.stateAt(500).positionXdmm, 2010);
  assert.equal(g91.blocks[0].requestedDeltaXdmm, 100);
  assert.equal(g91.blocks[0].deltaXdmm, 5);
  assert.equal(g91.blocks[1].targetVelocityXdmmPerSecond, 0);
  assert.equal(g91.blocks[2].requestedDeltaXdmm, 0);
  assert.equal(messages.entries.find(message => message.modelId === "g91").requestedDeltaXdmm, 100);
});

test("each model samples its own window even when the other is advanced first", function () {
  const {draw,g91,record} = fixture(20);
  record(10, 1, 0);
  record(30, 2, 0);
  draw.advanceTo(100);
  g91.advanceTo(100);
  close(draw.stateAt(100).positionXdmm, 2030);
  assert.equal(g91.blocks[0].requestedDeltaXdmm, 30);
  assert.equal(g91.blocks[0].targetVelocityXdmmPerSecond, 300);
});

test("Send changes prevent old sampled velocity and free play from restarting Just Draw", function () {
  const {draw,record} = fixture();
  record(50, 1, 0);
  record(110, 0, 0, {sendEnabled:false});
  record(111, 30, 0);
  record(115, 0, 0, {sendEnabled:true});
  record(250, 1, 0);
  draw.advanceTo(299);
  close(draw.stateAt(299).positionXdmm, 2001);
  draw.advanceTo(400);
  close(draw.stateAt(400).positionXdmm, 2011);
});

test("fractional dmm pulse distances remain precise through a full 25.4 mm revolution", function () {
  const {draw,record} = fixture(100,1000,254);
  for (let count = 0; count < 100; count++) record(1+count*100, 1, 0);
  draw.advanceTo(10100);
  close(draw.stateAt(10100).positionXdmm, 2254);
  assert.equal(draw.points.every(point => Number.isInteger(point.positionXdmm)), true);
});

test("mixed input keeps joystick speed on the unclaimed axis", function () {
  const {draw,g91,record} = fixture();
  record(0,0,0,{wheelY:false});
  record(50,1,0);
  draw.advanceTo(200);
  g91.advanceTo(100);
  close(draw.stateAt(200).positionXdmm, 2010);
  close(draw.stateAt(200).positionYdmm, 2010);
  assert.equal(g91.blocks[0].targetVelocityXdmmPerSecond, 100);
  assert.equal(g91.blocks[0].targetVelocityYdmmPerSecond, 50);
});

test("D-pad drives both wheel-owned axes while held and releases at each model's sample", function () {
  const {draw,g91,record} = fixture();
  record(0,0,0,{dpadX:1,dpadY:-1});
  record(201,0,0,{dpadX:0,dpadY:0});
  draw.advanceTo(400);
  g91.advanceTo(400);
  close(draw.stateAt(300).positionXdmm, 2015);
  close(draw.stateAt(300).positionYdmm, 1985);
  close(draw.stateAt(400).positionXdmm, 2015);
  close(draw.stateAt(400).positionYdmm, 1985);
  assert.equal(g91.blocks[0].targetVelocityXdmmPerSecond, 50);
  assert.equal(g91.blocks[0].targetVelocityYdmmPerSecond, -50);
  assert.equal(g91.blocks[2].targetVelocityXdmmPerSecond, 0);
  assert.equal(g91.blocks[2].targetVelocityYdmmPerSecond, 0);
});

test("D-pad adds its request without discarding wheel pulses in the same sample", function () {
  const {draw,g91,record} = fixture();
  record(50,1,-1,{dpadX:1,dpadY:-1});
  draw.advanceTo(100);
  g91.advanceTo(100);
  assert.equal(draw.stateAt(100).velocityXdmmPerSecond, 150);
  assert.equal(draw.stateAt(100).velocityYdmmPerSecond, -150);
  assert.equal(g91.blocks[0].requestedDeltaXdmm, 15);
  assert.equal(g91.blocks[0].requestedDeltaYdmm, -15);
});

test("fine bumps request 0.1 mm on both axes with or without wheel ownership", function () {
  for (const enabled of [true,false]) {
    const {draw,g91,wheel,record}=fixture(100,1000,2540);
    record(0,0,0,{wheelX:enabled,wheelY:enabled,x:0,y:0,speeddmmPerSecond:10000});
    wheel.bump(1,-1);
    record(50);
    draw.advanceTo(500);
    g91.advanceTo(500);
    close(draw.stateAt(500).positionXdmm,2001);
    close(draw.stateAt(500).positionYdmm,1999);
    close(g91.stateAt(500).positionXdmm,2001);
    close(g91.stateAt(500).positionYdmm,1999);
    assert.equal(g91.blocks[0].requestedDeltaXdmm,1);
    assert.equal(g91.blocks[1].bumpDeltaXdmm,0);
  }
});
