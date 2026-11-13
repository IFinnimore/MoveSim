"use strict";
(function (sim) {
  const element = function (id) { return document.getElementById(id); };
  const clock = sim.createClock();
  const activityTimer = sim.createActivityTimer(60000);
  const input = sim.createInputHistory();
  const messages = sim.createMessageLog();
  const machineSettings = sim.createMachineSettings();
  const models = [sim.createJustDrawModel({ input, messages, machineSettings: machineSettings.values }), sim.createG91Model({ input, messages, machineSettings: machineSettings.values })];
  let inspectionTimeMs = null;
  let selectedMessage = null;
  let clearing = false;
  let logLastDrawnMs = -Infinity;
  let pausedForInactivity = false;

  function streamSettings() { return Object.assign({ sendEnabled: buttons.isSending(), speeddmmPerSecond: buttons.speed() }, controls.wheelStream()); }

  function recordInput(x, y, source) {
    activityTimer.noteInput();
    if (clearing || !clock.isRunning()) return;
    // Do not rewrite a millisecond that models have already consumed. This keeps
    // later replay consistent with the input actually available at a sample event.
    const nextUnreadTimeMs = Math.max.apply(null, models.map(function (model) { return model.latestTimeMs; })) + 1;
    input.record(Math.max(clock.now(), nextUnreadTimeMs), x, y, source, streamSettings());
  }
  const buttons = sim.createButtonControls({
    onClock: function () { if (clock.isRunning()) pause(); else resume(); },
    onClear: clear,
    onStickClick: function (index) { controls.toggleWheel(index); },
    onActivity: activityTimer.noteInput,
    onChange: function () { const current = controls.current(); recordInput(current.x, current.y, controls.source()); }
  });
  const controls = sim.createInputControls(recordInput, buttons, clock.isRunning);
  input.clear(controls.source(), streamSettings());
  const accelerationField = element("machine-max-acceleration");
  accelerationField.value = String(machineSettings.values.maxAccelerationdmmPerSecondSquared / 10);
  function showMachineNotice() {
    element("machine-settings-status").textContent = machineSettings.notice();
    element("machine-settings-status").hidden = !machineSettings.notice();
  }
  function updateMachineAcceleration() {
    if (!accelerationField.checkValidity() || !Number.isFinite(accelerationField.valueAsNumber)) return;
    // Consume work with the previous machine settings before publishing a live
    // change. Editing a shared limit does not apply or overwrite model presets.
    if (clock.isRunning()) advanceModels(clock.now());
    machineSettings.setMaxAcceleration(Math.round(accelerationField.valueAsNumber * 10));
    showMachineNotice();
  }
  accelerationField.addEventListener("input", updateMachineAcceleration);
  accelerationField.addEventListener("change", updateMachineAcceleration);
  accelerationField.addEventListener("blur", function () { accelerationField.value = String(machineSettings.values.maxAccelerationdmmPerSecondSquared / 10); });
  showMachineNotice();
  // Each model owns a separate hidden body. A title-row toggle controls only its
  // own body, leaving render visibility and all other models' settings independent.
  document.querySelectorAll("[data-model-settings]").forEach(function (button) {
    const panel = element(button.getAttribute("aria-controls"));
    button.addEventListener("click", function () {
      panel.hidden = !panel.hidden;
      button.setAttribute("aria-expanded", String(!panel.hidden));
      button.classList.toggle("active", !panel.hidden);
      button.setAttribute("aria-label", (panel.hidden ? "Show " : "Hide ") + button.dataset.modelSettings + " settings");
    });
  });
  const motionCanvas = sim.createMotionCanvas(element("motion-canvas"));
  models.forEach(function (model) {
    const option = document.createElement("option");
    option.value = model.id;
    option.textContent = "CAM-era: " + model.name;
    element("canvas-view").append(option);
  });
  element("canvas-view").addEventListener("change", function (event) { motionCanvas.setView(event.target.value); });
  const velocityChart = sim.createVelocityChart(element("velocity-chart"), inspect, selectMessage);

  function readJustDrawParameters() {
    return {
      proportional: element("model-proportional").checked,
      sampleIntervalMs: Number(element("model-sample").value),
      messageIntervalMs: Number(element("model-message").value),
      deliveryDelayMs: Number(element("model-delay").value)
    };
  }

  function writeJustDrawParameters(parameters) {
    element("model-proportional").checked = parameters.proportional;
    element("model-sample").value = String(parameters.sampleIntervalMs);
    element("model-message").value = String(parameters.messageIntervalMs);
    element("model-delay").value = String(parameters.deliveryDelayMs);
    updateSettingsState();
  }

  function updateModelSettingsState(model, parameters, formId, buttonId, statusId) {
    // Compare against the running model, not the selected saved set. Saving a
    // notebook entry does not apply it, and reverting an edit can become clean again.
    const dirty = !element(formId).checkValidity() || Object.keys(model.parameterSchema).some(function (name) {
      return parameters[name] !== model.settings[name];
    });
    const button = element(buttonId);
    button.disabled = !dirty;
    button.dataset.state = dirty ? "dirty" : "clean";
    button.classList.toggle("dirty", dirty);
    button.textContent = dirty ? "Apply settings & start" : "Settings applied";
    element(statusId).textContent = dirty ? "Changes pending. Apply to continue from here." : "Displayed settings match the running model.";
    element(statusId).classList.toggle("dirty", dirty);
  }

  function updateSettingsState() { updateModelSettingsState(models[0], readJustDrawParameters(), "model-settings", "apply-settings", "settings-status"); }
  function readG91Parameters() { return { proportional: element("g91-proportional").checked, moveDurationMs: Number(element("g91-duration").value) }; }
  function updateG91SettingsState() { updateModelSettingsState(models[1], readG91Parameters(), "g91-model-settings", "g91-apply-settings", "g91-settings-status"); }
  function writeG91Parameters(parameters) {
    element("g91-proportional").checked = parameters.proportional;
    element("g91-duration").value = String(parameters.moveDurationMs);
    updateG91SettingsState();
  }

  const presetStore = sim.createPresetStore({ modelId: models[0].id, parameterSchema: models[0].parameterSchema });
  sim.bindPresetControls({
    store: presetStore,
    readParameters: function () {
      if (!element("model-settings").reportValidity()) throw new Error("Check the displayed parameter values.");
      return readJustDrawParameters();
    },
    writeParameters: writeJustDrawParameters,
    controls: {
      select: element("preset-select"), name: element("preset-name"), note: element("preset-note"),
      save: element("preset-save"), rename: element("preset-rename"), remove: element("preset-delete"),
      summary: element("preset-summary"), status: element("preset-status")
    }
  });
  const g91PresetStore = sim.createPresetStore({ modelId: models[1].id, parameterSchema: models[1].parameterSchema });
  sim.bindPresetControls({ store: g91PresetStore, readParameters: function () {
    if (!element("g91-model-settings").reportValidity()) throw new Error("Check the displayed parameter values.");
    return readG91Parameters();
  }, writeParameters: writeG91Parameters, controls: {
    select: element("g91-preset-select"), name: element("g91-preset-name"), note: element("g91-preset-note"), save: element("g91-preset-save"), rename: element("g91-preset-rename"), remove: element("g91-preset-delete"), summary: element("g91-preset-summary"), status: element("g91-preset-status")
  } });
  models.forEach(function (model) {
    const label = document.createElement("span");
    const line = document.createElement("i");
    line.className = "legend-line";
    line.style.borderColor = model.colour;
    label.append(line, document.createTextNode(model.name));
    element("motion-model-legend").append(label);
  });

  function advanceModels(timeMs) {
    // Visibility belongs only to the views. Every model consumes the same history.
    models.forEach(function (model) { model.advanceTo(timeMs); });
  }

  function pause(reason) {
    const wasRunning = clock.isRunning();
    clock.pause();
    controls.refreshModes();
    if (wasRunning) advanceModels(clock.now());
    pausedForInactivity = reason === "idle";
  }

  function resume() {
    activityTimer.noteInput();
    pausedForInactivity = false;
    inspectionTimeMs = null;
    const current = controls.current();
    clock.resume();
    input.record(clock.now() + 1, current.x, current.y, controls.source(), streamSettings());
    controls.refreshModes();
  }

  function inspect(timeMs) {
    pause();
    inspectionTimeMs = sim.clamp(timeMs, 0, clock.now());
  }

  function openMessages() {
    element("message-log").hidden = false;
    element("messages-button").setAttribute("aria-expanded", "true");
    logLastDrawnMs = -Infinity;
  }

  function selectMessage(message) {
    selectedMessage = message;
    inspect(message.receivedTimeMs === null ? message.sentTimeMs : message.receivedTimeMs);
    openMessages();
  }

  function clear() {
    clearing = true;
    // Clear preserves the running/paused choice, but starts a completely new run.
    controls.rememberGamepadAfterClear();
    buttons.resetSending();
    clock.clear();
    activityTimer.noteInput();
    pausedForInactivity = false;
    input.clear(controls.source(), streamSettings());
    messages.clear();
    models.forEach(function (model) { model.clear(); });
    inspectionTimeMs = null;
    selectedMessage = null;
    motionCanvas.resetViews();
    velocityChart.fit();
    logLastDrawnMs = -Infinity;
    clearing = false;
  }

  element("pause-button").addEventListener("click", function () { if (clock.isRunning()) pause(); else resume(); });
  element("clear-button").addEventListener("click", clear);
  [{ model: models[0], formId: "model-settings", read: readJustDrawParameters, update: updateSettingsState, visibilityId: "model-visible" },
    { model: models[1], formId: "g91-model-settings", read: readG91Parameters, update: updateG91SettingsState, visibilityId: "g91-visible" }].forEach(function (binding) {
    element(binding.formId).addEventListener("input", binding.update);
    element(binding.formId).addEventListener("change", binding.update);
    element(binding.formId).addEventListener("submit", function (event) {
      event.preventDefault();
      if (!event.currentTarget.reportValidity()) return;
      // Apply continues the current experiment. Clear & home owns the separate reset
      // action, so zoomed views and view navigation survive parameter tuning.
      pause();
      binding.model.applySettings(binding.read(), clock.now());
      resume();
      binding.update();
    });
    element(binding.visibilityId).addEventListener("change", function (event) { binding.model.visible = event.target.checked; });
  });
  ["grid", "gates"].forEach(function (name) {
    element(name + "-button").addEventListener("click", function (event) {
      const visible = event.currentTarget.getAttribute("aria-pressed") !== "true";
      event.currentTarget.setAttribute("aria-pressed", String(visible));
      event.currentTarget.classList.toggle("active", visible);
      if (name === "grid") motionCanvas.setGrid(visible);
      else { motionCanvas.setGates(visible); element("gates-label").hidden = !visible; }
    });
  });
  element("canvas-fit").addEventListener("click", motionCanvas.fit);
  element("canvas-zoom-in").addEventListener("click", function () { motionCanvas.zoom(1.5); });
  element("canvas-zoom-out").addEventListener("click", function () { motionCanvas.zoom(1 / 1.5); });
  element("timeline-fit").addEventListener("click", velocityChart.fit);
  element("timeline-zoom-in").addEventListener("click", function () { velocityChart.zoom(1.5); });
  element("timeline-zoom-out").addEventListener("click", function () { velocityChart.zoom(1 / 1.5); });
  element("messages-button").addEventListener("click", function () {
    const show = element("message-log").hidden;
    element("message-log").hidden = !show;
    element("messages-button").setAttribute("aria-expanded", String(show));
    logLastDrawnMs = -Infinity;
  });
  element("time-scrubber").addEventListener("input", function (event) { inspect(Number(event.target.value)); });
  element("return-live").addEventListener("click", function () { inspectionTimeMs = null; });
  // A hidden page cannot provide useful interactive input. Pause rather than allow
  // a held key or suspended browser tab to create an unseen stretch of motion.
  document.addEventListener("visibilitychange", function () { if (document.hidden) pause(); });
  // Notebook writing and view navigation are operator activity too. Merely moving
  // a pointer can keep the page active; background message traffic cannot.
  ["pointerdown", "pointermove", "keydown", "wheel", "input", "change"].forEach(function (name) {
    document.addEventListener(name, activityTimer.noteInput, { passive: true });
  });

  function drawMessageLog(frameTimeMs) {
    element("message-count").textContent = String(messages.entries.length);
    if (element("message-log").hidden || frameTimeMs - logLastDrawnMs < 200) return;
    logLastDrawnMs = frameTimeMs;
    const detail = element("message-detail");
    if (selectedMessage) {
      const message = selectedMessage;
      detail.textContent = "#" + message.id + " · " + message.modelName + "\n" +
        "Sample " + message.sampledTimeMs + " ms → send " + message.sentTimeMs + " ms\n" +
        "Receive " + (message.cancelledTimeMs !== undefined ? "cancelled at " + message.cancelledTimeMs + " ms" : message.receivedTimeMs === null ? "pending (due " + message.deliveryTimeMs + " ms)" : message.receivedTimeMs + " ms") + "\n" +
        "Δ X " + message.deltaXdmm + ", Y " + message.deltaYdmm + " dmm\n" +
        "v X " + message.velocityXdmmPerSecond + ", Y " + message.velocityYdmmPerSecond + " dmm/s";
      if (message.durationMs !== undefined) detail.textContent += "\nBlock " + message.durationMs + " ms · " + (message.stopping ? "ramp to zero" : "run");
      if (message.bumpDeltaXdmm || message.bumpDeltaYdmm) detail.textContent += "\nFine bump Δ X " + message.bumpDeltaXdmm + ", Y " + message.bumpDeltaYdmm + " dmm";
      if (message.wheelX || message.wheelY) {
        const requestedX = message.requestedDeltaXdmm === undefined ? message.wheelDeltaXdmm : message.requestedDeltaXdmm;
        const requestedY = message.requestedDeltaYdmm === undefined ? message.wheelDeltaYdmm : message.requestedDeltaYdmm;
        detail.textContent += "\nWheel " + (message.wheelX ? "X" : "") + (message.wheelY ? "Y" : "") + " · sample " + message.wheelSampleDurationMs + " ms";
        detail.textContent += "\nRequested Δ X " + requestedX + ", Y " + requestedY + " dmm";
      }
    } else detail.textContent = "Click a blue message marker or a log entry.\nRows show the latest 160; all messages stay recorded.";
    const list = element("message-list");
    const previousScroll = list.scrollTop;
    const entries = messages.entries.slice(-160).reverse();
    if (selectedMessage && !entries.includes(selectedMessage)) entries.unshift(selectedMessage);
    const fragment = document.createDocumentFragment();
    entries.forEach(function (message) {
      const button = document.createElement("button");
      button.className = "message-entry" + (selectedMessage === message ? " selected" : "");
      button.textContent = "#" + String(message.id).padStart(4, "0") + "  " + message.sentTimeMs + " → " + (message.cancelledTimeMs !== undefined ? "cancelled" : message.receivedTimeMs === null ? "…" : message.receivedTimeMs) + " ms  Δ(" + message.deltaXdmm + ", " + message.deltaYdmm + ")";
      button.addEventListener("click", function () { selectMessage(message); });
      fragment.append(button);
    });
    if (!entries.length) {
      const empty = document.createElement("div");
      empty.className = "message-empty";
      empty.textContent = "No messages in this run.";
      fragment.append(empty);
    }
    list.replaceChildren(fragment);
    list.scrollTop = previousScroll;
  }

  function drawFrame(frameTimeMs) {
    controls.poll();
    if (clock.isRunning() && activityTimer.shouldPause(controls.hasHeldInput() || buttons.hasHeldInput())) pause("idle");
    const elapsedTimeMs = clock.now();
    if (clock.isRunning()) advanceModels(elapsedTimeMs);
    const shownTimeMs = inspectionTimeMs === null ? elapsedTimeMs : inspectionTimeMs;
    motionCanvas.draw(models, shownTimeMs);
    velocityChart.draw(models, input.history, messages.entries, elapsedTimeMs, shownTimeMs, selectedMessage ? selectedMessage.id : null);

    element("clock-time").textContent = sim.formatTime(elapsedTimeMs);
    element("clock-label").textContent = clock.isRunning() ? "RUNNING" : pausedForInactivity ? "IDLE" : "STOPPED";
    element("clock-status").classList.toggle("paused", !clock.isRunning());
    element("pause-button").textContent = clock.isRunning() ? "Stop the clock" : "Start";
    element("pause-button").classList.toggle("primary", !clock.isRunning());
    element("pause-button").title = pausedForInactivity ? "Paused after 60 seconds without input. Start begins a fresh inactivity interval." : "";
    element("inspection-label").textContent = inspectionTimeMs === null ? (clock.isRunning() ? "LIVE" : "STOPPED") : "INSPECTING";
    models.forEach(function (model) {
      const state = model.stateAt(shownTimeMs);
      element(model.id + "-position").textContent = "X" + (Math.round(state.positionXdmm) / 10).toFixed(1) + " Y" + (Math.round(state.positionYdmm) / 10).toFixed(1);
    });
    element("record-count").textContent = models[0].points.length.toLocaleString() + " points recorded";
    element("g91-record-count").textContent = models[1].points.length.toLocaleString() + " points / " + models[1].blocks.length.toLocaleString() + " blocks recorded";
    element("g91-state").textContent = models[1].status.toUpperCase();
    element("time-scrubber").max = String(Math.max(1, elapsedTimeMs));
    element("time-scrubber").value = String(Math.round(shownTimeMs));
    element("inspection-time").textContent = Math.round(shownTimeMs).toLocaleString() + " ms";
    drawMessageLog(frameTimeMs);
    requestAnimationFrame(drawFrame);
  }

  // A small, readable inspection surface is useful when developing the next model.
  // Run histories remain in memory. Only named parameter sets and notes are stored.
  sim.app = { clock, input, messages, models, controls, buttons, machineSettings, motionCanvas, velocityChart, presetStore, g91PresetStore, pause, resume, clear, inspect, selectMessage };
  requestAnimationFrame(drawFrame);
})(window.MoveSim);
