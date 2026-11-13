"use strict";
(function (sim) {
  sim.bindDynoPanel = function (model) {
    const get = function (id) { return document.getElementById("dyno-" + id); };
    get("connect").onclick = function () {
      if (model.connected || model.status === "Connecting") model.disconnect();
      else model.connect(get("address").value);
    };
    get("init").onclick = model.init;
    get("test").onclick = function () { model.sendTest(Number(get("feedrate").value)); };
    get("visible").onchange = function (event) { model.visible = event.target.checked; };
    let lastSummary = "";
    const us = function (value) { return value === null || value === undefined ? "pending" : sim.formatGroupedNumber(value, 1) + " µs"; };
    return function () {
      get("connect").textContent = model.connected || model.status === "Connecting" ? "Disconnect" : "Connect";
      get("address").disabled = model.connected || model.status === "Connecting";
      get("init").disabled = !model.connected || model.isBusy();
      get("test").disabled = !model.ready || model.isBusy() || !get("feedrate").checkValidity();
      get("state").textContent = model.status;
      get("record-count").textContent = model.points.length + " points / " + model.records.length + " events";
      const test = model.tests[model.tests.length - 1];
      let summary = "Init: G91 → M114\nTest: G0 X1 F6000\nIndependent of the local clock. X only; logged Y=0.";
      if (test) {
        const first = test.firstPulse, last = test.lastPulse;
        const intervals = test.pulses.slice(1).map(function (pulse, index) { return (pulse.simNs - test.pulses[index].simNs) / 1000; });
        summary = "#" + model.tests.length + "  X " + test.startX.toFixed(4) + " → " + test.targetX.toFixed(4) + " mm  F" + test.feedrate + "\n" +
          "Send → OK       " + us(test.okUs) + "\nSend → first X  " + us(test.startUs) + "\nSend → target X " + us(test.arrivalUs) + "\n" +
          "X pulses        " + test.pulseCount + (first && last ? "  ΔX " + (last.loggedX - test.startX).toFixed(4) + " mm" : "") + "\n" +
          "First / last ns " + (first ? sim.formatGroupedNumber(first.simNs) : "pending") + " / " + (last ? sim.formatGroupedNumber(last.simNs) : "pending") + "\n" +
          "Pulse span      " + us(first && last ? (last.simNs - first.simNs) / 1000 : null) + " (Dyno sim)\n" +
          "Pulse interval  " + (intervals.length ? us(Math.min.apply(null, intervals)) + " … " + us(Math.max.apply(null, intervals)) : "pending") + "\n" +
          "Direction       " + (first ? (first.loggedX >= test.startX ? "+X" : "−X") : "pending");
        if (test.submitted && first) summary += "\nSubmit → first  " + us((first.simNs - test.submitted.simNs) / 1000) + " (Dyno sim)";
        if (test.submitted && test.arrival) summary += "\nSubmit → target " + us((test.arrival.simNs - test.submitted.simNs) / 1000) + " (Dyno sim)";
        if (test.incomplete) summary += "\nIncomplete: " + test.incomplete;
        summary += "\nSend timings include transport and browser delivery.";
      }
      if (summary !== lastSummary) { get("results").textContent = summary; lastSummary = summary; }
    };
  };
})(window.MoveSim);
