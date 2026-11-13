"use strict";
(function (sim) {
  sim.createVelocityChart = function (canvas, onInspect, onMessage) {
    let startMs = 0;
    let spanMs = 5000;
    let fitToSimulation = true;
    let totalTimeMs = 0;
    let width = 1;
    let height = 1;
    let drag = null;
    let messages = [];
    const left = 57;
    const right = 19;
    const top = 35;
    const bottom = 25;

    function plotWidth() { return Math.max(1, width - left - right); }
    function timeAt(screenX) { return sim.clamp(startMs + (screenX - left) / plotWidth() * spanMs, 0, totalTimeMs); }
    function screenX(timeMs) { return left + (timeMs - startMs) / spanMs * plotWidth(); }
    // Keep the time below the pointer fixed while changing how much history is shown.
    function zoom(factor, fraction) {
      fitToSimulation = false;
      const anchor = startMs + spanMs * fraction;
      spanMs = sim.clamp(spanMs / factor, 20, Math.max(5000, totalTimeMs * 4));
      startMs = Math.max(0, anchor - spanMs * fraction);
    }
    canvas.addEventListener("wheel", function (event) {
      event.preventDefault();
      const bounds = canvas.getBoundingClientRect();
      zoom(Math.exp(-event.deltaY * 0.0015), sim.clamp((event.clientX - bounds.left - left) / plotWidth(), 0, 1));
    }, { passive: false });
    canvas.addEventListener("pointerdown", function (event) {
      if (event.button !== 0 || drag) return;
      const bounds = canvas.getBoundingClientRect();
      drag = { pointerId: event.pointerId, x: event.clientX, localX: event.clientX - bounds.left, localY: event.clientY - bounds.top, startMs, pan: event.shiftKey, moved: false };
      canvas.setPointerCapture(event.pointerId);
    });
    canvas.addEventListener("pointermove", function (event) {
      if (!drag || drag.pointerId !== event.pointerId) return;
      if (Math.abs(event.clientX - drag.x) > 3) drag.moved = true;
      if (drag.pan) {
        fitToSimulation = false;
        startMs = sim.clamp(drag.startMs - (event.clientX - drag.x) / plotWidth() * spanMs, 0, Math.max(0, totalTimeMs - spanMs * 0.1));
      } else if (drag.moved) onInspect(timeAt(event.clientX - canvas.getBoundingClientRect().left));
    });
    canvas.addEventListener("pointerup", function (event) {
      if (!drag || drag.pointerId !== event.pointerId) return;
      if (!drag.pan && !drag.moved) {
        // Only the message marker lane selects messages. Clicking a velocity trace
        // inspects the requested time even when there are many nearby messages.
        let nearest = null;
        let distance = 7;
        if (drag.localY >= 17 && drag.localY <= 31) messages.forEach(function (message) {
          if (message.receivedTimeMs === null) return;
          const currentDistance = Math.abs(screenX(message.receivedTimeMs) - drag.localX);
          if (currentDistance < distance) { distance = currentDistance; nearest = message; }
        });
        if (nearest) onMessage(nearest); else onInspect(timeAt(drag.localX));
      }
      drag = null;
    });
    ["pointercancel", "lostpointercapture"].forEach(function (name) { canvas.addEventListener(name, function () { drag = null; }); });

    return {
      fit: function () { fitToSimulation = true; startMs = 0; },
      zoom: function (factor) { zoom(factor, 0.5); },
      draw: function (models, inputHistory, messageEntries, elapsedTimeMs, inspectionTimeMs, selectedMessageId) {
        const prepared = sim.prepareCanvas(canvas);
        const context = prepared.context;
        width = prepared.width;
        height = prepared.height;
        totalTimeMs = elapsedTimeMs;
        messages = messageEntries.filter(function (message) { return models.some(function (model) { return model.visible && model.id === message.modelId; }); });
        if (fitToSimulation) { startMs = 0; spanMs = Math.max(1000, elapsedTimeMs * 1.03); }
        context.clearRect(0, 0, width, height);
        // Both axes and every visible model share one scale so speeds can be compared.
        const plotHeight = Math.max(1, height - top - bottom);
        const centreY = top + plotHeight / 2;
        let maximumVelocity = 10;
        models.filter(function (model) { return model.visible; }).forEach(function (model) {
          const current = model.stateAt(elapsedTimeMs);
          maximumVelocity = Math.max(maximumVelocity, Math.abs(current.velocityXdmmPerSecond) / 10, Math.abs(current.velocityYdmmPerSecond) / 10);
          model.velocityHistory.forEach(function (point) {
            if (point.timeMs <= elapsedTimeMs) maximumVelocity = Math.max(maximumVelocity, Math.abs(point.velocityXdmmPerSecond) / 10, Math.abs(point.velocityYdmmPerSecond) / 10);
          });
        });
        maximumVelocity = Math.ceil(maximumVelocity / 10) * 10;
        const screenY = function (velocitydmmPerSecond) { return centreY - velocitydmmPerSecond / 10 / maximumVelocity * plotHeight * 0.43; };
        context.font = "12px Consolas, monospace";
        context.fillStyle = "#90a7b1";
        context.fillText("mm/s", 9, 16);
        for (const velocity of [-maximumVelocity, 0, maximumVelocity]) {
          const y = screenY(velocity * 10);
          context.strokeStyle = velocity === 0 ? "#3c505b" : "#23323b";
          context.beginPath(); context.moveTo(left, y); context.lineTo(width - right, y); context.stroke();
          context.fillStyle = "#849da8";
          context.fillText(String(velocity), 9, y + 4);
        }
        // Labels follow the visible time range rather than the model's sampling rate.
        const wantedStep = spanMs / Math.max(2, Math.floor(plotWidth() / 90));
        const magnitude = Math.pow(10, Math.floor(Math.log10(Math.max(1, wantedStep))));
        const stepMs = [1, 2, 5, 10].map(function (value) { return value * magnitude; }).find(function (value) { return value >= wantedStep; }) || magnitude * 10;
        for (let timeMs = Math.ceil(startMs / stepMs) * stepMs; timeMs <= startMs + spanMs; timeMs += stepMs) {
          const x = screenX(timeMs);
          context.strokeStyle = "#23323b";
          context.beginPath(); context.moveTo(x, top); context.lineTo(x, height - bottom); context.stroke();
          context.fillStyle = "#849da8";
          context.fillText((timeMs / 1000).toFixed(stepMs < 1000 ? (stepMs < 100 ? 2 : 1) : 0) + " s", x + 3, height - 8);
        }

        context.save(); context.beginPath(); context.rect(left, 0, plotWidth(), height - bottom + 1); context.clip();
        // Input and message events have separate lanes above the velocity plot.
        context.strokeStyle = sim.colours.amber;
        inputHistory.forEach(function (input) {
          if (input.timeMs > elapsedTimeMs) return;
          const x = screenX(input.timeMs);
          context.beginPath(); context.moveTo(x, 4); context.lineTo(x, 13); context.stroke();
        });
        messages.forEach(function (message) {
          if (message.receivedTimeMs === null || message.receivedTimeMs > elapsedTimeMs) return;
          context.strokeStyle = message.id === selectedMessageId ? "#e2f3ff" : "#62baff70";
          const x = screenX(message.receivedTimeMs);
          context.beginPath(); context.moveTo(x, 20); context.lineTo(x, 28); context.stroke();
        });
        // Use recorded acceleration to draw ramps between events. Zero acceleration
        // naturally retains the steps of the instant-response reference model.
        models.filter(function (model) { return model.visible; }).forEach(function (model) {
          for (const axis of ["X", "Y"]) {
            const field = "velocity" + axis + "dmmPerSecond";
            const history = model.velocityHistory;
            const startIndex = sim.findAtTime(history, startMs);
            context.strokeStyle = model.colour;
            context.lineWidth = axis === "X" ? 1.7 : 1.2;
            context.setLineDash(axis === "Y" ? [5, 4] : []);
            context.beginPath();
            let previous = history[startIndex];
            const accelerationField = "acceleration" + axis + "dmmPerSecondSquared";
            const velocityAt = function (point, timeMs) { return point[field] + (point[accelerationField] || 0) * (timeMs - point.timeMs) / 1000; };
            context.moveTo(screenX(Math.max(startMs, previous.timeMs)), screenY(velocityAt(previous, Math.max(startMs, previous.timeMs))));
            for (let index = startIndex + 1; index < history.length; index++) {
              const point = history[index];
              if (point.timeMs > startMs + spanMs) break;
              context.lineTo(screenX(point.timeMs), screenY(velocityAt(previous, point.timeMs)));
              context.lineTo(screenX(point.timeMs), screenY(point[field]));
              previous = point;
            }
            const endTimeMs = Math.min(elapsedTimeMs, startMs + spanMs);
            context.lineTo(screenX(endTimeMs), screenY(velocityAt(previous, endTimeMs)));
            context.stroke(); context.setLineDash([]);
          }
        });
        const cursorX = screenX(inspectionTimeMs);
        context.strokeStyle = "#d6e6e8";
        context.lineWidth = 1;
        context.beginPath(); context.moveTo(cursorX, 0); context.lineTo(cursorX, height - bottom); context.stroke();
        context.restore();
      }
    };
  };
})(window.MoveSim);
