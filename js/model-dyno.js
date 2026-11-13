"use strict";
(function (sim) {
  // Bench prototype: neither commands nor capture depend on the application clock.
  sim.createDynoModel = function (options) {
    const now = options.now || function () { return performance.now(); };
    const makeSocket = options.makeSocket || function (address) { return new WebSocket(address); };
    const model = { id: "dyno", name: "Dyno", colour: "#ffc66d", visible: true,
      external: true, latestTimeMs: 0, history: [], points: [], velocityHistory: [],
      records: [], tests: [], status: "Disconnected", ready: false, connected: false };
    let socket, nextId = 0, initId, phase = "", positionReport, baseline;
    let epoch = now(), captureEpoch, currentTest = null;
    function notify() { if (options.onChange) options.onChange(model); }
    function elapsed() { return now() - epoch; }
    function savePosition(timeMs, x) {
      const state = { timeMs, positionXdmm: x * 10, positionYdmm: 0,
        velocityXdmmPerSecond: 0, velocityYdmmPerSecond: 0,
        accelerationXdmmPerSecondSquared: 0, accelerationYdmmPerSecondSquared: 0 };
      model.history.push(state);
      model.points.push({ timeMs, positionXdmm: Math.round(x * 10), positionYdmm: 0 });
      model.latestTimeMs = Math.max(model.latestTimeMs, timeMs);
    }
    function invalidate(status) {
      model.ready = false; phase = ""; model.status = status;
      if (currentTest) { currentTest.incomplete = status; currentTest = null; }
      notify();
    }
    function send(line) {
      if (!model.connected) throw new Error("Connect first.");
      const id = ++nextId;
      const sentTimeMs = elapsed();
      socket.send(id + " " + line);
      model.records.push({ type: "send", id, line, receivedTimeMs: sentTimeMs });
      return { id, sentTimeMs };
    }
    function finishIfComplete() {
      if (!currentTest || currentTest.okUs === null || currentTest.arrivalUs === null) return;
      currentTest = null; model.status = "Ready"; notify();
    }
    model.receive = function (event) {
      const receivedTimeMs = elapsed();
      // Preserve original timestamps and per-event receipt timing for later inspection.
      const record = Object.assign({}, event, { receivedTimeMs });
      model.records.push(record);
      if (event.type === "error") { invalidate(event.message + (event.lost ? " (" + event.lost + " lost)" : "")); return; }
      if (event.type === "submitted" && currentTest && event.id === currentTest.id) currentTest.submitted = record;
      if (event.type === "serial") {
        if (phase && event.id === initId) {
          if (phase === "position" && /^X:/.test(event.line)) positionReport = event.line;
          if (/^ok(?:\s|$)/.test(event.line)) {
            if (phase === "mode") { phase = "position"; initId = send("M114").id; }
            else if (phase === "position") {
              const match = positionReport && /(?:^|\s)X:\s*([-+\d.eE]+)/.exec(positionReport);
              if (!match || !Number.isFinite(Number(match[1]))) { invalidate("M114 did not report X"); return; }
              baseline = { x: Number(match[1]) }; phase = "snapshot";
              send("@snapshot"); // Adapter observation only; never forwarded to Marlin.
            }
          }
        }
        if (currentTest && event.id === currentTest.id && /^ok(?:\s|$)/.test(event.line)) {
          currentTest.okUs = (receivedTimeMs - currentTest.sentTimeMs) * 1000;
          currentTest.ok = record;
          finishIfComplete();
        }
      }
      if (event.type === "snapshot" && phase === "snapshot") {
        baseline.px = event.px;
        captureEpoch = { hostUs: event.hostUs, timeMs: receivedTimeMs };
        savePosition(receivedTimeMs, baseline.x);
        phase = ""; model.ready = true; model.status = "Ready";
      }
      if (event.type === "pulse" && baseline && captureEpoch) {
        // Only this module maps Y to zero. Dyno's coordinates are untouched.
        const x = baseline.x + event.px - baseline.px;
        const timeMs = captureEpoch.timeMs + (event.hostUs - captureEpoch.hostUs) / 1000;
        const previous = model.history[model.history.length - 1];
        const changedX = !previous || Math.abs(previous.positionXdmm / 10 - x) > 1e-7;
        if (changedX) {
          savePosition(timeMs, x);
          record.timeMs = timeMs; record.loggedX = x; record.loggedY = 0;
          if (currentTest) {
            const test = currentTest;
            test.pulses.push(record);
            test.pulseCount++;
            if (test.firstPulse === null) {
              test.firstPulse = record;
              test.startUs = (receivedTimeMs - test.sentTimeMs) * 1000;
            }
            test.lastPulse = record;
            if (test.arrivalUs === null && Math.abs(x - test.targetX) <= 1e-5) {
              test.arrival = record;
              test.arrivalUs = (receivedTimeMs - test.sentTimeMs) * 1000;
            }
            finishIfComplete();
          }
        }
      }
      notify();
    };
    model.connect = function (address) {
      if (socket) return;
      invalidate("Connecting");
      try { socket = makeSocket(address); }
      catch (error) { socket = null; invalidate(error.message); return; }
      const connection = socket;
      socket.onopen = function () { if (socket !== connection) return; model.connected = true; model.status = "Connected"; notify(); };
      socket.onmessage = function (message) {
        if (socket !== connection) return;
        try {
          const events = JSON.parse(message.data);
          (Array.isArray(events) ? events : [events]).forEach(model.receive);
        } catch (error) { invalidate("Receive error: " + error.message); }
      };
      socket.onerror = function () { if (socket === connection) invalidate("WebSocket error"); };
      socket.onclose = function () {
        if (socket !== connection) return;
        socket = null; model.connected = false; baseline = null; captureEpoch = null; invalidate("Disconnected");
      };
    };
    model.disconnect = function () {
      if (socket) { const previous = socket; socket = null; previous.close(); }
      model.connected = false; baseline = null; captureEpoch = null; invalidate("Disconnected");
    };
    model.init = function () {
      if (!model.connected || phase || currentTest) return;
      model.ready = false; baseline = null; positionReport = null;
      captureEpoch = null; phase = "mode"; model.status = "Initializing";
      initId = send("G91").id; notify();
    };
    model.sendTest = function (feedrate) {
      if (!model.ready || currentTest || !Number.isFinite(feedrate) || feedrate <= 0) return;
      const previous = model.history[model.history.length - 1];
      const startX = previous.positionXdmm / 10;
      const sent = send("G0 X1 F" + feedrate);
      currentTest = { id: sent.id, sentTimeMs: sent.sentTimeMs, startX, targetX: startX + 1,
        feedrate, okUs: null, startUs: null, arrivalUs: null,
        firstPulse: null, lastPulse: null, pulseCount: 0, pulses: [] };
      model.tests.push(currentTest); model.status = "Testing"; notify();
    };
    model.isBusy = function () { return !!phase || !!currentTest; };
    model.stateAt = function (timeMs) { return model.history[sim.findAtTime(model.history, timeMs)]; };
    model.advanceTo = function () {};
    // The shared Clear belongs to the local experiment. A bench capture survives it.
    model.clear = function () {};
    model.velocityHistory.push({ timeMs: 0, velocityXdmmPerSecond: 0, velocityYdmmPerSecond: 0 });
    savePosition(0, 0);
    return model;
  };
})(window.MoveSim);
