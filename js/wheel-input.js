"use strict";
(function (sim) {
  sim.wheelScalesdmm = [1000, 500, 100, 2540, 254];

  // Each logical encoder pulse is 1/100 revolution, or two physical pulses on
  // Ian's 200-pulse wheel. Keep accepted distance separate from display rotation:
  // free play must never become a saved motion request when Send returns.
  sim.createWheelInput = function () {
    const pulseAngle = Math.PI * 2 / 100;
    const remainder = [0, 0];
    const distanceUnits = [0, 0];
    const bumpDistance = [0, 0];
    let scale = 1000;
    let active = false;
    let epoch = 0;
    let startDistance = [0, 0];
    let startBump = [0, 0];
    return {
      setScale: function (distancePerRevolutiondmm) {
        if (!sim.wheelScalesdmm.includes(distancePerRevolutiondmm)) throw new Error("Choose a wheel scale from the list.");
        scale = distancePerRevolutiondmm;
      },
      setActive: function (value) {
        if (active === value) return;
        active = value;
        epoch++;
        startDistance = distanceUnits.slice();
        startBump = bumpDistance.slice();
        remainder.fill(0);
      },
      turn: function (axis, angleRadians) {
        if (!active) { remainder[axis] = 0; return false; }
        // Display angles use Y-up mathematics. Reverse that sign for handwheel
        // travel so clockwise requests positive X (right) or positive Y (up).
        remainder[axis] -= angleRadians;
        const fraction = remainder[axis] / pulseAngle;
        const pulses = Math.trunc(fraction + Math.sign(fraction) * 1e-9);
        if (!pulses) return false;
        remainder[axis] -= pulses * pulseAngle;
        // These private units are hundredths of a dmm. All five scales therefore
        // accumulate as integers, including 0.254 mm per pulse at 25.4 mm/rev.
        distanceUnits[axis] += pulses * scale;
        return true;
      },
      snapshot: function () {
        return { wheelEpoch: epoch, wheelTotalXdmm: distanceUnits[0] / 100, wheelTotalYdmm: distanceUnits[1] / 100,
          wheelStartXdmm: startDistance[0] / 100, wheelStartYdmm: startDistance[1] / 100, wheelRevolutiondmm: scale,
          bumpTotalXdmm: bumpDistance[0], bumpTotalYdmm: bumpDistance[1], bumpStartXdmm: startBump[0], bumpStartYdmm: startBump[1] };
      },
      bump: function (x, y) {
        if (!active || (!x && !y)) return false;
        // One dmm is exactly 0.1 mm. Bumps never depend on the wheel scale.
        bumpDistance[0] += x;
        bumpDistance[1] += y;
        return true;
      },
      clear: function () {
        distanceUnits.fill(0);
        startDistance = [0, 0];
        bumpDistance.fill(0);
        startBump = [0, 0];
        remainder.fill(0);
        epoch++;
      }
    };
  };

  // Reading one model must not consume another model's pulses. Each model owns
  // this small cursor and samples the same cumulative timestamped input history.
  sim.createWheelSampler = function () {
    let previousX = 0;
    let previousY = 0;
    let previousBumpX = 0;
    let previousBumpY = 0;
    let previousEpoch = null;
    let previousTimeMs = 0;
    return {
      sample: function (stream, timeMs) {
        const currentX = stream.wheelTotalXdmm || 0;
        const currentY = stream.wheelTotalYdmm || 0;
        const currentBumpX = stream.bumpTotalXdmm || 0;
        const currentBumpY = stream.bumpTotalYdmm || 0;
        const epoch = stream.wheelEpoch || 0;
        const sameRun = previousEpoch === epoch;
        const durationMs = timeMs - previousTimeMs;
        const deltaXdmm = stream.sendEnabled ? currentX - (sameRun ? previousX : stream.wheelStartXdmm || 0) : 0;
        const deltaYdmm = stream.sendEnabled ? currentY - (sameRun ? previousY : stream.wheelStartYdmm || 0) : 0;
        const bumpDeltaXdmm = stream.sendEnabled ? currentBumpX - (sameRun ? previousBumpX : stream.bumpStartXdmm || 0) : 0;
        const bumpDeltaYdmm = stream.sendEnabled ? currentBumpY - (sameRun ? previousBumpY : stream.bumpStartYdmm || 0) : 0;
        previousX = currentX;
        previousY = currentY;
        previousBumpX = currentBumpX;
        previousBumpY = currentBumpY;
        previousEpoch = epoch;
        previousTimeMs = timeMs;
        return { epoch, durationMs, deltaXdmm, deltaYdmm, bumpDeltaXdmm, bumpDeltaYdmm,
          bumpVelocityXdmmPerSecond: durationMs > 0 ? bumpDeltaXdmm * 1000 / durationMs : 0,
          bumpVelocityYdmmPerSecond: durationMs > 0 ? bumpDeltaYdmm * 1000 / durationMs : 0,
          velocityXdmmPerSecond: durationMs > 0 ? deltaXdmm * 1000 / durationMs : 0,
          velocityYdmmPerSecond: durationMs > 0 ? deltaYdmm * 1000 / durationMs : 0 };
      }
    };
  };
})(window.MoveSim);
