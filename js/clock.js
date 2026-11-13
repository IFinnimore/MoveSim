"use strict";
(function (sim) {
  sim.createActivityTimer = function (timeoutMs, readWallTime) {
    const readTime = readWallTime || function () { return performance.now(); };
    let lastInputAtMs = readTime();

    // Inactivity is about the operator, not recorded velocity or periodic messages.
    // A held direction is still input, even when a wall prevents further movement.
    return {
      noteInput: function () { lastInputAtMs = readTime(); },
      shouldPause: function (hasHeldInput) {
        const timeMs = readTime();
        if (hasHeldInput) lastInputAtMs = timeMs;
        return timeMs - lastInputAtMs >= timeoutMs;
      }
    };
  };

  sim.createClock = function (readWallTime) {
    const readTime = readWallTime || function () { return performance.now(); };
    let savedTimeMs = 0;
    let startedAtMs = readTime();
    // Opening the notebook should not begin a run before the operator chooses Start.
    let running = false;

    // Browser callbacks are opportunities to work, not the clock itself.
    // Pausing preserves simulation time, so resume never catches up paused wall time.
    return {
      now: function () { return Math.floor(savedTimeMs + (running ? readTime() - startedAtMs : 0)); },
      isRunning: function () { return running; },
      pause: function () {
        if (!running) return;
        savedTimeMs = this.now();
        running = false;
      },
      resume: function () {
        if (running) return;
        startedAtMs = readTime();
        running = true;
      },
      clear: function () {
        savedTimeMs = 0;
        startedAtMs = readTime();
      }
    };
  };
})(window.MoveSim);
