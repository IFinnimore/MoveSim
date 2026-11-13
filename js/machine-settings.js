"use strict";
(function (sim) {
  sim.createMachineSettings = function (suppliedStorage) {
    const storageKey = "movesim.machine.v1";
    // Match the local Artisan Marlin configuration's X/Y maximum as a starting
    // value. Keep one shared object so every model sees the same machine limit.
    const values = { maxAccelerationdmmPerSecondSquared: 20000 };
    let storage;
    let notice = "";
    function valid(value) { return Number.isInteger(value) && value >= 1 && value <= 10000000; }
    try {
      storage = suppliedStorage === undefined ? window.localStorage : suppliedStorage;
      if (!storage) throw new Error("Browser storage unavailable");
      const saved = storage.getItem(storageKey);
      if (saved !== null) {
        const loaded = JSON.parse(saved);
        if (!loaded || loaded.version !== 1 || !valid(loaded.maxAccelerationdmmPerSecondSquared)) throw new Error("Invalid machine settings");
        values.maxAccelerationdmmPerSecondSquared = loaded.maxAccelerationdmmPerSecondSquared;
      }
    } catch (_) {
      notice = storage ? "Saved machine settings could not be read. The default is in use." : "Machine settings are kept in this tab only; browser storage is unavailable.";
    }
    return {
      values,
      notice: function () { return notice; },
      setMaxAcceleration: function (value) {
        if (!valid(value)) throw new Error("Choose an acceleration from 0.1 to 1,000,000 mm/s².");
        values.maxAccelerationdmmPerSecondSquared = value;
        try {
          if (!storage) throw new Error("Browser storage unavailable");
          storage.setItem(storageKey, JSON.stringify({ version: 1, maxAccelerationdmmPerSecondSquared: value }));
          notice = "";
        } catch (_) { notice = "Machine settings are kept in this tab only; browser storage is unavailable."; }
      }
    };
  };
})(window.MoveSim);
