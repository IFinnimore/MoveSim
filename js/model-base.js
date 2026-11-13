"use strict";
(function (sim) {
  sim.createModelBase = function (options) {
    // This is the shared recording and motion service, not a required class hierarchy.
    // A model owns its scheduling policy and calls these functions at simulation events.
    const model = {
      id: options.id,
      name: options.name,
      colour: options.colour || sim.colours.green,
      visible: true,
      machineSettings: options.machineSettings || null,
      points: [],
      velocityHistory: [],
      history: [],
      latestTimeMs: 0
    };
    let state;

    function saveState() {
      const saved = Object.assign({}, state);
      const point = {
        timeMs: state.timeMs,
        positionXdmm: Math.round(state.positionXdmm),
        positionYdmm: Math.round(state.positionYdmm)
      };
      const last = model.history[model.history.length - 1];
      if (last && last.timeMs === state.timeMs) {
        model.history[model.history.length - 1] = saved;
        model.points[model.points.length - 1] = point;
      } else {
        model.history.push(saved);
        model.points.push(point);
      }
      const velocity = {
        timeMs: state.timeMs,
        velocityXdmmPerSecond: state.velocityXdmmPerSecond,
        velocityYdmmPerSecond: state.velocityYdmmPerSecond,
        accelerationXdmmPerSecondSquared: state.accelerationXdmmPerSecondSquared,
        accelerationYdmmPerSecondSquared: state.accelerationYdmmPerSecondSquared
      };
      const previous = model.velocityHistory[model.velocityHistory.length - 1];
      if (previous && previous.timeMs === state.timeMs) model.velocityHistory[model.velocityHistory.length - 1] = velocity;
      else if (!previous || previous.velocityXdmmPerSecond !== velocity.velocityXdmmPerSecond || previous.velocityYdmmPerSecond !== velocity.velocityYdmmPerSecond || previous.accelerationXdmmPerSecondSquared !== velocity.accelerationXdmmPerSecondSquared || previous.accelerationYdmmPerSecondSquared !== velocity.accelerationYdmmPerSecondSquared) model.velocityHistory.push(velocity);
    }

    model.resetMotion = function () {
      model.points.length = 0;
      model.history.length = 0;
      model.velocityHistory.length = 0;
      model.latestTimeMs = 0;
      state = {
        timeMs: 0,
        positionXdmm: sim.centrePositiondmm,
        positionYdmm: sim.centrePositiondmm,
        velocityXdmmPerSecond: 0,
        velocityYdmmPerSecond: 0,
        accelerationXdmmPerSecondSquared: 0,
        accelerationYdmmPerSecondSquared: 0
      };
      saveState();
    };

    // Fractional travel is retained internally. Rounding each short move would lose
    // slow motion; only the public point array and coordinate readouts are rounded.
    model.advanceMotionTo = function (timeMs) {
      if (timeMs < state.timeMs) throw new Error("Model time cannot move backwards.");
      const durationSeconds = (timeMs - state.timeMs) / 1000;
      state.positionXdmm = sim.clamp(state.positionXdmm + state.velocityXdmmPerSecond * durationSeconds + state.accelerationXdmmPerSecondSquared * durationSeconds * durationSeconds / 2, 0, sim.areaSizedmm);
      state.positionYdmm = sim.clamp(state.positionYdmm + state.velocityYdmmPerSecond * durationSeconds + state.accelerationYdmmPerSecondSquared * durationSeconds * durationSeconds / 2, 0, sim.areaSizedmm);
      state.velocityXdmmPerSecond += state.accelerationXdmmPerSecondSquared * durationSeconds;
      state.velocityYdmmPerSecond += state.accelerationYdmmPerSecondSquared * durationSeconds;
      state.timeMs = timeMs;
      saveState();
    };

    model.setVelocity = function (velocityXdmmPerSecond, velocityYdmmPerSecond) {
      // Stop only movement into the wall. Movement along the wall can continue.
      function allowedVelocity(positiondmm, velocitydmmPerSecond) {
        if (positiondmm <= 1e-8 && velocitydmmPerSecond < 0) return 0;
        if (positiondmm >= sim.areaSizedmm - 1e-8 && velocitydmmPerSecond > 0) return 0;
        return velocitydmmPerSecond;
      }
      state.velocityXdmmPerSecond = allowedVelocity(state.positionXdmm, velocityXdmmPerSecond);
      state.velocityYdmmPerSecond = allowedVelocity(state.positionYdmm, velocityYdmmPerSecond);
      saveState();
    };

    model.setAcceleration = function (accelerationXdmmPerSecondSquared, accelerationYdmmPerSecondSquared) {
      state.accelerationXdmmPerSecondSquared = accelerationXdmmPerSecondSquared;
      state.accelerationYdmmPerSecondSquared = accelerationYdmmPerSecondSquared;
      saveState();
    };

    model.nextBoundaryTime = function () {
      function timeToWall(positiondmm, velocitydmmPerSecond) {
        if (!velocitydmmPerSecond) return Infinity;
        const destinationdmm = velocitydmmPerSecond > 0 ? sim.areaSizedmm : 0;
        return state.timeMs + Math.max(0, (destinationdmm - positiondmm) / velocitydmmPerSecond * 1000);
      }
      return Math.min(timeToWall(state.positionXdmm, state.velocityXdmmPerSecond), timeToWall(state.positionYdmm, state.velocityYdmmPerSecond));
    };

    model.stopAtBoundary = function () {
      // Floating-point time calculations may land a tiny fraction short of the wall.
      for (const axis of ["X", "Y"]) {
        const positionField = "position" + axis + "dmm";
        if (state[positionField] < 1e-7) state[positionField] = 0;
        if (state[positionField] > sim.areaSizedmm - 1e-7) state[positionField] = sim.areaSizedmm;
      }
      model.setVelocity(state.velocityXdmmPerSecond, state.velocityYdmmPerSecond);
    };

    model.stateAt = function (timeMs) {
      const saved = model.history[sim.findAtTime(model.history, timeMs)];
      const durationSeconds = Math.max(0, timeMs - saved.timeMs) / 1000;
      return {
        timeMs,
        positionXdmm: sim.clamp(saved.positionXdmm + saved.velocityXdmmPerSecond * durationSeconds + saved.accelerationXdmmPerSecondSquared * durationSeconds * durationSeconds / 2, 0, sim.areaSizedmm),
        positionYdmm: sim.clamp(saved.positionYdmm + saved.velocityYdmmPerSecond * durationSeconds + saved.accelerationYdmmPerSecondSquared * durationSeconds * durationSeconds / 2, 0, sim.areaSizedmm),
        velocityXdmmPerSecond: saved.velocityXdmmPerSecond + saved.accelerationXdmmPerSecondSquared * durationSeconds,
        velocityYdmmPerSecond: saved.velocityYdmmPerSecond + saved.accelerationYdmmPerSecondSquared * durationSeconds,
        accelerationXdmmPerSecondSquared: saved.accelerationXdmmPerSecondSquared,
        accelerationYdmmPerSecondSquared: saved.accelerationYdmmPerSecondSquared
      };
    };

    model.resetMotion();
    return model;
  };
})(window.MoveSim);
