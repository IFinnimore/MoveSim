"use strict";
(function (sim) {
  const schema = {
    proportional: { label: "proportional", type: "boolean", defaultValue: true },
    moveDurationMs: { label: "move duration", defaultValue: 100, minimum: 1, maximum: 10000, integer: true }
  };

  // Find a wall crossing within one constant-acceleration phase. Solving both
  // walls also handles a reversal that first moves away from its new target.
  function wallHit(positiondmm, velocitydmmPerSecond, accelerationdmmPerSecondSquared, durationSeconds) {
    if ((positiondmm <= 1e-8 && (velocitydmmPerSecond < 0 || (Math.abs(velocitydmmPerSecond) < 1e-8 && accelerationdmmPerSecondSquared < 0))) ||
        (positiondmm >= sim.areaSizedmm - 1e-8 && (velocitydmmPerSecond > 0 || (Math.abs(velocitydmmPerSecond) < 1e-8 && accelerationdmmPerSecondSquared > 0)))) return { seconds: 0, positiondmm: positiondmm < 1 ? 0 : sim.areaSizedmm };
    let hit = null;
    [0, sim.areaSizedmm].forEach(function (wall) {
      let roots = [];
      if (!accelerationdmmPerSecondSquared) {
        if (velocitydmmPerSecond) roots = [(wall - positiondmm) / velocitydmmPerSecond];
      } else {
        const discriminant = velocitydmmPerSecond * velocitydmmPerSecond - 2 * accelerationdmmPerSecondSquared * (positiondmm - wall);
        if (discriminant >= 0) {
          const root = Math.sqrt(discriminant);
          roots = [(-velocitydmmPerSecond - root) / accelerationdmmPerSecondSquared, (-velocitydmmPerSecond + root) / accelerationdmmPerSecondSquared];
        }
      }
      roots.forEach(function (seconds) {
        if (seconds > 1e-10 && seconds <= durationSeconds + 1e-10 && (!hit || seconds < hit.seconds)) hit = { seconds: Math.min(seconds, durationSeconds), positiondmm: wall };
      });
    });
    return hit;
  }

  function planAxis(positiondmm, velocitydmmPerSecond, targetdmmPerSecond, maximumAcceleration, durationMs) {
    const acceleration = Math.sign(targetdmmPerSecond - velocitydmmPerSecond) * maximumAcceleration;
    const rampMs = acceleration ? Math.abs(targetdmmPerSecond - velocitydmmPerSecond) / maximumAcceleration * 1000 : 0;
    const times = [0, durationMs];
    if (rampMs > 0 && rampMs < durationMs) times.push(rampMs);
    const zeroMs = acceleration ? -velocitydmmPerSecond / acceleration * 1000 : -1;
    if (zeroMs > 0 && zeroMs < Math.min(rampMs, durationMs)) times.push(zeroMs);
    times.sort(function (first, second) { return first - second; });
    const states = [];
    let position = positiondmm;
    let velocity = velocitydmmPerSecond;
    let blocked = false;
    for (let index = 0; index < times.length; index++) {
      const offsetMs = times[index];
      let phaseAcceleration = !blocked && offsetMs < rampMs - 1e-9 ? acceleration : 0;
      if (!blocked && offsetMs >= rampMs - 1e-9) velocity = targetdmmPerSecond;
      states.push({ timeMs: offsetMs, positiondmm: position, velocitydmmPerSecond: velocity, accelerationdmmPerSecondSquared: phaseAcceleration });
      if (index === times.length - 1) break;
      const seconds = (times[index + 1] - offsetMs) / 1000;
      const hit = !blocked && wallHit(position, velocity, phaseAcceleration, seconds);
      if (hit) {
        position = hit.positiondmm;
        velocity = 0;
        blocked = true;
        phaseAcceleration = 0;
        const stopped = { timeMs: offsetMs + hit.seconds * 1000, positiondmm: position, velocitydmmPerSecond: 0, accelerationdmmPerSecondSquared: 0 };
        if (hit.seconds === 0) states[states.length - 1] = stopped;
        else states.push(stopped);
      } else {
        position += velocity * seconds + phaseAcceleration * seconds * seconds / 2;
        velocity += phaseAcceleration * seconds;
      }
    }
    return states;
  }

  function axisAt(states, offsetMs) {
    const state = states[sim.findAtTime(states, offsetMs)];
    const seconds = Math.max(0, offsetMs - state.timeMs) / 1000;
    return {
      positiondmm: sim.clamp(state.positiondmm + state.velocitydmmPerSecond * seconds + state.accelerationdmmPerSecondSquared * seconds * seconds / 2, 0, sim.areaSizedmm),
      velocitydmmPerSecond: state.velocitydmmPerSecond + state.accelerationdmmPerSecondSquared * seconds,
      accelerationdmmPerSecondSquared: state.accelerationdmmPerSecondSquared
    };
  }

  sim.createG91Model = function (options) {
    const model = sim.createModelBase({ id: options.id || "g91", name: "G91 Incremental", colour: options.colour || sim.colours.blue, machineSettings: options.machineSettings });
    model.parameterSchema = schema;
    model.settings = Object.assign(sim.parameterDefaults(schema), options.settings);
    model.settingsHistory = [];
    model.blocks = [];
    model.status = "stopped";
    let activeBlock;
    let nextNode;
    let nextBoundaryMs;
    let wheelSampler;

    function makeBlock(timeMs, stream, stopping, wheel) {
      const start = model.stateAt(timeMs);
      const durationMs = model.settings.moveDurationMs;
      const maximumAcceleration = model.machineSettings ? model.machineSettings.maxAccelerationdmmPerSecondSquared : 20000;
      const proportion = function (value) { return model.settings.proportional ? value : Math.sign(value); };
      // A wheel supplies only this sample's new distance, divided by the sample
      // interval. Neither Input speed nor proportional mode scales that axis.
      // We intentionally do not add any distance missed by an earlier block.
      const dpadVelocityX = (stream.dpadX || 0) * stream.speeddmmPerSecond;
      const dpadVelocityY = (stream.dpadY || 0) * stream.speeddmmPerSecond;
      const joystickVelocityX = proportion(stream.x) * stream.speeddmmPerSecond;
      const joystickVelocityY = proportion(stream.y) * stream.speeddmmPerSecond;
      const targetX = stopping ? 0 : wheel.bumpVelocityXdmmPerSecond + (stream.wheelX ? wheel.velocityXdmmPerSecond + dpadVelocityX : joystickVelocityX);
      const targetY = stopping ? 0 : wheel.bumpVelocityYdmmPerSecond + (stream.wheelY ? wheel.velocityYdmmPerSecond + dpadVelocityY : joystickVelocityY);
      const requestedDeltaXdmm = stopping ? 0 : wheel.bumpDeltaXdmm + (stream.wheelX ? wheel.deltaXdmm + dpadVelocityX * durationMs / 1000 : joystickVelocityX * durationMs / 1000);
      const requestedDeltaYdmm = stopping ? 0 : wheel.bumpDeltaYdmm + (stream.wheelY ? wheel.deltaYdmm + dpadVelocityY * durationMs / 1000 : joystickVelocityY * durationMs / 1000);
      const axisX = planAxis(start.positionXdmm, start.velocityXdmmPerSecond, targetX, maximumAcceleration, durationMs);
      const axisY = planAxis(start.positionYdmm, start.velocityYdmmPerSecond, targetY, maximumAcceleration, durationMs);
      const times = Array.from(new Set(axisX.concat(axisY).map(function (state) { return state.timeMs; }))).sort(function (first, second) { return first - second; });
      const offsets = [];
      for (let index = 0; index < times.length - 1; index++) {
        const begin = times[index];
        const end = times[index + 1];
        const x = axisAt(axisX, begin);
        const y = axisAt(axisY, begin);
        const acceleration = Math.hypot(x.accelerationdmmPerSecondSquared, y.accelerationdmmPerSecondSquared);
        // Exact physics is recorded at phase changes. Extra display knots bound
        // the straight-line approximation of a curved path to 0.005 mm, well below
        // the public coordinate unit. Their times do not depend on browser frames.
        const maximumStepMs = acceleration ? Math.sqrt(8 * 0.05 / acceleration) * 1000 : end - begin;
        const count = Math.max(1, Math.ceil((end - begin) / maximumStepMs));
        for (let part = 0; part < count; part++) offsets.push(begin + (end - begin) * part / count);
      }
      offsets.push(durationMs);
      const nodes = offsets.map(function (offsetMs) {
        const x = axisAt(axisX, offsetMs);
        const y = axisAt(axisY, offsetMs);
        return Object.freeze({ timeMs: timeMs + offsetMs, positionXdmm: x.positiondmm, positionYdmm: y.positiondmm,
          velocityXdmmPerSecond: x.velocitydmmPerSecond, velocityYdmmPerSecond: y.velocitydmmPerSecond,
          accelerationXdmmPerSecondSquared: x.accelerationdmmPerSecondSquared, accelerationYdmmPerSecondSquared: y.accelerationdmmPerSecondSquared });
      });
      const end = nodes[nodes.length - 1];
      const block = Object.freeze({ startTimeMs: timeMs, endTimeMs: timeMs + durationMs, durationMs, stopping,
        requestedDeltaXdmm, requestedDeltaYdmm, wheelX: stream.wheelX, wheelY: stream.wheelY, wheelSampleDurationMs: wheel.durationMs,
        bumpDeltaXdmm: stopping ? 0 : wheel.bumpDeltaXdmm, bumpDeltaYdmm: stopping ? 0 : wheel.bumpDeltaYdmm,
        maximumAccelerationdmmPerSecondSquared: maximumAcceleration, targetVelocityXdmmPerSecond: targetX, targetVelocityYdmmPerSecond: targetY,
        deltaXdmm: Math.round(end.positionXdmm - start.positionXdmm), deltaYdmm: Math.round(end.positionYdmm - start.positionYdmm), nodes: Object.freeze(nodes) });
      model.blocks.push(block);
      options.messages.add({ modelId: model.id, modelName: model.name, sampledTimeMs: stream.timeMs, sentTimeMs: timeMs, deliveryTimeMs: timeMs, receivedTimeMs: timeMs,
        requestedSpeeddmmPerSecond: stream.speeddmmPerSecond, velocityXdmmPerSecond: targetX, velocityYdmmPerSecond: targetY,
        requestedDeltaXdmm, requestedDeltaYdmm, wheelX: stream.wheelX, wheelY: stream.wheelY, wheelSampleDurationMs: wheel.durationMs,
        bumpDeltaXdmm: stopping ? 0 : wheel.bumpDeltaXdmm, bumpDeltaYdmm: stopping ? 0 : wheel.bumpDeltaYdmm,
        deltaXdmm: block.deltaXdmm, deltaYdmm: block.deltaYdmm, durationMs, stopping });
      return block;
    }

    function adoptNode(node) {
      model.setVelocity(node.velocityXdmmPerSecond, node.velocityYdmmPerSecond);
      model.setAcceleration(node.accelerationXdmmPerSecondSquared, node.accelerationYdmmPerSecondSquared);
    }
    model.clear = function () {
      model.resetMotion();
      model.blocks.length = 0;
      model.settingsHistory.length = 0;
      model.settingsHistory.push({ timeMs: 0, parameters: Object.assign({}, model.settings) });
      activeBlock = null;
      nextNode = 0;
      nextBoundaryMs = model.settings.moveDurationMs;
      wheelSampler = sim.createWheelSampler();
      model.status = "stopped";
    };
    model.applySettings = function (parameters, timeMs) {
      const nextSettings = Object.assign({}, model.settings, parameters);
      if (typeof nextSettings.proportional !== "boolean" || !Number.isInteger(nextSettings.moveDurationMs) || nextSettings.moveDurationMs < 1 || nextSettings.moveDurationMs > 10000) throw new Error("Check the G91 parameters.");
      model.advanceTo(timeMs);
      model.advanceMotionTo(timeMs);
      Object.assign(model.settings, nextSettings);
      model.settingsHistory.push({ timeMs, parameters: Object.assign({}, model.settings) });
      if (!activeBlock) nextBoundaryMs = timeMs + model.settings.moveDurationMs;
    };
    model.advanceTo = function (timeMs) {
      if (timeMs < model.latestTimeMs) throw new Error("Advance the model forwards; use stateAt for inspection.");
      while (true) {
        const next = activeBlock && activeBlock.nodes[nextNode];
        const eventMs = Math.min(nextBoundaryMs, next ? next.timeMs : Infinity);
        if (eventMs > timeMs) break;
        model.advanceMotionTo(eventMs);
        if (next && next.timeMs === eventMs) { adoptNode(next); nextNode++; }
        if (nextBoundaryMs === eventMs) {
          const stream = options.input.at(eventMs);
          const wheel = wheelSampler.sample(stream, eventMs);
          const current = model.stateAt(eventMs);
          activeBlock = null;
          if (stream.sendEnabled || Math.abs(current.velocityXdmmPerSecond) > 1e-8 || Math.abs(current.velocityYdmmPerSecond) > 1e-8) {
            activeBlock = makeBlock(eventMs, stream, !stream.sendEnabled, wheel);
            nextNode = 1;
            adoptNode(activeBlock.nodes[0]);
            nextBoundaryMs = activeBlock.endTimeMs;
          } else {
            model.setAcceleration(0, 0);
            nextBoundaryMs = eventMs + model.settings.moveDurationMs;
          }
        }
      }
      model.latestTimeMs = timeMs;
      model.latestInputMessage = Object.assign({}, options.input.at(timeMs));
      const current = model.stateAt(timeMs);
      model.status = activeBlock ? (activeBlock.stopping ? "stopping" : "running") : (model.latestInputMessage.sendEnabled ? "waiting" : "stopped");
      if (activeBlock && activeBlock.stopping && Math.abs(current.velocityXdmmPerSecond) < 1e-8 && Math.abs(current.velocityYdmmPerSecond) < 1e-8 && !current.accelerationXdmmPerSecondSquared && !current.accelerationYdmmPerSecondSquared) model.status = "stopped";
    };
    model.clear();
    return model;
  };
})(window.MoveSim);
