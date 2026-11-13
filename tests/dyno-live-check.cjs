"use strict";
// Explicit bench smoke test. Starts its own native Dyno and sends exactly the
// agreed Init + one test move. Never attaches to or terminates an existing Dyno.
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const { spawn } = require("node:child_process");
const assert = require("node:assert/strict");
const net = require("node:net");
const root = path.resolve(__dirname, "../../Artisan-Controller-Dyno");
const output = path.join(__dirname, "artifacts"); fs.mkdirSync(output, { recursive: true });
let child;
function startDyno() {
child = spawn(path.join(root, ".pio/build/dyno_simulator/debug/MarlinSimulator.exe"), [], {
  cwd: root, windowsHide: true, env: { ...process.env, PATH: "C:\\msys64\\mingw64\\bin;" + process.env.PATH }, stdio: ["ignore", "pipe", "pipe"]
});
child.stdout.pipe(fs.createWriteStream(path.join(output, "dyno-stdout.log")));
child.stderr.pipe(fs.createWriteStream(path.join(output, "dyno-stderr.log")));
let launchError; child.on("error", error => { launchError = error; });
child.launchError = () => launchError;
}
const context = vm.createContext({ window: {}, performance, WebSocket });
for (const file of ["common", "model-dyno"]) vm.runInContext(fs.readFileSync(path.join(__dirname, "../js/" + file + ".js"), "utf8"), context);
const model = context.window.MoveSim.createDynoModel({});
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, description, timeout = 30000) {
  const start = performance.now();
  while (!predicate()) {
    if (child.launchError()) throw child.launchError();
    if (child.exitCode !== null) throw new Error("Dyno exited: " + child.exitCode);
    if (performance.now() - start > timeout) throw new Error(description + " timed out: " + model.status);
    await sleep(20);
  }
}
(async () => {
  try {
    await new Promise((resolve, reject) => {
      const probe = net.createConnection({ host: "127.0.0.1", port: 8100 });
      probe.once("connect", () => { probe.destroy(); reject(new Error("Port 8100 is already occupied; leave the existing Dyno untouched.")); });
      probe.once("error", error => { if (error.code === "ECONNREFUSED") resolve(); else reject(error); });
    });
    startDyno();
    await sleep(2000); model.connect("ws://127.0.0.1:8100");
    await until(() => model.connected, "connect");
    model.init(); await until(() => model.ready, "Init");
    model.sendTest(6000); await until(() => !model.isBusy(), "test move");
    const result = model.tests[0];
    assert.equal(result.incomplete, undefined); assert.equal(result.pulseCount, 80);
    assert.ok(result.okUs > 0 && result.startUs > 0 && result.arrivalUs > 0);
    assert.equal(model.stateAt(Infinity).positionYdmm, 0);
    console.log(JSON.stringify({ pulseCount: result.pulseCount, okUs: result.okUs, startUs: result.startUs,
      arrivalUs: result.arrivalUs, pulseSpanUs: (result.lastPulse.simNs - result.firstPulse.simNs) / 1000 }, null, 2));
  } finally {
    fs.writeFileSync(path.join(output, "dyno-live.json"), JSON.stringify({ status: model.status, tests: model.tests, records: model.records }, null, 2));
    model.disconnect(); if (child) child.kill();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
