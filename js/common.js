/* MoveSim uses one small namespace so these files work without a build or web server. */
"use strict";
window.MoveSim = window.MoveSim || {};
(function (sim) {
  sim.areaSizedmm = 4000;
  sim.centrePositiondmm = 2000;
  sim.colours = { green: "#66f7ac", blue: "#62baff", amber: "#ffbf69" };

  // Explicit grouping keeps timing scale points consistent across browser locales.
  sim.formatGroupedNumber = function (value, decimalPlaces) {
    const digits = decimalPlaces === undefined ? 0 : decimalPlaces;
    return value.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  };

  sim.clamp = function (value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  };

  sim.formatTime = function (timeMs) {
    const wholeMs = Math.max(0, Math.floor(timeMs));
    const minutes = Math.floor(wholeMs / 60000);
    const seconds = Math.floor(wholeMs / 1000) % 60;
    return String(minutes).padStart(2, "0") + ":" + String(seconds).padStart(2, "0") + "." + String(wholeMs % 1000).padStart(3, "0");
  };

  // All histories are ordered. This also gives future models a common playback lookup.
  sim.findAtTime = function (history, timeMs, timeField) {
    const field = timeField || "timeMs";
    let lower = 0;
    let upper = history.length;
    while (lower < upper) {
      const middle = Math.floor((lower + upper) / 2);
      if (history[middle][field] <= timeMs) lower = middle + 1;
      else upper = middle;
    }
    return Math.max(0, lower - 1);
  };

  // A thin trace can cross a gate between recorded endpoints. Test the whole segment.
  // Touching a gate edge counts as an intersection.
  sim.segmentIntersectsSquare = function (start, end, square) {
    let entry = 0;
    let exit = 1;
    for (const axis of ["X", "Y"]) {
      const field = "position" + axis + "dmm";
      const delta = end[field] - start[field];
      const minimum = square[field];
      const maximum = minimum + square.sizedmm;
      if (Math.abs(delta) < 1e-12) {
        if (start[field] < minimum || start[field] > maximum) return false;
      } else {
        const first = (minimum - start[field]) / delta;
        const second = (maximum - start[field]) / delta;
        entry = Math.max(entry, Math.min(first, second));
        exit = Math.min(exit, Math.max(first, second));
        if (entry > exit) return false;
      }
    }
    return true;
  };

  // Canvas dimensions use CSS pixels; the backing buffer follows the display density.
  sim.prepareCanvas = function (canvas) {
    const bounds = canvas.getBoundingClientRect();
    const width = Math.max(1, bounds.width);
    const height = Math.max(1, bounds.height);
    const density = window.devicePixelRatio || 1;
    const bufferWidth = Math.round(width * density);
    const bufferHeight = Math.round(height * density);
    if (canvas.width !== bufferWidth || canvas.height !== bufferHeight) {
      canvas.width = bufferWidth;
      canvas.height = bufferHeight;
    }
    const context = canvas.getContext("2d");
    context.setTransform(density, 0, 0, density, 0, 0);
    return { context, width, height };
  };
})(window.MoveSim);
