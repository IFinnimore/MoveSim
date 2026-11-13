"use strict";
// Browser verification uses only Node built-ins and an existing Chrome/Edge install.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { spawn } = require("node:child_process");

const wait = function (durationMs) { return new Promise(function (resolve) { setTimeout(resolve, durationMs); }); };
const browserPaths = [process.env.MOVESIM_BROWSER, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].filter(Boolean);
const browserPath = browserPaths.find(function (candidate) { return fs.existsSync(candidate); });
if (!browserPath) throw new Error("Set MOVESIM_BROWSER to an installed Chrome or Edge executable.");
const temporaryRoot = fs.realpathSync(os.tmpdir());
const profilePath = fs.mkdtempSync(path.join(temporaryRoot, "movesim-browser-"));
const errors = [];
let socket;
let browser;
let browserExit;
let requestId = 0;
const pending = new Map();

function command(method, params) {
  return new Promise(function (resolve, reject) {
    const id = ++requestId;
    const timeout = setTimeout(function () { pending.delete(id); reject(new Error("Browser command timed out: " + method)); }, 10000);
    pending.set(id, { resolve, reject, timeout });
    socket.send(JSON.stringify({ id, method, params: params || {} }));
  });
}

async function evaluate(expression) {
  const response = await command("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.text + ": " + JSON.stringify(response.exceptionDetails.exception));
  return response.result.value;
}

async function click(id) { await evaluate("document.getElementById(" + JSON.stringify(id) + ").click()"); await wait(50); }

async function main() {
  browser = spawn(browserPath, ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--disable-background-networking", "--disable-extensions", "--remote-debugging-port=0", "--user-data-dir=" + profilePath, "about:blank"], { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
  let launchDiagnostics = "";
  browser.stderr.on("data", function (chunk) { launchDiagnostics = (launchDiagnostics + chunk.toString()).slice(-3000); });
  let launchError;
  browser.on("error", function (error) { launchError = error; });
  browserExit = new Promise(function (resolve) { browser.once("exit", resolve); browser.once("error", resolve); });
  const portFile = path.join(profilePath, "DevToolsActivePort");
  for (let attempt = 0; attempt < 100 && !fs.existsSync(portFile); attempt++) {
    if (launchError) throw launchError;
    await wait(100);
  }
  if (!fs.existsSync(portFile)) throw new Error("The browser did not open its local debugging port. " + launchDiagnostics);
  const port = fs.readFileSync(portFile, "utf8").split(/\r?\n/)[0];
  const pages = await fetch("http://127.0.0.1:" + port + "/json").then(function (response) { return response.json(); });
  const page = pages.find(function (candidate) { return candidate.type === "page"; });
  socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(function (resolve, reject) { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); });
  socket.addEventListener("message", function (event) {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const request = pending.get(message.id);
      pending.delete(message.id);
      clearTimeout(request.timeout);
      if (message.error) request.reject(new Error(JSON.stringify(message.error))); else request.resolve(message.result);
    }
    if (message.method === "Runtime.exceptionThrown") errors.push(message.params.exceptionDetails);
    if (message.method === "Log.entryAdded" && message.params.entry.level === "error") errors.push(message.params.entry);
  });
  await command("Runtime.enable");
  await command("Log.enable");
  await command("Page.enable");
  await command("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await command("Page.navigate", { url: process.env.MOVESIM_URL || pathToFileURL(path.join(__dirname, "../index.html")).href });
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await evaluate("Boolean(window.MoveSim && MoveSim.app)")) break;
    await wait(50);
  }
  assert.equal(await evaluate("Boolean(window.MoveSim && MoveSim.app)"), true, "local file loads all subsystems");
  await wait(80);
  assert.deepEqual(await evaluate("[MoveSim.app.clock.isRunning(), MoveSim.app.clock.now(), MoveSim.app.messages.entries.length]"), [false, 0, 0], "load waits for Start without creating a run");
  assert.equal(await evaluate("document.getElementById('pause-button').textContent"), "Start");
  assert.equal(await evaluate("document.getElementById('pause-button').classList.contains('primary')"), true);
  assert.equal(await evaluate("MoveSim.app.buttons.isSending()"), false);
  assert.equal(await evaluate("MoveSim.app.buttons.speed()"), 500);
  await evaluate("MoveSim.app.pause(); MoveSim.app.clear()");
  await wait(80);
  assert.deepEqual(await evaluate("[MoveSim.app.clock.now(), MoveSim.app.models[0].stateAt(0).positionXdmm, MoveSim.app.messages.entries.length]"), [0, 2000, 0]);
  assert.equal(await evaluate("document.getElementById('apply-settings').disabled && document.getElementById('apply-settings').dataset.state === 'clean'"), true);
  assert.equal(await evaluate("document.getElementById('preset-recall') === null"), true);
  assert.equal(await evaluate("document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight"), true, "desktop layout fits the viewport");
  assert.equal(await evaluate(`(() => {
    const left = document.querySelector('.control-column').getBoundingClientRect();
    const motion = document.querySelector('.motion-panel').getBoundingClientRect();
    const timeline = document.querySelector('.timeline-panel').getBoundingClientRect();
    return left.width === 620 && left.top === motion.top && left.bottom === timeline.bottom && timeline.left === motion.left && left.right < timeline.left;
  })()`), true, "double-width controls span the full height beside canvas and timeline");
  assert.equal(await evaluate("!document.getElementById('gamepad-controls').open && document.getElementById('gamepad-controls').contains(document.getElementById('dead-zone'))"), true);
  assert.equal(await evaluate("getComputedStyle(document.getElementById('joystick-status')).fontSize === '12px' && getComputedStyle(document.getElementById('joystick-status-right')).fontSize === '12px'"), true);
  assert.equal(await evaluate("document.getElementById('just-draw-settings').hidden && document.getElementById('just-draw-settings-toggle').getAttribute('aria-expanded') === 'false'"), true);
  await click("just-draw-settings-toggle");
  assert.equal(await evaluate("!document.getElementById('just-draw-settings').hidden && document.getElementById('model-settings').offsetHeight > 0"), true);
  await evaluate("document.getElementById('model-delay').value = '7'; document.getElementById('model-delay').dispatchEvent(new Event('input',{bubbles:true}))");
  await click("just-draw-settings-toggle");
  await click("just-draw-settings-toggle");
  assert.equal(await evaluate("document.getElementById('model-delay').value"), "7", "hiding settings preserves draft values");
  await evaluate("document.getElementById('model-delay').value = '0'; document.getElementById('model-delay').dispatchEvent(new Event('input',{bubbles:true})); document.getElementById('machine-max-acceleration').value = '1234.5'; document.getElementById('machine-max-acceleration').dispatchEvent(new Event('input',{bubbles:true}))");
  assert.equal(await evaluate("MoveSim.app.models[0].machineSettings === MoveSim.app.machineSettings.values && MoveSim.app.models[0].machineSettings.maxAccelerationdmmPerSecondSquared === 12345"), true);
  assert.equal(await evaluate("document.getElementById('apply-settings').disabled && MoveSim.app.clock.now() === 0 && !('maxAccelerationdmmPerSecondSquared' in MoveSim.app.presetStore.get('Defaults').parameters)"), true, "machine setting stays separate from model presets and clock");
  await click("just-draw-settings-toggle");
  assert.equal(await evaluate("document.getElementById('g91-settings').hidden && MoveSim.app.models[1].settings.proportional === true && MoveSim.app.models[0].settings.proportional === false"), true);
  await click("g91-settings-toggle");
  assert.equal(await evaluate("!document.getElementById('g91-settings').hidden && document.getElementById('just-draw-settings').hidden"), true, "model settings open independently");
  await evaluate("document.getElementById('g91-duration').value = '80'; document.getElementById('g91-proportional').checked = false; document.getElementById('g91-model-settings').dispatchEvent(new Event('input',{bubbles:true})); document.getElementById('g91-preset-name').value = 'G91 trial'; document.getElementById('g91-preset-note').value = 'Short blocks, non-proportional.'; document.getElementById('g91-preset-save').click()");
  assert.equal(await evaluate("MoveSim.app.g91PresetStore.get('G91 trial').parameters.proportional"), false);
  assert.equal(await evaluate("MoveSim.app.g91PresetStore.get('G91 trial').parameters.moveDurationMs"), 80);
  await evaluate("document.getElementById('g91-preset-select').value = 'Defaults'; document.getElementById('g91-preset-select').dispatchEvent(new Event('change'))");
  assert.equal(await evaluate("document.getElementById('g91-proportional').checked && document.getElementById('g91-duration').value === '100' && !MoveSim.app.models[0].settings.proportional"), true);
  await click("g91-settings-toggle");
  console.log("PASS stopped-on-load, green Start, local file loading, desktop layout, clear");
  console.log("PASS hidden model settings, retained drafts, shared machine acceleration");

  await click("send-button");
  await click("pause-button");
  await command("Input.dispatchKeyEvent", { type: "keyDown", key: "ArrowRight", code: "ArrowRight", windowsVirtualKeyCode: 39 });
  await wait(160);
  await command("Input.dispatchKeyEvent", { type: "keyUp", key: "ArrowRight", code: "ArrowRight", windowsVirtualKeyCode: 39 });
  await evaluate("MoveSim.app.pause()");
  assert.equal(await evaluate("MoveSim.app.models[0].stateAt(MoveSim.app.clock.now()).positionXdmm > 2000"), true);
  assert.equal(await evaluate("MoveSim.app.models[1].blocks.length > 0 && MoveSim.app.models[1].stateAt(MoveSim.app.clock.now()).positionXdmm > 2000 && MoveSim.app.models[1].stateAt(MoveSim.app.clock.now()).positionXdmm < MoveSim.app.models[0].stateAt(MoveSim.app.clock.now()).positionXdmm"), true, "G91 runs beside the instant baseline with an acceleration ramp");
  await wait(50);
  assert.equal(await evaluate(`MoveSim.app.models.every(model => {
    const output = document.getElementById(model.id + '-position');
    const state = model.stateAt(MoveSim.app.clock.now());
    const title = output.closest('.model-title');
    return output.textContent === 'X' + (Math.round(state.positionXdmm)/10).toFixed(1) + ' Y' + (Math.round(state.positionYdmm)/10).toFixed(1)
      && Math.abs(output.getBoundingClientRect().right - title.getBoundingClientRect().right) < 1;
  })`), true, "each model shows its own right-aligned live coordinates");
  const pausedAt = await evaluate("MoveSim.app.clock.now()");
  await wait(100);
  assert.equal(await evaluate("MoveSim.app.clock.now()"), pausedAt);
  console.log("PASS keyboard input, motion, stop clock");

  await evaluate("MoveSim.app.clear()");
  await click("send-button");
  await click("pause-button");
  const stick = await evaluate("(() => { const r = document.getElementById('joystick').getBoundingClientRect(); return {x:r.left+r.width/2+30, y:r.top+r.height/2-20}; })()");
  await command("Input.dispatchMouseEvent", { type: "mouseMoved", x: stick.x, y: stick.y });
  await command("Input.dispatchMouseEvent", { type: "mousePressed", x: stick.x, y: stick.y, button: "left", clickCount: 1 });
  await wait(120);
  assert.equal(await evaluate("MoveSim.app.controls.current().x > 0 && MoveSim.app.controls.current().y > 0"), true);
  await command("Input.dispatchMouseEvent", { type: "mouseReleased", x: stick.x, y: stick.y, button: "left", clickCount: 1 });
  await evaluate("MoveSim.app.pause()");
  assert.deepEqual(await evaluate("MoveSim.app.controls.current()"), { x: 0, y: 0 });
  assert.equal(await evaluate("MoveSim.app.models[0].stateAt(MoveSim.app.clock.now()).positionXdmm > 2000 && MoveSim.app.models[0].stateAt(MoveSim.app.clock.now()).positionYdmm > 2000"), true);
  console.log("PASS proportional joystick press, movement, release");

  await click("pause-button");
  const rightStick = await evaluate("(() => { const r = document.getElementById('joystick-right').getBoundingClientRect(); return {x:r.left+r.width/2-30, y:r.top+r.height/2+20}; })()");
  assert.equal(rightStick.x > stick.x, true);
  await command("Input.dispatchMouseEvent", { type: "mouseMoved", x: rightStick.x, y: rightStick.y });
  await command("Input.dispatchMouseEvent", { type: "mousePressed", x: rightStick.x, y: rightStick.y, button: "left", clickCount: 1 });
  await wait(100);
  assert.equal(await evaluate("MoveSim.app.controls.current().x < 0 && MoveSim.app.controls.current().y < 0 && document.getElementById('joystick-status-right').textContent.includes('SW')"), true);
  await command("Input.dispatchMouseEvent", { type: "mouseReleased", x: rightStick.x, y: rightStick.y, button: "left", clickCount: 1 });
  await evaluate("MoveSim.app.pause()");
  assert.deepEqual(await evaluate("MoveSim.app.controls.current()"), { x: 0, y: 0 });
  console.log("PASS right joystick proportional input and independent readout");

  await evaluate("window.pointsBeforeHidden = MoveSim.app.models[0].points.length");
  await click("model-visible");
  await click("pause-button");
  await command("Input.dispatchKeyEvent", { type: "keyDown", key: "ArrowUp", code: "ArrowUp", windowsVirtualKeyCode: 38 });
  await wait(140);
  await command("Input.dispatchKeyEvent", { type: "keyUp", key: "ArrowUp", code: "ArrowUp", windowsVirtualKeyCode: 38 });
  await evaluate("MoveSim.app.pause()");
  assert.equal(await evaluate("!MoveSim.app.models[0].visible && MoveSim.app.models[0].points.length > pointsBeforeHidden && MoveSim.app.models[0].stateAt(MoveSim.app.clock.now()).positionYdmm > 2000"), true);
  await click("model-visible");
  await evaluate("document.getElementById('time-scrubber').value = '0'; document.getElementById('time-scrubber').dispatchEvent(new Event('input', { bubbles: true }))");
  await wait(80);
  assert.deepEqual(await evaluate("Array.from(document.querySelectorAll('.model-position'), output => output.textContent)"), ["X200.0 Y200.0", "X200.0 Y200.0"]);
  assert.equal(await evaluate("document.querySelector('.app-header .model-position, .header-position') === null"), true);
  assert.equal(await evaluate("MoveSim.app.clock.isRunning()"), false);
  await click("return-live");
  console.log("PASS hidden-model recording and historical inspection");

  await click("messages-button");
  await wait(230);
  assert.equal(await evaluate("document.querySelectorAll('.message-entry').length > 0"), true);
  await evaluate("document.querySelector('.message-entry').click()");
  await wait(230);
  assert.equal(await evaluate("document.getElementById('message-detail').textContent.includes('dmm/s')"), true);
  await click("gates-button");
  assert.equal(await evaluate("document.getElementById('gates-label').hidden"), false);
  await click("canvas-zoom-in");
  assert.equal(await evaluate("document.getElementById('canvas-view-label').textContent.includes('1.5×')"), true);
  await click("canvas-fit");
  const canvasCentre = await evaluate("(() => { const r = document.getElementById('motion-canvas').getBoundingClientRect(); return {x:r.left+r.width/2, y:r.top+r.height/2}; })()");
  await command("Input.dispatchMouseEvent", { type: "mouseWheel", x: canvasCentre.x, y: canvasCentre.y, deltaX: 0, deltaY: -300 });
  await wait(80);
  assert.equal(await evaluate("!document.getElementById('canvas-view-label').textContent.includes('1.0×')"), true);
  await evaluate("window.canvasBeforePan = document.getElementById('motion-canvas').toDataURL()");
  await command("Input.dispatchMouseEvent", { type: "mousePressed", x: canvasCentre.x, y: canvasCentre.y, button: "left", clickCount: 1 });
  await command("Input.dispatchMouseEvent", { type: "mouseMoved", x: canvasCentre.x + 75, y: canvasCentre.y + 25, button: "left", buttons: 1 });
  await command("Input.dispatchMouseEvent", { type: "mouseReleased", x: canvasCentre.x + 75, y: canvasCentre.y + 25, button: "left", clickCount: 1 });
  await wait(80);
  assert.equal(await evaluate("window.canvasBeforePan !== document.getElementById('motion-canvas').toDataURL()"), true);
  await click("canvas-fit");
  await click("timeline-zoom-in");
  await click("timeline-fit");
  const marker = await evaluate("(() => { const r = document.getElementById('velocity-chart').getBoundingClientRect(); const m = MoveSim.app.messages.entries[2]; const span = Math.max(1000, MoveSim.app.clock.now()*1.03); return {x:r.left+57+m.receivedTimeMs/span*(r.width-76), y:r.top+24}; })()");
  await command("Input.dispatchMouseEvent", { type: "mousePressed", x: marker.x, y: marker.y, button: "left", clickCount: 1 });
  await command("Input.dispatchMouseEvent", { type: "mouseReleased", x: marker.x, y: marker.y, button: "left", clickCount: 1 });
  await wait(230);
  assert.equal(await evaluate("document.getElementById('message-detail').textContent.startsWith('#3 ·')"), true);
  console.log("PASS log and marker selection, gates, wheel zoom, pan, fit");

  assert.deepEqual(await evaluate("Array.from(document.getElementById('canvas-view').options, option=>[option.value,option.textContent])"),[["","Models"],["just-draw","CAM-era: Just Draw"],["g91","CAM-era: G91 Incremental"]]);
  await click("canvas-zoom-in");
  const modelCentre=await evaluate("(() => {const r=document.getElementById('motion-canvas').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()");
  await command("Input.dispatchMouseEvent",{type:"mousePressed",x:modelCentre.x,y:modelCentre.y,button:"left",clickCount:1});
  await command("Input.dispatchMouseEvent",{type:"mouseMoved",x:modelCentre.x+35,y:modelCentre.y-20,button:"left",buttons:1});
  await command("Input.dispatchMouseEvent",{type:"mouseReleased",x:modelCentre.x+35,y:modelCentre.y-20,button:"left",clickCount:1});
  await wait(60);
  const savedModelsView=await evaluate("MoveSim.app.motionCanvas.getView()");
  const savedRun=await evaluate("JSON.stringify({points:MoveSim.app.models.map(model=>model.points),messages:MoveSim.app.messages.entries,time:MoveSim.app.clock.now()})");
  await evaluate("document.getElementById('canvas-view').value='just-draw'; document.getElementById('canvas-view').dispatchEvent(new Event('change'))");
  await wait(100);
  assert.equal(await evaluate("MoveSim.app.motionCanvas.getView().pcbReady"),true,"local PCB image loads for direct-file use");
  const initialCamera=await evaluate("MoveSim.app.motionCanvas.getView()");
  assert.equal(initialCamera.followedModelId,"just-draw");
  assert.ok(Math.abs(initialCamera.area.width/initialCamera.scale-1000)<1e-8);
  assert.ok(Math.abs(initialCamera.area.height/initialCamera.scale-1000)<1e-8);
  assert.equal(await evaluate("getComputedStyle(document.getElementById('camera-x')).fontSize===getComputedStyle(document.getElementById('clock-time')).fontSize"),true);
  assert.equal(await evaluate("!document.getElementById('camera-dro').hidden && document.querySelector('#camera-dro > span').textContent==='CAM-era view'"),true);
  assert.equal(await evaluate("(() => {const v=MoveSim.app.motionCanvas.getView(),s=MoveSim.app.models[0].stateAt(v.timeMs);return v.centreXdmm===s.positionXdmm && v.centreYdmm===s.positionYdmm;})()"),true);
  const cameraCentre=await evaluate("(() => {const r=document.getElementById('motion-canvas').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()");
  await command("Input.dispatchMouseEvent",{type:"mousePressed",x:cameraCentre.x,y:cameraCentre.y,button:"left",clickCount:1});
  await command("Input.dispatchMouseEvent",{type:"mouseMoved",x:cameraCentre.x+80,y:cameraCentre.y+25,button:"left",buttons:1});
  await command("Input.dispatchMouseEvent",{type:"mouseReleased",x:cameraCentre.x+80,y:cameraCentre.y+25,button:"left",clickCount:1});
  await wait(60);
  const afterCameraDrag=await evaluate("MoveSim.app.motionCanvas.getView()");
  assert.equal(afterCameraDrag.panX,0);
  assert.equal(afterCameraDrag.panY,0);
  assert.equal(afterCameraDrag.centreXdmm,initialCamera.centreXdmm);
  await command("Input.dispatchMouseEvent",{type:"mouseWheel",x:cameraCentre.x-100,y:cameraCentre.y-70,deltaX:0,deltaY:-300});
  await wait(80);
  const zoomedCamera=await evaluate("MoveSim.app.motionCanvas.getView()");
  assert.ok(zoomedCamera.zoom>1);
  assert.equal(zoomedCamera.panX,0);
  assert.equal(zoomedCamera.centreXdmm,initialCamera.centreXdmm,"off-centre zoom retains the followed point at centre");
  await evaluate("document.getElementById('canvas-view').value='g91';document.getElementById('canvas-view').dispatchEvent(new Event('change'))");
  await wait(60);
  assert.equal(await evaluate("MoveSim.app.motionCanvas.getView().zoom"),1,"another model starts with its own reset zoom");
  await click("g91-visible");
  assert.equal(await evaluate("(() => {const v=MoveSim.app.motionCanvas.getView(),s=MoveSim.app.models[1].stateAt(v.timeMs);return v.followedModelId==='g91' && v.centreXdmm===s.positionXdmm && !document.getElementById('camera-dro').hidden;})()"),true,"following works even when that trace is hidden");
  await click("g91-visible");
  await evaluate("MoveSim.app.inspect(0)");
  await wait(60);
  assert.deepEqual(await evaluate("[document.getElementById('camera-x').textContent,document.getElementById('camera-y').textContent]"),["X200.0","Y200.0"]);
  await click("return-live");
  await evaluate("document.getElementById('canvas-view').value='just-draw';document.getElementById('canvas-view').dispatchEvent(new Event('change'))");
  await wait(60);
  assert.equal(await evaluate("MoveSim.app.motionCanvas.getView().zoom"),zoomedCamera.zoom);
  await click("canvas-fit");
  assert.equal(await evaluate("MoveSim.app.motionCanvas.getView().zoom"),1);
  await evaluate("document.getElementById('canvas-view').value='';document.getElementById('canvas-view').dispatchEvent(new Event('change'))");
  await wait(60);
  const restoredModels=await evaluate("MoveSim.app.motionCanvas.getView()");
  assert.equal(restoredModels.zoom,savedModelsView.zoom);
  assert.equal(restoredModels.panX,savedModelsView.panX);
  assert.equal(restoredModels.panY,savedModelsView.panY);
  assert.equal(await evaluate("document.getElementById('camera-dro').hidden"),true);
  assert.equal(await evaluate("JSON.stringify({points:MoveSim.app.models.map(model=>model.points),messages:MoveSim.app.messages.entries,time:MoveSim.app.clock.now()})"),savedRun,"view selection and inspection do not modify simulation records");
  await click("canvas-fit");
  console.log("PASS CAM-era selection, physical viewport, PCB load, clock-sized DRO, hidden-model/history follow, locked pan/zoom and restored Models view");

  await click("just-draw-settings-toggle");
  await click("canvas-zoom-in");
  await click("timeline-zoom-in");
  await evaluate(`
    window.beforeApply = {
      timeMs: MoveSim.app.clock.now(),
      points: JSON.stringify(MoveSim.app.models[0].points),
      pointCount: MoveSim.app.models[0].points.length,
      messageCount: MoveSim.app.messages.entries.length,
      view: document.getElementById('canvas-view-label').textContent,
      presets: JSON.stringify(MoveSim.app.presetStore.list())
    };
    window.fitCalls = 0;
    const canvasFit = MoveSim.app.motionCanvas.fit;
    const chartFit = MoveSim.app.velocityChart.fit;
    MoveSim.app.motionCanvas.fit = () => { fitCalls++; canvasFit(); };
    MoveSim.app.velocityChart.fit = () => { fitCalls++; chartFit(); };
    document.getElementById('model-sample').value = '25';
    document.getElementById('model-settings').requestSubmit();
  `);
  await wait(80);
  assert.equal(await evaluate("MoveSim.app.models[0].settings.sampleIntervalMs"), 25);
  assert.equal(await evaluate("MoveSim.app.clock.isRunning() && MoveSim.app.clock.now() > beforeApply.timeMs"), true);
  assert.equal(await evaluate("JSON.stringify(MoveSim.app.models[0].points.slice(0,beforeApply.pointCount)) === beforeApply.points"), true);
  assert.equal(await evaluate("MoveSim.app.messages.entries.length >= beforeApply.messageCount"), true);
  assert.equal(await evaluate("document.getElementById('canvas-view-label').textContent === beforeApply.view && fitCalls === 0"), true, "Apply preserves view navigation");
  assert.equal(await evaluate("JSON.stringify(MoveSim.app.presetStore.list()) === beforeApply.presets"), true, "Apply does not save presets");
  await evaluate("MoveSim.app.pause()");
  console.log("PASS applying settings starts the clock and retains history, zoom and saved sets");

  await evaluate("document.getElementById('model-sample').value = '26'; document.getElementById('model-sample').dispatchEvent(new Event('input', {bubbles:true}))");
  assert.equal(await evaluate("!document.getElementById('apply-settings').disabled && document.getElementById('apply-settings').dataset.state === 'dirty'"), true);
  await evaluate("document.getElementById('model-sample').value = '25'; document.getElementById('model-sample').dispatchEvent(new Event('input', {bubbles:true}))");
  assert.equal(await evaluate("document.getElementById('apply-settings').disabled"), true, "reverting edits restores clean state");

  await evaluate(`
    document.getElementById('preset-panel').open = true;
    document.getElementById('preset-name').value = 'Coarse / 50 ms';
    document.getElementById('preset-note').value = 'Coarse near gates.\\nRetest X/Y ± direction. <note>';
    document.getElementById('model-sample').value = '50';
    document.getElementById('model-message').value = '75';
    document.getElementById('model-delay').value = '15';
    document.getElementById('model-settings').dispatchEvent(new Event('input', {bubbles:true}));
    window.runBeforePreset = JSON.stringify({points:MoveSim.app.models[0].points, messages:MoveSim.app.messages.entries, time:MoveSim.app.clock.now()});
  `);
  await click("preset-save");
  assert.equal(await evaluate("MoveSim.app.presetStore.get('Coarse / 50 ms').parameters.sampleIntervalMs"), 50);
  assert.equal(await evaluate("MoveSim.app.models[0].settings.sampleIntervalMs"), 25, "Save does not apply parameters");
  assert.equal(await evaluate("document.getElementById('apply-settings').dataset.state"), "dirty", "Save leaves unapplied values dirty");
  await evaluate("document.getElementById('preset-name').value = 'Slalom trial'");
  await click("preset-rename");
  assert.equal(await evaluate("MoveSim.app.presetStore.get('Slalom trial').note"), "Coarse near gates.\nRetest X/Y ± direction. <note>");
  await evaluate("document.getElementById('preset-name').value = 'Defaults'");
  await click("preset-rename");
  assert.equal(await evaluate("document.getElementById('preset-status').textContent.includes('already in use')"), true);
  await evaluate("document.getElementById('preset-name').value = 'Slalom trial'; document.getElementById('preset-note').value += '\\nSecond pass.'");
  await click("preset-save");
  assert.equal(await evaluate("MoveSim.app.presetStore.list().length"), 2, "Save replaces an existing set");
  await evaluate("document.getElementById('model-sample').value = '99'");
  await evaluate("document.getElementById('preset-select').value = 'Defaults'; document.getElementById('preset-select').dispatchEvent(new Event('change')); document.getElementById('preset-select').value = 'Slalom trial'; document.getElementById('preset-select').dispatchEvent(new Event('change'))");
  assert.equal(await evaluate("document.getElementById('model-sample').value"), "50");
  assert.equal(await evaluate("JSON.stringify({points:MoveSim.app.models[0].points, messages:MoveSim.app.messages.entries, time:MoveSim.app.clock.now()}) === runBeforePreset"), true, "notebook operations preserve the recording");

  await command("Page.reload");
  await wait(250);
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await evaluate("Boolean(window.MoveSim && MoveSim.app)")) break;
    await wait(50);
  }
  await evaluate("MoveSim.app.pause(); document.getElementById('preset-panel').open = true; document.getElementById('preset-select').value = 'Slalom trial'; document.getElementById('preset-select').dispatchEvent(new Event('change'))");
  assert.equal(await evaluate("document.getElementById('just-draw-settings').hidden && document.getElementById('machine-max-acceleration').value === '1234.5'"), true, "settings start hidden and machine acceleration restores on reload");
  assert.equal(await evaluate("MoveSim.app.g91PresetStore.get('G91 trial').parameters.proportional"), false, "boolean G91 preset restores independently after reload");
  await click("just-draw-settings-toggle");
  assert.equal(await evaluate("document.getElementById('model-sample').value"), "50");
  assert.equal(await evaluate("document.getElementById('model-delay').value"), "15");
  assert.equal(await evaluate("document.getElementById('preset-note').value"), "Coarse near gates.\nRetest X/Y ± direction. <note>\nSecond pass.");
  assert.equal(await evaluate("MoveSim.app.models[0].settings.sampleIntervalMs"), 20, "Recall stages values after reload");
  assert.equal(await evaluate("document.getElementById('apply-settings').dataset.state"), "dirty", "selecting different settings needs Apply");
  await evaluate("document.getElementById('model-settings').requestSubmit()");
  await wait(50);
  assert.equal(await evaluate("MoveSim.app.models[0].settings.sampleIntervalMs"), 50);
  assert.equal(await evaluate("document.getElementById('apply-settings').disabled && document.getElementById('apply-settings').dataset.state === 'clean'"), true);
  await evaluate("document.getElementById('preset-select').value = 'Defaults'; document.getElementById('preset-select').dispatchEvent(new Event('change'))");
  assert.equal(await evaluate("document.getElementById('apply-settings').dataset.state"), "dirty");
  await evaluate("document.getElementById('preset-select').value = 'Slalom trial'; document.getElementById('preset-select').dispatchEvent(new Event('change')); document.getElementById('preset-note').dispatchEvent(new Event('input', {bubbles:true}))");
  assert.equal(await evaluate("document.getElementById('apply-settings').dataset.state"), "clean", "matching active settings and note edits do not need Apply");
  assert.equal(await evaluate("MoveSim.app.presetStore.get('Slalom trial').note.includes('Second pass.')"), true, "Clear preserves saved notes");
  await click("preset-delete");
  assert.equal(await evaluate("MoveSim.app.presetStore.list().length"), 1);
  await click("preset-delete");
  assert.equal(await evaluate("document.getElementById('preset-select').value"), "Defaults");
  assert.equal(await evaluate("document.getElementById('preset-note').value"), "");
  assert.equal(await evaluate("document.getElementById('model-sample').value"), "20");
  assert.equal(await evaluate("document.getElementById('apply-settings').dataset.state"), "dirty");
  assert.equal(await evaluate("MoveSim.app.models[0].settings.sampleIntervalMs"), 50, "last deletion only stages defaults");
  await evaluate("document.getElementById('model-settings').requestSubmit(); document.getElementById('preset-panel').open = false");
  await wait(50);
  await evaluate("MoveSim.app.pause()");
  console.log("PASS preset selection/save/rename/delete, notes, reload persistence, recording preservation, dirty/clean state");

  await click("joystick-mode");
  await evaluate("document.getElementById('joystick').scrollIntoView({block:'nearest'});");
  await wait(60);
  const wheelCentre = await evaluate("(() => {const r=document.getElementById('joystick').getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2};})()");
  await command("Input.dispatchMouseEvent", {type:"mousePressed",x:wheelCentre.x+40,y:wheelCentre.y,button:"left",buttons:1,clickCount:1});
  await wait(35);
  await command("Input.dispatchMouseEvent", {type:"mouseMoved",x:wheelCentre.x,y:wheelCentre.y-40,button:"left",buttons:1});
  await wait(35);
  assert.ok(Math.abs(await evaluate("MoveSim.app.controls.wheels[0].state.angleRadians") - Math.PI/2) < 1e-9, JSON.stringify(await evaluate("({wheel:MoveSim.app.controls.wheels[0].state,xy:MoveSim.app.controls.current(),source:MoveSim.app.controls.source()})")));
  assert.deepEqual(await evaluate("MoveSim.app.controls.current()"), {x:0,y:0}, "a wheel-mode stick no longer supplies joystick X/Y");
  assert.equal(await evaluate("MoveSim.app.controls.wheelStream().wheelTotalXdmm"), 0, "paused wheel drag is free play");
  await command("Input.dispatchMouseEvent", {type:"mouseReleased",x:wheelCentre.x,y:wheelCentre.y-40,button:"left",buttons:0,clickCount:1});
  assert.deepEqual(await evaluate("MoveSim.app.controls.current()"), {x:0,y:0});
  assert.ok(Math.abs(await evaluate("MoveSim.app.controls.wheels[0].state.angleRadians") - Math.PI/2) < 1e-9, "pointer release holds wheel orientation");
  await click("joystick-mode");
  // Clear homes the wheel landmark while retaining the selected display mode.
  await click("clear-button");
  assert.equal(await evaluate("MoveSim.app.controls.wheels[0].state.angleRadians"), 0);
  console.log("PASS virtual finger wheel drag, axis ownership, paused free play, neutral release and Clear home");

  await evaluate("window.fakePad = { index: 0, id: 'MoveSim test controller', mapping: 'standard', axes: [1, 0], buttons: Array.from({length:16}, () => ({pressed:false, value:0})) }; window.connectedPads = [fakePad]; Object.defineProperty(navigator, 'getGamepads', {configurable:true, value:() => connectedPads}); document.getElementById('input-source').value = 'gamepad'; document.getElementById('input-source').dispatchEvent(new Event('change'))");
  await wait(80);
  assert.equal(await evaluate("MoveSim.app.controls.current().x"), 1);
  // Keep this exercise on the real input path: fixed controller clicks select
  // modes, axes still publish X/Y, and a running clock must lock both switches.
  const stickLayout = await evaluate("Array.from(document.querySelectorAll('.stick-view, .joystick, .models-panel'), node => {const r=node.getBoundingClientRect(); return [r.x,r.y,r.width,r.height]})");
  await evaluate("fakePad.buttons[10].pressed = true");
  await wait(60);
  assert.deepEqual(await evaluate("MoveSim.app.controls.wheels.map(wheel => wheel.state.enabled)"), [true,false]);
  assert.equal(await evaluate("MoveSim.app.controls.wheels[0].state.angleRadians"), 0, "entering wheel mode does not jump to the stick angle");
  await evaluate("fakePad.axes[0] = 0.6; fakePad.axes[1] = -0.6");
  await wait(60);
  assert.ok(Math.abs(await evaluate("MoveSim.app.controls.wheels[0].state.angleRadians") - Math.PI/4) < 1e-9);
  assert.deepEqual(await evaluate("MoveSim.app.controls.current()"), {x:0,y:0}, "a wheel-mode stick contributes encoder motion only");
  await evaluate("fakePad.axes[2] = 0.5; fakePad.axes[3] = -0.25");
  await wait(50);
  assert.deepEqual(await evaluate("MoveSim.app.controls.current()"), {x:0,y:0.25}, "left wheel removes X from the other joystick");
  await evaluate("fakePad.axes[2] = 0; fakePad.axes[3] = 0");
  await wait(50);
  await evaluate("fakePad.axes[0] = 0.5; fakePad.axes[1] = 0.5");
  await wait(50);
  assert.ok(Math.abs(await evaluate("MoveSim.app.controls.wheels[0].state.angleRadians") - Math.PI/4) < 1e-9, "inside radius 0.75 holds orientation");
  await evaluate("fakePad.axes[0] = -1; fakePad.axes[1] = 0; fakePad.buttons[11].pressed = true");
  await wait(50);
  assert.ok(Math.abs(await evaluate("MoveSim.app.controls.wheels[0].state.angleRadians") - Math.PI/4) < 1e-9, "leaving neutral establishes a fresh reference");
  assert.deepEqual(await evaluate("MoveSim.app.controls.wheels.map(wheel => wheel.state.enabled)"), [true,true]);
  assert.deepEqual(await evaluate("Array.from(document.querySelectorAll('.stick-view, .joystick, .models-panel'), node => {const r=node.getBoundingClientRect(); return [r.x,r.y,r.width,r.height]})"), stickLayout, "wheel mode has no layout reflow");
  assert.equal(await evaluate("document.querySelectorAll('.finger-wheel text').length === 2 && document.querySelector('.finger-wheel text').textContent === '0'"), true);
  const wheelScreenshot = await command("Page.captureScreenshot", {format:"png",captureBeyondViewport:false});
  fs.mkdirSync(path.join(__dirname,'artifacts'), {recursive:true});
  fs.writeFileSync(path.join(__dirname,'artifacts','finger-wheels.png'), Buffer.from(wheelScreenshot.data,'base64'));
  await evaluate("fakePad.buttons[10].pressed = false; fakePad.buttons[11].pressed = false");
  await wait(50);
  await click("pause-button");
  assert.equal(await evaluate("document.getElementById('joystick-mode').disabled && document.getElementById('joystick-mode-right').disabled"), true);
  await evaluate("fakePad.buttons[10].pressed = true; fakePad.buttons[11].pressed = true");
  await wait(50);
  await click("pause-button");
  await wait(50);
  assert.deepEqual(await evaluate("MoveSim.app.controls.wheels.map(wheel => wheel.state.enabled)"), [true,true], "running clicks are ignored and do not activate after pause");
  await evaluate("fakePad.buttons[10].pressed = false; fakePad.buttons[11].pressed = false");
  await wait(50);

  await evaluate("MoveSim.app.clear(); fakePad.axes.fill(0); fakePad.buttons[15].pressed=true; fakePad.buttons[12].pressed=true");
  await wait(60);
  assert.deepEqual(await evaluate("MoveSim.app.controls.current()"), {x:1,y:1}, "D-pad keeps both axes with both wheels enabled");
  await click("send-button");
  await click("pause-button");
  await wait(200);
  assert.equal(await evaluate("MoveSim.app.models.every(model => {const state=model.stateAt(MoveSim.app.clock.now()); return state.positionXdmm>2000 && state.positionYdmm>2000;})"), true, "both models move diagonally from D-pad input in wheel mode");
  await evaluate("fakePad.buttons[15].pressed=false; fakePad.buttons[12].pressed=false");
  await wait(300);
  assert.deepEqual(await evaluate("MoveSim.app.controls.current()"), {x:0,y:0});
  assert.equal(await evaluate("MoveSim.app.models.every(model => {const state=model.stateAt(MoveSim.app.clock.now()); return Math.abs(state.velocityXdmmPerSecond)<1e-8 && Math.abs(state.velocityYdmmPerSecond)<1e-8;})"), true, "D-pad release stops requests without disabling wheels");
  await evaluate("MoveSim.app.pause(); MoveSim.app.clear()");
  console.log("PASS held D-pad on both wheel axes, diagonal requests and release in both models");

  assert.equal(await evaluate("MoveSim.app.buttons.preferences.get().mapping.bump"),4);
  await evaluate("fakePad.buttons[4].pressed=true; fakePad.buttons[15].pressed=true; fakePad.buttons[12].pressed=true");
  await wait(60);
  assert.equal(await evaluate("MoveSim.app.buttons.isFineBump()"),true);
  assert.equal(await evaluate("MoveSim.app.controls.wheelStream().bumpTotalXdmm"),0,"paused fine press is not queued");
  await click("send-button");
  await click("pause-button");
  await wait(160);
  assert.equal(await evaluate("MoveSim.app.models[0].stateAt(MoveSim.app.clock.now()).positionXdmm"),2000,"holding a paused press through Start does not bump");
  await evaluate("fakePad.buttons[15].pressed=false; fakePad.buttons[12].pressed=false");
  await wait(40);
  await evaluate("fakePad.buttons[15].pressed=true; fakePad.buttons[12].pressed=true");
  await wait(260);
  assert.equal(await evaluate("MoveSim.app.models[0].stateAt(MoveSim.app.clock.now()).positionXdmm"),2001,"L1 plus right gives one 0.1 mm X bump");
  assert.equal(await evaluate("MoveSim.app.models[0].stateAt(MoveSim.app.clock.now()).positionYdmm"),2001,"L1 plus up gives one 0.1 mm Y bump");
  await wait(150);
  assert.equal(await evaluate("MoveSim.app.models[0].stateAt(MoveSim.app.clock.now()).positionXdmm"),2001,"held fine D-pad never repeats");
  await evaluate("fakePad.buttons[4].pressed=false");
  await wait(160);
  assert.equal(await evaluate("!MoveSim.app.buttons.isFineBump() && MoveSim.app.models[0].stateAt(MoveSim.app.clock.now()).positionXdmm>2001"),true,"releasing L1 restores held movement");
  await evaluate("fakePad.buttons[15].pressed=false; fakePad.buttons[12].pressed=false");
  await wait(250);
  const beforeFineToggle=await evaluate("MoveSim.app.models[0].stateAt(MoveSim.app.clock.now())");
  await click("dpad-bump-button");
  await evaluate("fakePad.buttons[14].pressed=true; fakePad.buttons[13].pressed=true");
  await wait(250);
  const afterFineToggle=await evaluate("MoveSim.app.models[0].stateAt(MoveSim.app.clock.now())");
  assert.ok(Math.abs(afterFineToggle.positionXdmm-beforeFineToggle.positionXdmm+1)<1e-7);
  assert.ok(Math.abs(afterFineToggle.positionYdmm-beforeFineToggle.positionYdmm+1)<1e-7);
  await evaluate("fakePad.buttons[4].pressed=true; MoveSim.app.clear()");
  await wait(60);
  await evaluate("fakePad.buttons[14].pressed=false; fakePad.buttons[13].pressed=false");
  await wait(40);
  await evaluate("fakePad.buttons[15].pressed=true; fakePad.buttons[12].pressed=true");
  await wait(50);
  await click("send-button");
  await wait(200);
  assert.equal(await evaluate("MoveSim.app.models[0].stateAt(MoveSim.app.clock.now()).positionXdmm"),2000,"fine presses during Don't send are not replayed");
  await evaluate("fakePad.buttons[4].pressed=false; fakePad.buttons[15].pressed=false; fakePad.buttons[12].pressed=false; MoveSim.app.pause(); MoveSim.app.clear()");
  await wait(50);
  assert.equal(await evaluate("MoveSim.app.buttons.isFineBump()"),false);
  console.log("PASS L1 fine modifier, exact 0.1 mm per fresh press, no repeat, screen toggle, normal release and free-play gating");

  assert.deepEqual(await evaluate("Array.from(document.getElementById('wheel-scale').options, option => [option.value,option.textContent])"), [["1000","100 mm/rev"],["500","50 mm/rev"],["100","10 mm/rev"],["2540","254 mm/rev"],["254","25.4 mm/rev"]]);
  await evaluate("MoveSim.app.models[0].applySettings({sampleIntervalMs:100,messageIntervalMs:20},MoveSim.app.clock.now()); MoveSim.app.machineSettings.setMaxAcceleration(1000); MoveSim.app.clear(); fakePad.axes[0]=1; fakePad.axes[1]=0; fakePad.axes[2]=1; fakePad.axes[3]=0");
  await wait(50);
  await evaluate("fakePad.axes[0]=0; fakePad.axes[1]=-1");
  await wait(50);
  assert.equal(await evaluate("MoveSim.app.controls.wheelStream().wheelTotalXdmm"), 0, "paused turns do not enter the encoder counter");
  await click("send-button");
  await click("pause-button");
  await evaluate("document.getElementById('canvas-view').value='just-draw';document.getElementById('canvas-view').dispatchEvent(new Event('change'))");
  for (const angle of [0,-90,-180,-270]) {
    await evaluate("fakePad.axes[0]=Math.cos("+angle+"*Math.PI/180); fakePad.axes[1]=-Math.sin("+angle+"*Math.PI/180); fakePad.axes[2]=0; fakePad.axes[3]=1");
    await wait(50);
  }
  await wait(350);
  assert.deepEqual(await evaluate("[MoveSim.app.controls.wheelStream().wheelTotalXdmm,MoveSim.app.controls.wheelStream().wheelTotalYdmm]"), [1000,250]);
  const wheelPosition = await evaluate("MoveSim.app.models[0].stateAt(MoveSim.app.clock.now())");
  assert.ok(Math.abs(wheelPosition.positionXdmm-3000)<1e-6, "one clockwise revolution moves X right by 100 mm");
  assert.ok(Math.abs(wheelPosition.positionYdmm-2250)<1e-6, "clockwise right wheel moves Y up");
  assert.equal(await evaluate("(() => {const v=MoveSim.app.motionCanvas.getView(),s=MoveSim.app.models[0].stateAt(v.timeMs);return v.followedModelId==='just-draw' && v.centreXdmm===s.positionXdmm && v.centreYdmm===s.positionYdmm && document.getElementById('camera-x').textContent==='X300.0';})()"),true,"CAM-era follows live wheel motion");
  assert.equal(await evaluate("MoveSim.app.models[1].stateAt(MoveSim.app.clock.now()).positionXdmm < 3000"), true, "G91 visibly misses travel when its acceleration is insufficient");
  assert.ok(Math.abs(await evaluate("MoveSim.app.models[1].blocks.reduce((sum,block)=>sum+block.requestedDeltaXdmm,0)")-1000)<1e-6, "G91 does not re-request the missing distance");
  await evaluate("document.getElementById('canvas-view').value='';document.getElementById('canvas-view').dispatchEvent(new Event('change'))");
  await wait(50);
  const wheelMotionScreenshot = await command("Page.captureScreenshot", {format:"png",captureBeyondViewport:false});
  fs.writeFileSync(path.join(__dirname,'artifacts','wheel-motion.png'), Buffer.from(wheelMotionScreenshot.data,'base64'));
  await click("send-button");
  await evaluate("fakePad.axes[0]=-1; fakePad.axes[1]=0");
  await wait(250);
  assert.equal(await evaluate("MoveSim.app.controls.wheelStream().wheelTotalXdmm"), 1000, "Don't send permits display rotation without accumulating distance");
  await click("send-button");
  await wait(250);
  assert.ok(Math.abs(await evaluate("MoveSim.app.models[0].stateAt(MoveSim.app.clock.now()).positionXdmm")-3000)<1e-6, "Send does not replay free play or old sampled velocity");
  await click("pause-button");
  await evaluate("fakePad.axes[0]=0; fakePad.axes[1]=1");
  await wait(50);
  await click("pause-button");
  await wait(250);
  assert.ok(Math.abs(await evaluate("MoveSim.app.models[0].stateAt(MoveSim.app.clock.now()).positionXdmm")-3000)<1e-6, "Start does not replay paused turns");
  await click("pause-button");
  await evaluate("document.getElementById('wheel-scale').value='254'; document.getElementById('wheel-scale').dispatchEvent(new Event('change')); MoveSim.app.clear(); fakePad.axes[0]=0; fakePad.axes[1]=0; fakePad.axes[2]=0; fakePad.axes[3]=0");
  await wait(50);
  assert.equal(await evaluate("JSON.parse(localStorage.getItem('movesim.input.v1')).wheelRevolutiondmm"),254);
  await evaluate("fakePad.axes[0]=1");
  await wait(50);
  await click("send-button");
  await click("pause-button");
  await evaluate("fakePad.axes[0]=0; fakePad.axes[1]=1");
  await wait(350);
  assert.ok(Math.abs(await evaluate("MoveSim.app.models[0].stateAt(MoveSim.app.clock.now()).positionXdmm")-2063.5)<1e-6, "25 clockwise pulses at 25.4 mm/rev retain the full fractional 6.35 mm");
  await evaluate("MoveSim.app.pause(); MoveSim.app.models[0].applySettings({sampleIntervalMs:20,messageIntervalMs:20},MoveSim.app.clock.now()); MoveSim.app.machineSettings.setMaxAcceleration(12345); MoveSim.app.clear()");
  console.log("PASS wheel scale choices/storage, live sampled X/Y distance, no Input speed limit, G91 error without catch-up and free-play gates");

  await evaluate("fakePad.buttons[10].pressed = true");
  await wait(50);
  assert.deepEqual(await evaluate("MoveSim.app.controls.wheels.map(wheel => wheel.state.enabled)"), [false,true]);
  await click("joystick-mode-right");
  assert.deepEqual(await evaluate("MoveSim.app.controls.wheels.map(wheel => wheel.state.enabled)"), [false,false]);
  await evaluate("fakePad.buttons[10].pressed = false; fakePad.axes[0] = 1; fakePad.axes[1] = 0");
  await wait(50);
  console.log("PASS independent finger wheels, fixed L3/R3, axis ownership, radial neutral, no jump/reflow and running-clock lock");
  await evaluate("fakePad.axes[2] = -0.5; fakePad.axes[3] = -0.25");
  await wait(60);
  assert.deepEqual(await evaluate("MoveSim.app.controls.current()"), { x: -0.5, y: 0.25 });
  await evaluate("fakePad.buttons[15].pressed = true");
  await wait(60);
  assert.deepEqual(await evaluate("MoveSim.app.controls.current()"), { x: 1, y: 0 });
  await evaluate("fakePad.buttons[15].pressed = false");
  await wait(60);
  assert.deepEqual(await evaluate("MoveSim.app.controls.current()"), { x: 0, y: 0 }, "D-pad release can collide with a held stick");
  assert.equal(await evaluate("MoveSim.app.controls.hasHeldInput()"), true);
  await evaluate("fakePad.axes[0] = 0; fakePad.axes[2] = 0; fakePad.axes[3] = 0");
  await wait(50);
  await evaluate("fakePad.axes[0] = 1");
  await wait(50);
  await click("clear-button");
  await wait(80);
  assert.equal(await evaluate("MoveSim.app.controls.current().x"), 0, "Clear neutralizes a held gamepad");
  await evaluate("fakePad.axes[0] = 0");
  await wait(50);
  await evaluate("fakePad.axes[0] = 1");
  await wait(50);
  await click("send-button");
  await click("pause-button");
  await wait(130);
  assert.equal(await evaluate("MoveSim.app.models[0].stateAt(MoveSim.app.clock.now()).positionXdmm > 2000"), true);
  await evaluate("connectedPads = []");
  await wait(60);
  assert.equal(await evaluate("MoveSim.app.controls.current().x"), 0);
  await evaluate("MoveSim.app.pause()");
  console.log("PASS both gamepad sticks, D-pad full input and collisions, held-stick clear, disconnect");

  // Advance a test wall clock instead of waiting a real minute. The production
  // clock and inactivity timer both continue reading their normal time service.
  await evaluate(`
    MoveSim.app.clear();
    window.originalWallTime = performance.now.bind(performance);
    window.testWallOffsetMs = 0;
    Object.defineProperty(performance, 'now', {configurable:true, value:() => originalWallTime() + testWallOffsetMs});
    MoveSim.app.resume();
    testWallOffsetMs = 59000;
  `);
  await wait(50);
  assert.equal(await evaluate("MoveSim.app.clock.isRunning()"), true, "59 seconds does not pause");
  await evaluate("testWallOffsetMs = 61000");
  await wait(100);
  assert.equal(await evaluate("MoveSim.app.clock.isRunning()"), false, "idle input pauses the clock");
  assert.equal(await evaluate("document.getElementById('clock-label').textContent"), "IDLE");
  assert.equal(await evaluate("document.getElementById('pause-button').classList.contains('primary')"), true);
  assert.equal(await evaluate("getComputedStyle(document.getElementById('pause-button')).backgroundColor === getComputedStyle(document.getElementById('clear-button')).backgroundColor"), true);
  const idleTimeMs = await evaluate("MoveSim.app.clock.now()");
  await wait(50);
  assert.equal(await evaluate("MoveSim.app.clock.now()"), idleTimeMs);
  await click("pause-button");
  assert.equal(await evaluate("MoveSim.app.clock.isRunning() && !document.getElementById('pause-button').classList.contains('primary')"), true, "Resume starts a fresh interval");
  await evaluate("testWallOffsetMs += 59000; document.getElementById('preset-note').dispatchEvent(new Event('input', {bubbles:true})); testWallOffsetMs += 2000");
  await wait(80);
  assert.equal(await evaluate("MoveSim.app.clock.isRunning()"), true, "notebook input renews activity");
  await evaluate("document.getElementById('input-source').value = 'joystick'; document.getElementById('input-source').dispatchEvent(new Event('change'))");
  await command("Input.dispatchKeyEvent", { type: "keyDown", key: "ArrowRight", code: "ArrowRight", windowsVirtualKeyCode: 39 });
  await wait(50);
  assert.equal(await evaluate("MoveSim.app.controls.current().x"), 1);
  await evaluate("testWallOffsetMs += 61000");
  await wait(100);
  assert.equal(await evaluate("MoveSim.app.clock.isRunning()"), true, "held input stays active even at a wall");
  await command("Input.dispatchKeyEvent", { type: "keyUp", key: "ArrowRight", code: "ArrowRight", windowsVirtualKeyCode: 39 });
  await evaluate("MoveSim.app.pause(); delete performance.now; MoveSim.app.clear()");
  console.log("PASS 60-second idle pause, bold Start, fresh interval, notebook activity, held input");

  await evaluate(`
    window.otherPad = {index:0, id:'Other controller', mapping:'standard', axes:[0,0,0,0,0,0], buttons:[]};
    window.chosenPad = {index:1, id:'Saved controller', mapping:'standard', axes:[0,0,0,0,0,0], buttons:[]};
    connectedPads = [otherPad, chosenPad];
    document.getElementById('input-source').value = 'gamepad';
    document.getElementById('input-source').dispatchEvent(new Event('change'));
    document.getElementById('gamepad-controls').open = true;
  `);
  await wait(80);
  await evaluate(`
    document.getElementById('gamepad-device').value = '1';
    document.getElementById('gamepad-device').dispatchEvent(new Event('change'));
    [['gamepad-axis-x','4'], ['gamepad-axis-y','5'], ['gamepad-right-axis-x','0'], ['gamepad-right-axis-y','1'], ['dead-zone','0.25']].forEach(([id,value]) => {
      const control = document.getElementById(id); control.value = value; control.dispatchEvent(new Event('input', {bubbles:true}));
    });
    [['gamepad-invert-x',true], ['gamepad-invert-y',false], ['gamepad-right-invert-x',true], ['gamepad-right-invert-y',false]].forEach(([id,value]) => {
      const control = document.getElementById(id); control.checked = value; control.dispatchEvent(new Event('change', {bubbles:true}));
    });
    window.savedInputSettings = JSON.parse(localStorage.getItem('movesim.input.v1'));
  `);
  assert.deepEqual(await evaluate("[savedInputSettings.source,savedInputSettings.controllerId,savedInputSettings.leftAxisX,savedInputSettings.leftAxisY,savedInputSettings.rightAxisX,savedInputSettings.rightAxisY,savedInputSettings.leftInvertX,savedInputSettings.leftInvertY,savedInputSettings.rightInvertX,savedInputSettings.rightInvertY,savedInputSettings.deadZone]"), ["gamepad", "Saved controller", 4, 5, 0, 1, true, false, true, false, 0.25]);
  await command("Page.reload");
  await wait(250);
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await evaluate("Boolean(window.MoveSim && MoveSim.app)")) break;
    await wait(50);
  }
  assert.deepEqual(await evaluate("[document.getElementById('input-source').value,document.getElementById('gamepad-axis-x').value,document.getElementById('gamepad-axis-y').value,document.getElementById('gamepad-right-axis-x').value,document.getElementById('gamepad-right-axis-y').value,document.getElementById('gamepad-invert-x').checked,document.getElementById('gamepad-invert-y').checked,document.getElementById('gamepad-right-invert-x').checked,document.getElementById('gamepad-right-invert-y').checked,document.getElementById('dead-zone').value,document.getElementById('gamepad-controls').open,MoveSim.app.clock.isRunning()]"), ["gamepad", "4", "5", "0", "1", true, false, true, false, "0.25", false, false]);
  await evaluate(`
    window.connectedPads = [{index:0,id:'Other controller',mapping:'standard',axes:[1,1,1,1,1,1],buttons:[]}];
    Object.defineProperty(navigator, 'getGamepads', {configurable:true,value:() => connectedPads});
  `);
  await wait(80);
  assert.deepEqual(await evaluate("MoveSim.app.controls.current()"), { x: 0, y: 0 }, "missing saved controller does not choose a different device");
  assert.equal(await evaluate("document.getElementById('gamepad-device').value"), "");
  await evaluate("connectedPads.push({index:3,id:'Saved controller',mapping:'standard',axes:[0,0,0,0,0.5,-0.5],buttons:[]})");
  await wait(80);
  assert.equal(await evaluate("document.getElementById('gamepad-device').value"), "3");
  assert.deepEqual(await evaluate("MoveSim.app.controls.current()"), { x: -0.5, y: -0.5 });
  assert.equal(await evaluate("MoveSim.app.clock.isRunning()"), false);
  await evaluate("document.getElementById('input-source').value = 'joystick'; document.getElementById('input-source').dispatchEvent(new Event('change'))");
  console.log("PASS instant source/settings persistence, collapsed reload, controller identity and reconnect");

  await evaluate(`
    window.mappedPad = connectedPads.find(pad => pad.id === 'Saved controller');
    mappedPad.buttons = Array.from({length:16}, () => ({pressed:false,value:0}));
    document.getElementById('button-controls').open = true;
  `);
  await wait(60);
  await evaluate("document.getElementById('button-action').value = 'clock'; document.getElementById('button-action').dispatchEvent(new Event('change')); mappedPad.buttons[4].pressed = true");
  await wait(80);
  assert.equal(await evaluate("MoveSim.app.buttons.preferences.get().mapping.clock"), 4);
  assert.equal(await evaluate("MoveSim.app.clock.isRunning()"), false, "assignment press does not run its action");
  await evaluate("mappedPad.buttons[4].pressed = false");
  await wait(50);
  await evaluate("mappedPad.buttons[6].pressed=true");
  await wait(60);
  assert.equal(await evaluate("MoveSim.app.buttons.preferences.get().mapping.clock"),6,"next press overwrites the selected action without reselecting");
  assert.equal(await evaluate("MoveSim.app.buttons.isAssigning() && document.getElementById('button-action').value==='clock' && !MoveSim.app.clock.isRunning()"),true);
  await evaluate("mappedPad.buttons[6].pressed=false");
  await wait(40);
  await evaluate("mappedPad.buttons[4].pressed=true");
  await wait(60);
  assert.equal(await evaluate("MoveSim.app.buttons.preferences.get().mapping.clock"),4);
  await evaluate("mappedPad.buttons[4].pressed=false; document.getElementById('button-action').value=''; document.getElementById('button-action').dispatchEvent(new Event('change'))");
  await wait(50);
  assert.equal(await evaluate("MoveSim.app.buttons.isAssigning()"),false);
  await evaluate("mappedPad.buttons[4].pressed = true");
  await wait(100);
  assert.equal(await evaluate("MoveSim.app.clock.isRunning()"), true, "mapped clock toggles once on the press edge");
  await wait(80);
  assert.equal(await evaluate("MoveSim.app.clock.isRunning()"), true, "held clock button does not repeat");
  await evaluate("mappedPad.buttons[4].pressed = false");
  await wait(50);
  await evaluate("mappedPad.buttons[4].pressed = true");
  await wait(50);
  assert.equal(await evaluate("MoveSim.app.clock.isRunning()"), false);
  await evaluate("mappedPad.buttons[4].pressed = false; document.getElementById('button-action').value = 'send'; document.getElementById('button-action').dispatchEvent(new Event('change')); mappedPad.buttons[6].pressed = true");
  await wait(60);
  assert.equal(await evaluate("MoveSim.app.buttons.isSending()"), false, "learning the deadman does not activate it");
  await evaluate("mappedPad.buttons[6].pressed = false; document.getElementById('button-controls').open=false");
  await wait(50);
  assert.equal(await evaluate("!MoveSim.app.buttons.isAssigning() && document.getElementById('button-action').value===''") ,true,"collapse exits assignment");
  await evaluate("mappedPad.buttons[6].pressed = true");
  await wait(50);
  assert.equal(await evaluate("MoveSim.app.buttons.isSending()"), true);
  await click("send-button");
  await evaluate("mappedPad.buttons[6].pressed = false");
  await wait(50);
  assert.equal(await evaluate("MoveSim.app.buttons.isSending()"), true, "screen latch remains on after the deadman releases");
  await click("send-button");
  assert.equal(await evaluate("MoveSim.app.buttons.isSending()"), false);
  await evaluate("mappedPad.buttons[6].pressed = true; mappedPad.buttons[4].pressed = true");
  await wait(50);
  await evaluate("mappedPad.buttons[4].pressed = false");
  await command("Input.dispatchKeyEvent", {type:"keyDown",key:"ArrowRight",code:"ArrowRight",windowsVirtualKeyCode:39});
  await wait(100);
  assert.equal(await evaluate("MoveSim.app.messages.entries.length > 0"), true);
  await evaluate("mappedPad.buttons[6].pressed = false");
  await wait(250);
  const stoppedBlockCount = await evaluate("MoveSim.app.models[1].blocks.length");
  const movingPosition = await evaluate("MoveSim.app.models[0].stateAt(MoveSim.app.clock.now()).positionXdmm");
  await wait(100);
  assert.equal(await evaluate("MoveSim.app.models[1].blocks.length"), stoppedBlockCount);
  assert.equal(await evaluate("MoveSim.app.models[1].status"), "stopped");
  assert.equal(await evaluate("MoveSim.app.models[0].stateAt(MoveSim.app.clock.now()).positionXdmm"), movingPosition, "Just Draw stays stopped after deadman release");
  assert.equal(await evaluate("MoveSim.app.clock.isRunning()"), true);
  await command("Input.dispatchKeyEvent", {type:"keyUp",key:"ArrowRight",code:"ArrowRight",windowsVirtualKeyCode:39});
  await evaluate("MoveSim.app.pause(); MoveSim.app.clear()");

  await evaluate("document.getElementById('button-controls').open=true; document.getElementById('button-action').value='bump'; document.getElementById('button-action').dispatchEvent(new Event('change')); mappedPad.buttons[8].pressed=true");
  await wait(70);
  assert.equal(await evaluate("MoveSim.app.buttons.preferences.get().mapping.bump"),8);
  assert.equal(await evaluate("MoveSim.app.buttons.isAssigning() && !MoveSim.app.buttons.isFineBump()"),true,"assigning Fine bump does not activate it");
  await evaluate("mappedPad.buttons[8].pressed=false; document.getElementById('button-controls').open=false");
  await wait(50);
  await evaluate("mappedPad.buttons[8].pressed=true");
  await wait(50);
  assert.equal(await evaluate("MoveSim.app.buttons.isFineBump()"),true,"remapped fine modifier works while held");
  await evaluate("mappedPad.buttons[8].pressed=false");
  await wait(50);
  assert.equal(await evaluate("MoveSim.app.buttons.isFineBump()"),false);
  assert.equal(await evaluate("JSON.parse(localStorage.getItem('movesim.buttons.v1')).mapping.bump"),8);

  for (let slot = 0; slot < 4; slot++) {
    await evaluate("mappedPad.buttons[" + slot + "].pressed = true");
    await wait(50);
    assert.equal(await evaluate("document.getElementById('speed-select').value"), String(slot));
    assert.equal(await evaluate("MoveSim.app.buttons.speed()"), [10,100,500,1000][slot]);
    await evaluate("mappedPad.buttons[" + slot + "].pressed = false");
    await wait(50);
  }
  await evaluate("document.getElementById('speed-slot-3').value = '100.5'; document.getElementById('speed-slot-3').dispatchEvent(new Event('input',{bubbles:true}))");
  assert.equal(await evaluate("MoveSim.app.buttons.speed()"), 1005);
  await click("send-button");
  await click("pause-button");
  await command("Input.dispatchKeyEvent", {type:"keyDown",key:"ArrowRight",code:"ArrowRight",windowsVirtualKeyCode:39});
  await wait(80);
  assert.equal(await evaluate("MoveSim.app.messages.entries.at(-1).requestedSpeeddmmPerSecond"), 1005);
  await evaluate("mappedPad.buttons[0].pressed = true");
  await wait(80);
  assert.equal(await evaluate("MoveSim.app.messages.entries.at(-1).requestedSpeeddmmPerSecond"), 10, "new messages immediately use the newly selected speed");
  await evaluate("mappedPad.buttons[0].pressed = false; document.getElementById('speed-select').value = '3'; document.getElementById('speed-select').dispatchEvent(new Event('change'))");
  await command("Input.dispatchKeyEvent", {type:"keyUp",key:"ArrowRight",code:"ArrowRight",windowsVirtualKeyCode:39});
  await command("Page.reload");
  await wait(250);
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await evaluate("Boolean(window.MoveSim && MoveSim.app)")) break;
    await wait(50);
  }
  assert.deepEqual(await evaluate("[MoveSim.app.buttons.preferences.get().mapping.clock,MoveSim.app.buttons.preferences.get().mapping.send,MoveSim.app.buttons.speed(),MoveSim.app.buttons.isSending(),MoveSim.app.clock.isRunning(),document.getElementById('button-controls').open]"), [4,6,1005,false,false,false]);
  assert.equal(await evaluate("MoveSim.app.buttons.preferences.get().mapping.bump===8 && !MoveSim.app.buttons.isFineBump()"),true,"fine mapping persists and its runtime state starts off");
  await evaluate(`
    window.mappedPad = {index:3,id:'Saved controller',mapping:'standard',axes:[0,0,0,0,0,0],buttons:Array.from({length:16}, (_,index) => ({pressed:index===4 || index===6,value:0}))};
    Object.defineProperty(navigator, 'getGamepads', {configurable:true,value:() => [mappedPad]});
  `);
  await wait(80);
  assert.equal(await evaluate("MoveSim.app.clock.isRunning() && MoveSim.app.buttons.isSending()"), true, "the first Clock and Send presses work when they reveal the controller after refresh");
  await wait(100);
  assert.equal(await evaluate("MoveSim.app.clock.isRunning() && MoveSim.app.buttons.isSending()"), true, "holding the first press does not toggle the clock repeatedly");
  await evaluate("mappedPad.buttons[4].pressed = false; mappedPad.buttons[6].pressed = false");
  await wait(50);
  assert.equal(await evaluate("MoveSim.app.clock.isRunning() && !MoveSim.app.buttons.isSending()"), true, "releasing the first deadman press disables Send");
  await evaluate("mappedPad.buttons[4].pressed = true");
  await wait(50);
  assert.equal(await evaluate("MoveSim.app.clock.isRunning()"), false, "the next Clock press stops the clock normally");
  await evaluate("mappedPad.buttons[4].pressed = false");
  await wait(50);
  console.log("PASS action learning, press-edge clock, held deadman, screen latch, ABXY speeds, persistence and first press after refresh");

  await click("send-button");
  await click("pause-button");
  await command("Input.dispatchKeyEvent", {type:"keyDown",key:"ArrowRight",code:"ArrowRight",windowsVirtualKeyCode:39});
  await wait(200);
  assert.equal(await evaluate("MoveSim.app.models[0].stateAt(MoveSim.app.clock.now()).positionXdmm > 2000 && MoveSim.app.messages.entries.length > 0"), true);
  const beforeControllerClear = await evaluate("MoveSim.app.clock.now()");
  await evaluate("mappedPad.buttons[9].pressed = true");
  await wait(60);
  assert.deepEqual(await evaluate("[MoveSim.app.models[0].stateAt(MoveSim.app.clock.now()).positionXdmm,MoveSim.app.models[0].stateAt(MoveSim.app.clock.now()).positionYdmm,MoveSim.app.messages.entries.filter(message => message.modelId === 'g91').length,MoveSim.app.buttons.isSending(),MoveSim.app.clock.isRunning()]"), [2000,2000,0,false,true]);
  const afterControllerClear = await evaluate("MoveSim.app.clock.now()");
  assert.ok(afterControllerClear < beforeControllerClear);
  await wait(100);
  assert.equal(await evaluate("MoveSim.app.clock.now()") > afterControllerClear, true, "holding Clear does not repeatedly reset the clock");
  await evaluate("mappedPad.buttons[9].pressed = false; MoveSim.app.pause()");
  await command("Input.dispatchKeyEvent", {type:"keyUp",key:"ArrowRight",code:"ArrowRight",windowsVirtualKeyCode:39});
  console.log("PASS Start/Menu Clear & home, clock-state preservation and one reset per press");

  await command("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await evaluate("document.getElementById('canvas-view').value='g91';document.getElementById('canvas-view').dispatchEvent(new Event('change'))");
  await wait(120);
  assert.equal(await evaluate("document.documentElement.scrollWidth <= innerWidth"), true, "narrow layout has no horizontal overflow");
  assert.equal(await evaluate("getComputedStyle(document.getElementById('camera-x')).fontSize===getComputedStyle(document.getElementById('clock-time')).fontSize"),true,"narrow DRO continues matching the clock font");
  console.log("PASS narrow layout");
  await command("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await click("canvas-zoom-in");
  await evaluate("MoveSim.app.clear()");
  await wait(60);
  assert.equal(await evaluate("MoveSim.app.motionCanvas.getView().followedModelId==='g91' && MoveSim.app.motionCanvas.getView().zoom===1 && document.getElementById('camera-x').textContent==='X200.0'"),true,"Clear retains CAM-era selection, homes the DRO and resets its 100 mm field");
  await evaluate("document.getElementById('canvas-view').value='';document.getElementById('canvas-view').dispatchEvent(new Event('change'))");

  // A known captured input creates a useful review screenshot without slow manual driving.
  await evaluate(`
    document.getElementById('input-source').value = 'joystick';
    document.getElementById('input-source').dispatchEvent(new Event('change'));
    if (document.getElementById('gates-button').getAttribute('aria-pressed') !== 'true') document.getElementById('gates-button').click();
    MoveSim.app.clear();
    document.getElementById('speed-select').value = '2';
    document.getElementById('speed-select').dispatchEvent(new Event('change'));
    MoveSim.app.input.clear('joystick', {sendEnabled:true,speeddmmPerSecond:500});
    [[0,-1,0],[2000,0,-1],[3600,1,0],[6200,0,1],[9600,-1,0],[11600,0,-1],[12600,0,0]].forEach(([t,x,y]) => MoveSim.app.input.record(t,x,y,'joystick'));
    MoveSim.app.input.record(12600,0,0,'joystick',{sendEnabled:false,speeddmmPerSecond:500});
    MoveSim.app.models.forEach(model => model.advanceTo(14000));
    MoveSim.app.clock.now = () => 14000;
    document.getElementById('return-live').click();
    MoveSim.app.selectMessage(MoveSim.app.messages.entries[630]);
    document.getElementById('return-live').click();
    window.scrollTo(0, 0);
  `);
  await wait(260);
  assert.equal(await evaluate("MoveSim.app.motionCanvas.gateHits(MoveSim.app.models, 14000).some(Boolean)"), true);
  const screenshot = await command("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  const artifactDirectory = path.join(__dirname, "artifacts");
  fs.mkdirSync(artifactDirectory, { recursive: true });
  fs.writeFileSync(path.join(artifactDirectory, "movesim.png"), Buffer.from(screenshot.data, "base64"));
  await evaluate("document.getElementById('canvas-view').value='just-draw';document.getElementById('canvas-view').dispatchEvent(new Event('change'));MoveSim.app.inspect(300)");
  await wait(100);
  const cameraScreenshot=await command("Page.captureScreenshot",{format:"png",captureBeyondViewport:false});
  fs.writeFileSync(path.join(artifactDirectory,"camera-view.png"),Buffer.from(cameraScreenshot.data,"base64"));
  assert.deepEqual(errors, [], "no runtime or resource errors");
  console.log("PASS gate history and screenshot; no browser errors");
  console.log("Screenshot: " + path.join(artifactDirectory, "movesim.png"));
}

main().catch(function (error) { console.error(error); process.exitCode = 1; }).finally(async function () {
  if (socket && socket.readyState === WebSocket.OPEN) {
    try { await command("Browser.close"); } catch (_) { /* The socket may close before the acknowledgement. */ }
    socket.close();
  }
  if (browser && browser.exitCode === null) browser.kill();
  if (browserExit) await Promise.race([browserExit, wait(2000)]);
  // Delete only the disposable profile this process created inside the OS temp folder.
  const resolvedProfile = path.resolve(profilePath);
  if (path.dirname(resolvedProfile).toLowerCase() === temporaryRoot.toLowerCase() && path.basename(resolvedProfile).startsWith("movesim-browser-")) {
    fs.rmSync(resolvedProfile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});
