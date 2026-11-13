"use strict";
(function (sim) {
  // Keep defaults and accepted ranges with the model. The shared notebook uses
  // the same declaration when it creates Defaults and reads saved parameter sets.
  const parameterSchema = {
    proportional: { label: "proportional", type: "boolean", defaultValue: false },
    sampleIntervalMs: { label: "sample interval", defaultValue: 20, minimum: 1, maximum: 10000, integer: true },
    messageIntervalMs: { label: "message interval", defaultValue: 20, minimum: 1, maximum: 10000, integer: true },
    deliveryDelayMs: { label: "delivery delay", defaultValue: 0, minimum: 0, maximum: 10000, integer: true }
  };

  sim.createJustDrawModel = function (options) {
    const model = sim.createModelBase({ id: options.id || "just-draw", name: "Just Draw", colour: options.colour, machineSettings: options.machineSettings });
    model.parameterSchema = parameterSchema;
    model.settings = Object.assign(sim.parameterDefaults(parameterSchema), options.settings);
    model.settingsHistory = [];
    let nextSampleMs;
    let nextMessageMs;
    let sampledInput;
    let pendingMessages;
    let pendingStart;
    let nextInputIndex;
    let wheelSampler;

    model.clear = function () {
      model.resetMotion();
      nextSampleMs = 0;
      nextMessageMs = 0;
      sampledInput = { timeMs: 0, x: 0, y: 0 };
      pendingMessages = [];
      pendingStart = 0;
      nextInputIndex = 0;
      wheelSampler = sim.createWheelSampler();
      model.settingsHistory.length = 0;
      model.settingsHistory.push({ timeMs: 0, parameters: Object.assign({}, model.settings) });
    };

    model.applySettings = function (parameters, timeMs) {
      const nextSettings = Object.assign({}, model.settings, parameters);
      Object.keys(parameterSchema).forEach(function (name) {
        const rule = parameterSchema[name];
        const value = nextSettings[name];
        const valid = rule.type === "boolean" ? typeof value === "boolean" : Number.isFinite(value) && Number.isInteger(value) && value >= rule.minimum && value <= rule.maximum;
        if (!valid) throw new Error("Check the value for " + rule.label + ".");
      });
      // Finish the old schedule first and retain its path. New sampling and sending
      // cycles begin here; messages already in flight retain their original timing.
      model.advanceTo(timeMs);
      model.advanceMotionTo(timeMs);
      Object.assign(model.settings, nextSettings);
      model.settingsHistory.push({ timeMs, parameters: Object.assign({}, model.settings) });
      nextSampleMs = timeMs + model.settings.sampleIntervalMs;
      nextMessageMs = timeMs + model.settings.messageIntervalMs;
    };

    // This reference changes velocity immediately. Proportional mode retains axis
    // magnitude; the default uses full selected speed for any nonzero axis.
    function makeMessage(timeMs, stream) {
      const wheel = sampledInput.wheel;
      const freshWheel = wheel && wheel.epoch === stream.wheelEpoch;
      // The D-pad remains available on wheel axes. Add its sampled direction to
      // wheel velocity without letting ordinary joystick input reclaim that axis.
      const bumpVelocityX = freshWheel ? wheel.bumpVelocityXdmmPerSecond : 0;
      const bumpVelocityY = freshWheel ? wheel.bumpVelocityYdmmPerSecond : 0;
      const wheelVelocityX = freshWheel ? wheel.velocityXdmmPerSecond : 0;
      const wheelVelocityY = freshWheel ? wheel.velocityYdmmPerSecond : 0;
      const dpadVelocityX = (sampledInput.dpadX || 0) * stream.speeddmmPerSecond;
      const dpadVelocityY = (sampledInput.dpadY || 0) * stream.speeddmmPerSecond;
      const joystickVelocityX = (model.settings.proportional ? sampledInput.x : Math.sign(sampledInput.x)) * stream.speeddmmPerSecond;
      const joystickVelocityY = (model.settings.proportional ? sampledInput.y : Math.sign(sampledInput.y)) * stream.speeddmmPerSecond;
      const velocityXdmmPerSecond = bumpVelocityX + (stream.wheelX ? wheelVelocityX + dpadVelocityX : joystickVelocityX);
      const velocityYdmmPerSecond = bumpVelocityY + (stream.wheelY ? wheelVelocityY + dpadVelocityY : joystickVelocityY);
      const intervalSeconds = model.settings.messageIntervalMs / 1000;
      return options.messages.add({
        modelId: model.id,
        modelName: model.name,
        sampledTimeMs: sampledInput.timeMs,
        sentTimeMs: timeMs,
        deliveryTimeMs: timeMs + model.settings.deliveryDelayMs,
        receivedTimeMs: null,
        requestedSpeeddmmPerSecond: stream.speeddmmPerSecond,
        wheelX: stream.wheelX, wheelY: stream.wheelY,
        wheelDeltaXdmm: freshWheel ? wheel.deltaXdmm : 0, wheelDeltaYdmm: freshWheel ? wheel.deltaYdmm : 0,
        wheelSampleDurationMs: wheel ? wheel.durationMs : 0,
        bumpDeltaXdmm: freshWheel ? wheel.bumpDeltaXdmm : 0, bumpDeltaYdmm: freshWheel ? wheel.bumpDeltaYdmm : 0,
        // These integer deltas describe one message interval at the requested speed.
        // Just Draw follows the velocity until the next delivery; it does not queue
        // the delta as another destination. This is a local illustrative message,
        // not a proposed GCodeI wire format.
        deltaXdmm: Math.round(velocityXdmmPerSecond * intervalSeconds),
        deltaYdmm: Math.round(velocityYdmmPerSecond * intervalSeconds),
        velocityXdmmPerSecond,
        velocityYdmmPerSecond
      });
    }

    model.advanceTo = function (timeMs) {
      if (timeMs < model.latestTimeMs) throw new Error("Advance the model forwards; use stateAt for inspection.");
      // Process scheduled simulation events, even when several occur between frames.
      // At an equal time the order is sample, send, receive. Delay zero is truly zero.
      while (true) {
        const delivery = pendingMessages[pendingStart];
        const nextDeliveryMs = delivery ? delivery.deliveryTimeMs : Infinity;
        const boundaryMs = model.nextBoundaryTime();
        const inputChange = options.input.history[nextInputIndex];
        const nextInputMs = inputChange ? inputChange.timeMs : Infinity;
        const eventMs = Math.min(nextSampleMs, nextMessageMs, nextDeliveryMs, boundaryMs, nextInputMs);
        if (eventMs > timeMs) break;
        model.advanceMotionTo(eventMs);
        if (boundaryMs === eventMs) model.stopAtBoundary();
        if (nextInputMs === eventMs) nextInputIndex++;
        const stream = options.input.at(eventMs);
        if (!stream.sendEnabled) {
          // Stop at the run signal, even between polls. Cancel commands still in
          // flight so an old delivery cannot restart motion after a later Send.
          const state = model.stateAt(eventMs);
          if (state.velocityXdmmPerSecond || state.velocityYdmmPerSecond) model.setVelocity(0, 0);
          while (pendingStart < pendingMessages.length) pendingMessages[pendingStart++].cancelledTimeMs = eventMs;
        }
        if (nextSampleMs === eventMs) {
          const input = options.input.at(eventMs);
          sampledInput = { timeMs: eventMs, x: input.x, y: input.y, dpadX: input.dpadX, dpadY: input.dpadY, wheel: wheelSampler.sample(input, eventMs) };
          nextSampleMs += model.settings.sampleIntervalMs;
        }
        if (nextMessageMs === eventMs) {
          // Speed and run permission belong to the shared input. Sampling keeps
          // tracking direction while stopped, ready for the next permitted send.
          if (stream.sendEnabled) {
            const message = makeMessage(eventMs, stream);
            // A reduced delivery delay can let a new message arrive before one that
            // is already in flight. Keep deliveries ordered by their actual due time.
            let insertion = pendingMessages.length;
            while (insertion > pendingStart && pendingMessages[insertion - 1].deliveryTimeMs > message.deliveryTimeMs) insertion--;
            pendingMessages.splice(insertion, 0, message);
          }
          nextMessageMs += model.settings.messageIntervalMs;
        }
        // Sending may have created a delivery at this very time.
        while (pendingMessages[pendingStart] && pendingMessages[pendingStart].deliveryTimeMs <= eventMs) {
          const message = pendingMessages[pendingStart++];
          message.receivedTimeMs = eventMs;
          model.setVelocity(message.velocityXdmmPerSecond, message.velocityYdmmPerSecond);
        }
        if (pendingStart > 1024) {
          pendingMessages = pendingMessages.slice(pendingStart);
          pendingStart = 0;
        }
      }
      model.latestTimeMs = timeMs;
    };

    model.clear();
    return model;
  };
})(window.MoveSim);
