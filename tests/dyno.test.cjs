"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), vm = require("node:vm"), path = require("node:path");
function fixture() {
  let time = 0;
  const sent = [], socket = { send: text => sent.push(text), close() {} };
  const context = vm.createContext({ window: {} });
  for (const file of ["common", "model-dyno"]) vm.runInContext(fs.readFileSync(path.join(__dirname, "../js/" + file + ".js"), "utf8"), context);
  const model = context.window.MoveSim.createDynoModel({ now: () => time, makeSocket: () => socket });
  model.connect("ws://test"); socket.onopen();
  const receive = event => model.receive(event);
  const serial = (id, line) => receive({ type: "serial", id, line, simNs: 0, hostUs: 100 });
  function init(x = 0) {
    model.init(); serial(Number(sent.at(-1).split(" ")[0]), "ok");
    const id = Number(sent.at(-1).split(" ")[0]); serial(id, "X:" + x + " Y:407 Z:420"); serial(id, "ok");
    receive({ type: "snapshot", px: 0, py: 407, x, y: 407, hostUs: 100, simNs: 0 });
  }
  return { model, sent, socket, receive, serial, init, at: value => { time = value; } };
}
test("connect is command-free; Init sends only G91 and M114 to firmware", () => {
  const f = fixture(); assert.equal(f.sent.length, 0); f.init();
  assert.deepEqual(f.sent, ["1 G91", "2 M114", "3 @snapshot"]);
  assert.equal(f.model.ready, true);
  assert.equal(f.model.stateAt(Infinity).positionYdmm, 0);
});
test("one test measures receipt latency and pulse timing independently of local clock", () => {
  const f = fixture(); f.init(); f.at(10); f.model.sendTest(6000); f.model.sendTest(6000);
  assert.equal(f.sent.at(-1), "4 G0 X1 F6000"); assert.equal(f.model.tests.length, 1);
  f.at(11); f.receive({ type: "submitted", id: 4, simNs: 1000000, hostUs: 1000 });
  f.serial(0, "ok"); assert.equal(f.model.tests[0].okUs, null);
  f.at(12); f.serial(4, "ok");
  for (let pulse = 1; pulse <= 80; ++pulse) {
    f.at(12 + pulse / 10);
    f.receive({ type: "pulse", px: pulse / 80, py: 407, hostUs: 1000 + pulse * 100, simNs: 1000000 + pulse * 100000 });
  }
  const result = f.model.tests[0];
  assert.equal(result.pulseCount, 80); assert.equal(result.okUs, 2000); assert.equal(result.arrivalUs, 10000);
  assert.equal(result.lastPulse.simNs - result.firstPulse.simNs, 7900000);
  assert.equal(f.model.isBusy(), false);
  assert.equal(f.model.stateAt(Infinity).positionXdmm, 10);
  assert.equal(f.model.stateAt(Infinity).positionYdmm, 0);
  assert.equal(f.model.stateAt(result.firstPulse.timeMs).positionXdmm, 0.125);
});
test("reinitialization uses the new X baseline; disconnect and overflow invalidate readiness", () => {
  const f = fixture(); f.init(20); f.model.sendTest(1000);
  assert.equal(f.model.tests[0].targetX, 21);
  f.receive({ type: "error", message: "Capture overflow", lost: 8 });
  assert.equal(f.model.ready, false); assert.match(f.model.tests[0].incomplete, /8 lost/);
  f.init(7); f.model.sendTest(6000); assert.equal(f.model.tests[1].targetX, 8);
  f.model.disconnect(); assert.equal(f.model.ready, false); assert.equal(f.model.connected, false);
  assert.equal(f.sent.some(text => /M400|G90/.test(text)), false);
});
