"use strict";
(function (sim) {
  sim.createInputHistory = function () {
    function initial(source, stream) {
      return Object.assign({ timeMs: 0, x: 0, y: 0, source: source || "joystick", sendEnabled: false, speeddmmPerSecond: 500,
        wheelX: false, wheelY: false, wheelEpoch: 0, wheelTotalXdmm: 0, wheelTotalYdmm: 0,
        wheelStartXdmm: 0, wheelStartYdmm: 0, wheelRevolutiondmm: 1000, dpadX: 0, dpadY: 0,
        bumpTotalXdmm: 0, bumpTotalYdmm: 0, bumpStartXdmm: 0, bumpStartYdmm: 0 }, stream);
    }
    const history = [initial()];
    return {
      history,
      record: function (timeMs, x, y, source, stream) {
        const last = history[history.length - 1];
        const sample = Object.assign({}, last, stream, { timeMs, x, y, source });
        if (Object.keys(sample).every(function (name) { return name === "timeMs" || last[name] === sample[name]; })) return;
        // There is one shared input state for each millisecond, even with several DOM events.
        if (last.timeMs === timeMs) history[history.length - 1] = sample;
        else history.push(sample);
      },
      at: function (timeMs) { return history[sim.findAtTime(history, timeMs)]; },
      clear: function (source, stream) {
        history.length = 0;
        history.push(initial(source, stream));
      }
    };
  };

  sim.createInputControls = function (onChange, buttons, isClockRunning) {
    const element = function (id) { return document.getElementById(id); };
    const sourceSelect = element("input-source");
    const deviceSelect = element("gamepad-device");
    const preferences = sim.createInputSettings();
    let settings = preferences.get();
    const wheelInput = sim.createWheelInput();
    const scaleSelect = element("wheel-scale");
    wheelInput.setScale(settings.wheelRevolutiondmm);
    scaleSelect.value = String(settings.wheelRevolutiondmm);
    const keys = new Set();
    const sticks = [
      { element: element("joystick"), status: element("joystick-status"), pointerId: null, x: 0, y: 0 },
      { element: element("joystick-right"), status: element("joystick-status-right"), pointerId: null, x: 0, y: 0 }
    ];
    const channels = [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }];
    const wheels = sticks.map(function (stick, index) { return sim.createFingerWheelView(stick.element, "wheel-" + index); });
    const modeButtons = [element("joystick-mode"), element("joystick-mode-right")];
    let output = { x: 0, y: 0 };
    let outputWriter = null;
    let lastDeviceList = "";
    let knownDevices = [];
    let previousGamepadState = [null, null, null];
    let previousDpadButtons = [false, false, false, false];

    function renderModes() {
      modeButtons.forEach(function (button, index) {
        const name = index === 0 ? "Left" : "Right";
        const clickName = index === 0 ? "L3" : "R3";
        button.textContent = name + (wheels[index].state.enabled ? " wheel" : " stick") + " · " + clickName;
        button.disabled = isClockRunning();
        button.setAttribute("aria-pressed", String(wheels[index].state.enabled));
        button.title = "Toggle " + name.toLowerCase() + " stick / finger wheel (" + clickName + "). Stop the clock to change mode.";
        sticks[index].element.setAttribute("aria-label", name + (wheels[index].state.enabled ? " finger wheel. Drag outside the 0.75 neutral band to turn the " + (index === 0 ? "X" : "Y") + " axis." : " proportional joystick. Drag to move; release to stop."));
      });
    }
    function wheelStream() {
      wheelInput.setActive(isClockRunning() && buttons.isSending());
      return Object.assign(wheelInput.snapshot(), { wheelX: wheels[0].state.enabled, wheelY: wheels[1].state.enabled,
        dpadX: buttons.isFineBump() || buttons.isAssigning() ? 0 : channels[2].x,
        dpadY: buttons.isFineBump() || buttons.isAssigning() ? 0 : channels[2].y });
    }
    function toggleWheel(index) {
      // A running-clock press is ignored rather than queued for a later pause.
      if (isClockRunning()) return;
      wheels[index].toggle();
      if (wheels[index].state.enabled && outputWriter === index) output = { x: 0, y: 0 };
      if (outputWriter !== 2) output = { x: wheels[0].state.enabled ? 0 : output.x, y: wheels[1].state.enabled ? 0 : output.y };
      renderModes();
      onChange(output.x, output.y, sourceSelect.value);
    }
    modeButtons.forEach(function (button, index) { button.addEventListener("click", function () { toggleWheel(index); }); });

    const preferenceFields = [
      ["deadZone", "dead-zone"],
      ["leftAxisX", "gamepad-axis-x"], ["leftAxisY", "gamepad-axis-y"],
      ["leftInvertX", "gamepad-invert-x"], ["leftInvertY", "gamepad-invert-y"],
      ["rightAxisX", "gamepad-right-axis-x"], ["rightAxisY", "gamepad-right-axis-y"],
      ["rightInvertX", "gamepad-right-invert-x"], ["rightInvertY", "gamepad-right-invert-y"]
    ];
    sourceSelect.value = settings.source;
    preferenceFields.forEach(function (field) {
      const control = element(field[1]);
      if (control.type === "checkbox") control.checked = settings[field[0]];
      else control.value = String(settings[field[0]]);
    });

    function showStorageNotice() {
      const status = element("input-settings-status");
      status.textContent = preferences.notice();
      status.hidden = !status.textContent;
    }
    function savePreferences(changes) {
      settings = preferences.update(changes);
      showStorageNotice();
    }
    scaleSelect.addEventListener("change", function () {
      const scale = Number(scaleSelect.value);
      wheelInput.setScale(scale);
      savePreferences({ wheelRevolutiondmm: scale });
      onChange(output.x, output.y, sourceSelect.value);
    });
    function showSourceHelp() {
      element("input-help").textContent = sourceSelect.value === "gamepad"
        ? "Sticks send X/Y; wheels own X (left) or Y (right). D-pad drives both axes in either mode."
        : "Drag a stick or turn a wheel. Arrow / WASD keys drive the left control. Send enables motion.";
    }
    function normalise(value) {
      if (!Number.isFinite(value) || Math.abs(value) <= settings.deadZone) return 0;
      return sim.clamp(value, -1, 1);
    }
    function stickTravelPixels(stick) { return Math.max(1, stick.element.clientWidth / 2 - 22); }
    function renderStick(index) {
      const stick = sticks[index];
      const value = channels[index];
      const direction = (!value.x && !value.y) ? "NEUTRAL" : (value.y > 0 ? "N" : value.y < 0 ? "S" : "") + (value.x > 0 ? "E" : value.x < 0 ? "W" : "");
      const signed = function (number) { return (number >= 0 ? "+" : "") + number.toFixed(2); };
      stick.status.textContent = "X" + signed(value.x) + " Y" + signed(value.y) + " " + direction;
      const travel = stickTravelPixels(stick);
      stick.element.querySelector(".joystick-knob").style.transform = "translate(" + value.x * travel + "px," + -value.y * travel + "px)";
    }
    function publish(index, x, y, force) {
      // The wheel's radial neutral band is separate from the joystick dead zone.
      // Observe raw stick motion before the usual shared X/Y filtering.
      wheelStream();
      let wheelChanged = false;
      if (index < wheels.length) wheelChanged = wheelInput.turn(index, wheels[index].update(x, y));
      x = normalise(x);
      y = normalise(y);
      const previous = channels[index];
      const changed = previous.x !== x || previous.y !== y || force;
      channels[index] = { x, y };
      if (index < sticks.length) renderStick(index);
      // Each changed stick or D-pad update writes the same input stream. Releasing
      // one can overwrite another held direction; that collision is intentional.
      const isWheel = index < wheels.length && wheels[index].state.enabled;
      const quietDpad = index === 2 && (buttons.isFineBump() || buttons.isAssigning());
      // A discrete bump adds distance without replacing another stick's velocity.
      // Entering fine mode must still release any previous held D-pad velocity.
      let nextX = x;
      let nextY = y;
      if (quietDpad) {
        nextX = outputWriter === 2 ? 0 : output.x;
        nextY = outputWriter === 2 ? 0 : output.y;
      } else if (index !== 2) {
        if (wheels[0].state.enabled) nextX = 0;
        if (wheels[1].state.enabled) nextY = 0;
      }
      if (!isWheel && changed && (output.x !== nextX || output.y !== nextY)) {
        output = { x: nextX, y: nextY };
        outputWriter = index;
        onChange(output.x, output.y, sourceSelect.value);
      } else if (wheelChanged || (index === 2 && changed)) {
        // A wheel-owned axis reads D-pad state separately. Record its release
        // even if another control already left the shared joystick vector at zero.
        onChange(output.x, output.y, sourceSelect.value);
      }
    }
    function publishJoystick(index) {
      if (sourceSelect.value !== "joystick") return;
      const stick = sticks[index];
      if (index === 0 && keys.size) {
        const x = Number(keys.has("arrowright") || keys.has("d")) - Number(keys.has("arrowleft") || keys.has("a"));
        const y = Number(keys.has("arrowup") || keys.has("w")) - Number(keys.has("arrowdown") || keys.has("s"));
        publish(index, x, y);
      } else publish(index, stick.x, stick.y);
    }

    // Each stick owns its pointer capture so two fingers can exercise both streams.
    sticks.forEach(function (stick, index) {
      function movePointer(event) {
        if (event.pointerId !== stick.pointerId) return;
        const bounds = stick.element.getBoundingClientRect();
        const travel = stickTravelPixels(stick);
        let x = (event.clientX - bounds.left - bounds.width / 2) / travel;
        let y = -(event.clientY - bounds.top - bounds.height / 2) / travel;
        const length = Math.hypot(x, y);
        if (length > 1) { x /= length; y /= length; }
        stick.x = x;
        stick.y = y;
        publishJoystick(index);
      }
      stick.element.addEventListener("pointerdown", function (event) {
        if (sourceSelect.value !== "joystick" || event.button !== 0 || stick.pointerId !== null) return;
        stick.pointerId = event.pointerId;
        stick.element.setPointerCapture(event.pointerId);
        stick.element.focus();
        movePointer(event);
      });
      stick.element.addEventListener("pointermove", movePointer);
      function releasePointer(event) {
        if (event.pointerId !== stick.pointerId) return;
        stick.pointerId = null;
        stick.x = stick.y = 0;
        publishJoystick(index);
      }
      ["pointerup", "pointercancel", "lostpointercapture"].forEach(function (name) { stick.element.addEventListener(name, releasePointer); });
    });

    function keyChange(event, pressed) {
      const key = event.key.toLowerCase();
      if (!["arrowup", "arrowdown", "arrowleft", "arrowright", "w", "a", "s", "d"].includes(key)) return;
      if (pressed && (event.target.matches("input, select, textarea, button") || event.ctrlKey || event.altKey || event.metaKey)) return;
      if (sourceSelect.value !== "joystick" || (!pressed && !keys.has(key))) return;
      event.preventDefault();
      if (pressed) keys.add(key); else keys.delete(key);
      publishJoystick(0);
    }
    window.addEventListener("keydown", function (event) { keyChange(event, true); });
    window.addEventListener("keyup", function (event) { keyChange(event, false); });

    function reset(keepButtons) {
      const hadDpad = Boolean(channels[2].x || channels[2].y);
      if (buttons && keepButtons !== true) buttons.releaseDevice();
      keys.clear();
      sticks.forEach(function (stick, index) {
        wheels[index].release();
        stick.pointerId = null;
        stick.x = stick.y = 0;
        channels[index] = { x: 0, y: 0 };
        renderStick(index);
      });
      channels[2] = { x: 0, y: 0 };
      previousGamepadState = [null, null, null];
      previousDpadButtons = [false, false, false, false];
      if (output.x || output.y || hadDpad) {
        output = { x: 0, y: 0 };
        outputWriter = null;
        onChange(0, 0, sourceSelect.value);
      }
    }
    window.addEventListener("blur", reset);
    sourceSelect.addEventListener("change", function () {
      reset();
      savePreferences({ source: sourceSelect.value });
      showSourceHelp();
      onChange(0, 0, sourceSelect.value);
    });
    preferenceFields.forEach(function (field) {
      const control = element(field[1]);
      function changed() {
        const value = control.type === "checkbox" ? control.checked : control.valueAsNumber;
        if (control.type !== "checkbox" && (!Number.isFinite(value) || !control.checkValidity())) return;
        const change = {};
        change[field[0]] = value;
        savePreferences(change);
        previousGamepadState = [null, null, null];
        if (field[0] === "deadZone") sticks.forEach(function (_, index) { publishJoystick(index); });
      }
      control.addEventListener("change", changed);
      if (control.type !== "checkbox") control.addEventListener("input", changed);
    });
    deviceSelect.addEventListener("change", function () {
      const device = knownDevices.find(function (candidate) { return String(candidate.index) === deviceSelect.value; });
      if (!device) return;
      reset();
      savePreferences({ controllerId: device.id, controllerIndex: device.index });
      lastDeviceList = "";
    });

    function chooseDevice(devices) {
      if (!settings.controllerId && devices.length) {
        savePreferences({ controllerId: devices[0].id, controllerIndex: devices[0].index });
      }
      const matching = devices.filter(function (device) { return device.id === settings.controllerId; });
      return matching.find(function (device) { return device.index === settings.controllerIndex; }) || matching[0];
    }
    function refreshDevices(devices) {
      knownDevices = devices;
      const device = chooseDevice(devices);
      const signature = JSON.stringify([devices.map(function (entry) { return [entry.index, entry.id]; }), settings.controllerId, settings.controllerIndex]);
      if (signature !== lastDeviceList) {
        deviceSelect.replaceChildren();
        if (!device) {
          const option = document.createElement("option");
          option.value = "";
          option.textContent = settings.controllerId ? settings.controllerId + " (disconnected)" : "Press a controller button to detect";
          deviceSelect.append(option);
        }
        devices.forEach(function (entry) {
          const option = document.createElement("option");
          option.value = String(entry.index);
          option.textContent = entry.id;
          deviceSelect.append(option);
        });
        deviceSelect.value = device ? String(device.index) : "";
        lastDeviceList = signature;
      }
      return device;
    }
    function neutraliseGamepad() {
      if (sourceSelect.value !== "gamepad") return;
      channels.forEach(function (_, index) { publish(index, 0, 0); });
      previousGamepadState = [null, null, null];
      previousDpadButtons = [false, false, false, false];
    }
    function pollGamepad() {
      let devices;
      try {
        if (!navigator.getGamepads) throw new Error("Gamepad API is unavailable. Try a current browser on localhost.");
        devices = Array.from(navigator.getGamepads()).filter(Boolean);
      } catch (error) {
        if (buttons) buttons.releaseDevice();
        element("gamepad-status").textContent = error.message;
        neutraliseGamepad();
        return;
      }
      const device = refreshDevices(devices);
      if (buttons) buttons.poll(device);
      if (!device) {
        element("gamepad-status").textContent = settings.controllerId ? "Waiting for the saved controller. Focus this page and press a controller button." : "No controller detected. Focus this page and press a controller button.";
        neutraliseGamepad();
        return;
      }
      element("gamepad-status").textContent = device.axes.length + " axes · " + device.buttons.length + " buttons · " + (device.mapping || "custom mapping");
      if (sourceSelect.value !== "gamepad") return;
      const values = ["left", "right"].map(function (name) {
        return {
          x: (device.axes[settings[name + "AxisX"]] || 0) * (settings[name + "InvertX"] ? -1 : 1),
          y: (device.axes[settings[name + "AxisY"]] || 0) * (settings[name + "InvertY"] ? -1 : 1)
        };
      });
      // The D-pad is another writer, with a full +/-1.0 value on each chosen axis.
      const pressed = function (index) { return Boolean(device.buttons[index] && device.buttons[index].pressed); };
      values.push(device.mapping === "standard"
        ? { x: Number(pressed(15)) - Number(pressed(14)), y: Number(pressed(12)) - Number(pressed(13)) }
        : { x: 0, y: 0 });
      const dpadButtons = [15, 14, 12, 13].map(function (index) { return device.mapping === "standard" && pressed(index); });
      let bumped = false;
      if (buttons.isFineBump() && !buttons.isAssigning()) {
        wheelStream();
        const fresh = dpadButtons.map(function (value, index) { return value && !previousDpadButtons[index]; });
        bumped = wheelInput.bump(Number(fresh[0]) - Number(fresh[1]), Number(fresh[2]) - Number(fresh[3]));
      }
      previousDpadButtons = dpadButtons;
      values.forEach(function (value, index) {
        const signature = device.index + ":" + value.x + ":" + value.y + (index === 2 ? ":" + buttons.isFineBump() + ":" + buttons.isAssigning() : "");
        if (signature !== previousGamepadState[index]) {
          publish(index, value.x, value.y, index === 2 && Boolean(value.x || value.y || channels[2].x || channels[2].y));
          previousGamepadState[index] = signature;
        }
      });
      if (bumped) onChange(output.x, output.y, sourceSelect.value);
    }

    showStorageNotice();
    showSourceHelp();
    sticks.forEach(function (_, index) { renderStick(index); });
    renderModes();
    return {
      poll: function () { pollGamepad(); renderModes(); },
      refreshModes: function () { wheelStream(); renderModes(); },
      wheelStream,
      toggleWheel,
      wheels,
      reset,
      preferences,
      source: function () { return sourceSelect.value; },
      current: function () { return output; },
      hasHeldInput: function () { return channels.some(function (value) { return Boolean(value.x || value.y); }); },
      rememberGamepadAfterClear: function () {
        const saved = previousGamepadState.slice();
        const savedDpad = previousDpadButtons.slice();
        reset(true);
        wheels.forEach(function (wheel) { wheel.home(); });
        wheelInput.clear();
        previousGamepadState = saved;
        previousDpadButtons = savedDpad;
      }
    };
  };
})(window.MoveSim);
