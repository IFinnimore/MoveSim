"use strict";
(function (sim) {
  // Keep display rotation independent of encoder pulses. The input subsystem
  // decides which angular changes count as permitted motion for the models.
  sim.createFingerWheel = function () {
    const state = { enabled: false, angleRadians: 0 };
    let referenceAngle = null;
    let lastX = 0;
    let lastY = 0;
    function activeAngle(x, y) {
      return Math.hypot(x, y) > 0.75 ? Math.atan2(y, x) : null;
    }
    return {
      state,
      toggle: function () {
        state.enabled = !state.enabled;
        // Enter wheel mode at the current stick position without an initial jump.
        referenceAngle = state.enabled ? activeAngle(lastX, lastY) : null;
      },
      update: function (x, y) {
        lastX = x;
        lastY = y;
        if (!state.enabled) return 0;
        const nextAngle = activeAngle(x, y);
        let delta = 0;
        if (nextAngle !== null && referenceAngle !== null) {
          const change = nextAngle - referenceAngle;
          // Use the short angular step across the +/-180 degree seam. Neutral
          // breaks the reference so repositioning a thumb does not turn the wheel.
          delta = Math.atan2(Math.sin(change), Math.cos(change));
          state.angleRadians += delta;
        }
        referenceAngle = nextAngle;
        return delta;
      },
      release: function () { referenceAngle = null; lastX = lastY = 0; },
      home: function () { state.angleRadians = 0; referenceAngle = null; lastX = lastY = 0; }
    };
  };

  sim.createFingerWheelView = function (container, identifier) {
    const wheel = sim.createFingerWheel();
    const namespace = "http://www.w3.org/2000/svg";
    function shape(name, attributes, parent) {
      const node = document.createElementNS(namespace, name);
      Object.keys(attributes).forEach(function (key) { node.setAttribute(key, attributes[key]); });
      parent.append(node);
      return node;
    }
    // Native SVG keeps the scallops and zero divider sharp in the same footprint
    // as the joystick, without adding image assets or a build dependency.
    const svg = shape("svg", { viewBox: "0 0 130 130", class: "finger-wheel", "aria-hidden": "true" }, container);
    const definitions = shape("defs", {}, svg);
    const mask = shape("mask", { id: identifier + "-scallops", maskUnits: "userSpaceOnUse", x: 0, y: 0, width: 130, height: 130 }, definitions);
    shape("circle", { cx: 65, cy: 65, r: 64, fill: "white" }, mask);
    for (let notch = 0; notch < 12; notch++) {
      const angle = (-105 + notch * 30) * Math.PI / 180;
      shape("circle", { cx: 65 + 64 * Math.cos(angle), cy: 65 + 64 * Math.sin(angle), r: 12.5, fill: "black" }, mask);
    }
    const rotor = shape("g", {}, svg);
    const body = shape("g", { mask: "url(#" + identifier + "-scallops)" }, rotor);
    shape("circle", { cx: 65, cy: 65, r: 64, fill: "#276fab" }, body);
    for (let divider = 0; divider < 12; divider++) {
      const angle = (-90 + divider * 30) * Math.PI / 180;
      shape("line", {
        x1: 65 + 43 * Math.cos(angle), y1: 65 + 43 * Math.sin(angle),
        x2: 65 + 63 * Math.cos(angle), y2: 65 + 63 * Math.sin(angle),
        stroke: divider === 0 ? "#ffbf69" : "#123e63", "stroke-width": divider === 0 ? 3.5 : 1.5
      }, body);
    }
    const zero = shape("text", { x: 65, y: 34, fill: "#ffdbab", "text-anchor": "middle", "font-size": 13, "font-family": "Consolas, monospace" }, body);
    zero.textContent = "0";
    shape("circle", { cx: 65, cy: 65, r: 7, fill: "#16446b", stroke: "#539bd2", "stroke-width": 1 }, body);
    function render() {
      container.classList.toggle("wheel-mode", wheel.state.enabled);
      // Input uses Y up; SVG rotation uses Y down.
      rotor.setAttribute("transform", "rotate(" + (-wheel.state.angleRadians * 180 / Math.PI % 360) + " 65 65)");
    }
    return {
      state: wheel.state,
      toggle: function () { wheel.toggle(); render(); },
      update: function (x, y) { const delta = wheel.update(x, y); render(); return delta; },
      release: wheel.release,
      home: function () { wheel.home(); render(); }
    };
  };
})(window.MoveSim);
