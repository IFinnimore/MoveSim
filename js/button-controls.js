"use strict";
(function (sim) {
  const actions = ["clock", "clear", "send", "bump", "speed0", "speed1", "speed2", "speed3"];
  const actionNames = { clock: "Clock toggle", clear: "Clear & home", send: "Send while held", bump: "Fine bump while held", speed0: "Speed 1", speed1: "Speed 2", speed2: "Speed 3", speed3: "Speed 4" };
  const assignmentHelp = 'Select an action, then press controller buttons to assign. Remains in assignment until panel is collapsed or "Choose an action..." is chosen.';
  sim.gamepadButtonName = function (index) {
    if (index === null) return "Unassigned";
    const names = ["A", "B", "X", "Y", "L1", "R1", "L2", "R2", "Back", "Start/Menu", "L3", "R3", "D-pad up", "D-pad down", "D-pad left", "D-pad right", "Guide"];
    return (names[index] || "Button") + " [" + index + "]";
  };

  sim.createButtonSettings = function (suppliedStorage) {
    const storageKey = "movesim.buttons.v1";
    let settings = { version: 1, mapping: { clock: 5, clear: 9, send: 7, bump: 4, speed0: 0, speed1: 1, speed2: 2, speed3: 3 }, speedsdmmPerSecond: [10, 100, 500, 1000], selectedSpeed: 2 };
    let storage;
    let notice = "";
    function copy(value) { return JSON.parse(JSON.stringify(value)); }
    function persist() {
      try {
        if (!storage) throw new Error("Browser storage unavailable");
        storage.setItem(storageKey, JSON.stringify(settings));
        notice = "";
      } catch (_) { notice = "Button settings are kept in this tab only; browser storage is unavailable."; }
    }
    try {
      storage = suppliedStorage === undefined ? window.localStorage : suppliedStorage;
      if (!storage) throw new Error("Browser storage unavailable");
      const saved = storage.getItem(storageKey);
      if (saved !== null) {
        const loaded = JSON.parse(saved);
        if (!loaded || loaded.version !== 1) throw new Error("Unknown button settings format");
        actions.forEach(function (action) {
          const value = loaded.mapping && loaded.mapping[action];
          if (value === null || (Number.isInteger(value) && value >= 0 && value <= 127)) settings.mapping[action] = value;
          // Stick clicks now belong to the display mode and cannot also run a
          // configurable action. Retain all unrelated saved assignments.
          if (settings.mapping[action] === 10 || settings.mapping[action] === 11) {
            settings.mapping[action] = null;
            notice = "L3 / R3 are reserved for wheel mode. Their previous action is now unassigned.";
          }
        });
        // Add the new default without taking Start/Menu away from an action the
        // operator already assigned before Clear & home existed in the mapping.
        if ((!loaded.mapping || loaded.mapping.clear === undefined) && actions.some(function (action) { return action !== "clear" && settings.mapping[action] === 9; })) settings.mapping.clear = null;
        // Upgrade the modifier without taking L1 from an existing user mapping.
        if ((!loaded.mapping || loaded.mapping.bump === undefined) && actions.some(function (action) { return action !== "bump" && settings.mapping[action] === 4; })) settings.mapping.bump = null;
        const assigned = new Set();
        actions.forEach(function (action) {
          const index = settings.mapping[action];
          if (index === null) return;
          if (assigned.has(index)) settings.mapping[action] = null;
          else assigned.add(index);
        });
        if (Array.isArray(loaded.speedsdmmPerSecond)) loaded.speedsdmmPerSecond.slice(0, 4).forEach(function (value, index) {
          if (Number.isInteger(value) && value >= 1 && value <= 10000) settings.speedsdmmPerSecond[index] = value;
        });
        if (Number.isInteger(loaded.selectedSpeed) && loaded.selectedSpeed >= 0 && loaded.selectedSpeed < 4) settings.selectedSpeed = loaded.selectedSpeed;
      }
    } catch (_) {
      notice = storage ? "Some saved button settings could not be read." : "Button settings are kept in this tab only; browser storage is unavailable.";
    }
    return {
      storageKey,
      get: function () { return copy(settings); },
      notice: function () { return notice; },
      assign: function (action, button) {
        if (!actions.includes(action) || !Number.isInteger(button) || button < 0 || button > 127) throw new Error("Choose a valid action and button.");
        if (button === 10 || button === 11) throw new Error("L3 / R3 are fixed stick / finger wheel toggles.");
        // One physical button owns one action. Reassignment gives it to the most
        // recently selected action and visibly leaves the previous action unassigned.
        actions.forEach(function (name) { if (settings.mapping[name] === button) settings.mapping[name] = null; });
        settings.mapping[action] = button;
        persist();
      },
      setSpeed: function (slot, speeddmmPerSecond) {
        if (!Number.isInteger(slot) || slot < 0 || slot > 3 || !Number.isInteger(speeddmmPerSecond) || speeddmmPerSecond < 1 || speeddmmPerSecond > 10000) throw new Error("Choose a speed from 0.1 to 1000 mm/s.");
        settings.speedsdmmPerSecond[slot] = speeddmmPerSecond;
        persist();
      },
      selectSpeed: function (slot) {
        if (!Number.isInteger(slot) || slot < 0 || slot > 3) throw new Error("Choose a speed slot.");
        settings.selectedSpeed = slot;
        persist();
      }
    };
  };

  sim.createButtonControls = function (options) {
    const element = function (id) { return document.getElementById(id); };
    const preferences = sim.createButtonSettings(options.storage);
    let settings = preferences.get();
    let latchedSend = false;
    let heldSend = false;
    let latchedBump = false;
    let heldBump = false;
    let learningAction = null;
    let previousButtons = null;
    let previousDevice = null;
    let learningNotice = assignmentHelp;

    function sending() { return latchedSend || heldSend; }
    function speed() { return settings.speedsdmmPerSecond[settings.selectedSpeed]; }
    function fineBump() { return latchedBump || heldBump; }
    function renderBump() {
      const button = element("dpad-bump-button");
      button.textContent = fineBump() ? "D-pad: 0.1 mm" : "D-pad: move";
      button.classList.toggle("active", fineBump());
      button.setAttribute("aria-pressed", String(fineBump()));
      const modifierHint = settings.mapping.bump === null ? "Assign a held modifier in Button settings." : "Or hold " + sim.gamepadButtonName(settings.mapping.bump) + ".";
      button.title = "Click to toggle 0.1 mm per D-pad press. " + modifierHint + " Release the D-pad before another bump.";
    }
    function setHeldBump(value) {
      const before = fineBump();
      heldBump = value;
      renderBump();
      if (before !== fineBump()) notify();
    }
    function notify() { options.onChange(); }
    function renderSend() {
      const button = element("send-button");
      button.textContent = sending() ? "Send" : "Don't send";
      button.classList.toggle("active", sending());
      button.setAttribute("aria-pressed", String(sending()));
      button.title = heldSend ? "Model run signal is active while the controller deadman is held. Click to change the screen latch." : "Click to signal model run/stop. The clock is independent.";
    }
    function renderSettings() {
      const select = element("speed-select");
      select.replaceChildren();
      settings.speedsdmmPerSecond.forEach(function (value, index) {
        const option = document.createElement("option");
        option.value = String(index);
        option.textContent = value / 10 + " mm/s";
        select.append(option);
        const field = element("speed-slot-" + index);
        if (document.activeElement !== field) field.value = String(value / 10);
      });
      select.value = String(settings.selectedSpeed);
      const list = element("button-mappings");
      list.replaceChildren();
      actions.forEach(function (action) {
        // Show the assignment at the point where the operator chooses an action.
        const option = element("button-action").querySelector('option[value="' + action + '"]');
        option.textContent = actionNames[action] + " — " + sim.gamepadButtonName(settings.mapping[action]);
        const row = document.createElement("div");
        const name = document.createElement("span");
        const assigned = document.createElement("span");
        name.textContent = actionNames[action];
        assigned.textContent = sim.gamepadButtonName(settings.mapping[action]);
        row.append(name, assigned);
        list.append(row);
      });
      element("button-settings-status").textContent = learningNotice + (preferences.notice() ? " " + preferences.notice() : "");
      renderSend();
      renderBump();
    }
    function setHeld(value) {
      if (heldSend === value) return;
      const wasSending = sending();
      heldSend = value;
      renderSend();
      if (wasSending !== sending()) notify();
    }
    function selectSpeed(slot) {
      preferences.selectSpeed(slot);
      settings = preferences.get();
      renderSettings();
      options.onActivity();
      notify();
    }
    element("send-button").addEventListener("click", function () {
      const wasSending = sending();
      latchedSend = !latchedSend;
      renderSend();
      if (wasSending !== sending()) notify();
    });
    element("speed-select").addEventListener("change", function (event) { selectSpeed(Number(event.target.value)); });
    element("dpad-bump-button").addEventListener("click", function () {
      const before = fineBump();
      latchedBump = !latchedBump;
      renderBump();
      options.onActivity();
      if (before !== fineBump()) notify();
    });
    element("button-action").addEventListener("change", function (event) {
      learningAction = actions.includes(event.target.value) ? event.target.value : null;
      learningNotice = learningAction ? "Press buttons to assign " + actionNames[learningAction] + ". Each press replaces its assignment without running it." : assignmentHelp;
      if (learningAction) { setHeld(false); setHeldBump(false); }
      renderSettings();
    });
    element("button-controls").addEventListener("toggle", function (event) {
      if (event.target.open) {
        // Wait for expansion to set the new height, then bring the controls at
        // the bottom into view through the Input panel or the page on narrow screens.
        requestAnimationFrame(function () {
          if (event.target.open) event.target.scrollIntoView({ block: "end", behavior: "smooth" });
        });
      } else {
        learningAction = null;
        element("button-action").value = "";
        learningNotice = assignmentHelp;
        renderSettings();
      }
    });
    for (let slot = 0; slot < 4; slot++) {
      const field = element("speed-slot-" + slot);
      function changed() {
        if (!field.checkValidity() || !Number.isFinite(field.valueAsNumber)) return;
        const wasSpeed = speed();
        preferences.setSpeed(slot, Math.round(field.valueAsNumber * 10));
        settings = preferences.get();
        renderSettings();
        if (wasSpeed !== speed()) notify();
      }
      field.addEventListener("input", changed);
      field.addEventListener("change", changed);
    }

    renderSettings();
    return {
      preferences,
      isSending: sending,
      isFineBump: fineBump,
      isAssigning: function () { return learningAction !== null; },
      speed,
      hasHeldInput: function () { return Boolean(previousButtons && previousButtons.some(Boolean)); },
      releaseDevice: function () { previousButtons = null; previousDevice = null; setHeld(false); setHeldBump(false); },
      resetSending: function () { latchedSend = false; heldSend = false; latchedBump = false; renderSend(); renderBump(); },
      poll: function (device) {
        if (!device) { this.releaseDevice(); return; }
        const pressed = Array.from(device.buttons, function (button) { return Boolean(button.pressed); });
        const identity = device.id + ":" + device.index;
        // Browsers may hide a controller until its first button press after load.
        // Count the first Clock, Send, Fine or stick-click press instead of
        // consuming it as already held. Other buttons retain their initial baseline.
        if (!previousButtons || previousDevice !== identity) {
          previousButtons = pressed.map(function (value, index) {
            return learningAction || index === settings.mapping.clock || index === settings.mapping.send || index === settings.mapping.bump || index === 10 || index === 11 ? false : value;
          });
          previousDevice = identity;
          setHeld(false);
        }
        const rising = pressed.map(function (value, index) { return value && !previousButtons[index]; });
        if (rising.some(Boolean)) options.onActivity();
        if (learningAction) {
          setHeld(false);
          setHeldBump(false);
          if (!rising.some(Boolean)) { previousButtons = pressed; return; }
          const index = rising.findIndex(Boolean);
          if (index === 10 || index === 11) {
            learningNotice = "L3 / R3 are fixed stick / finger wheel toggles. Press a different button for this action.";
            previousButtons = pressed;
            renderSettings();
            return;
          }
          preferences.assign(learningAction, index);
          learningNotice = actionNames[learningAction] + " assigned to " + sim.gamepadButtonName(index) + ". Press another button to replace it.";
          settings = preferences.get();
          previousButtons = pressed;
          renderSettings();
          return;
        }
        [10, 11].forEach(function (button, index) {
          if (rising[button]) options.onStickClick(index);
        });
        const bumpIndex = settings.mapping.bump;
        setHeldBump(bumpIndex !== null && Boolean(pressed[bumpIndex]) && (heldBump || rising[bumpIndex]));
        const sendIndex = settings.mapping.send;
        setHeld(sendIndex !== null && Boolean(pressed[sendIndex]) && (heldSend || rising[sendIndex]));
        if (settings.mapping.clock !== null && rising[settings.mapping.clock]) options.onClock();
        if (settings.mapping.clear !== null && rising[settings.mapping.clear]) options.onClear();
        for (let slot = 0; slot < 4; slot++) {
          const index = settings.mapping["speed" + slot];
          if (index !== null && rising[index]) selectSpeed(slot);
        }
        previousButtons = pressed;
      }
    };
  };
})(window.MoveSim);
