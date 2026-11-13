"use strict";
(function (sim) {
  sim.createInputSettings = function (suppliedStorage) {
    const storageKey = "movesim.input.v1";
    const defaults = {
      version: 1, source: "joystick", controllerId: "", controllerIndex: null, deadZone: 0.15,
      leftAxisX: 0, leftAxisY: 1, leftInvertX: false, leftInvertY: true,
      rightAxisX: 2, rightAxisY: 3, rightInvertX: false, rightInvertY: true, wheelRevolutiondmm: 1000
    };
    let settings = Object.assign({}, defaults);
    let storage;
    let notice = "";

    function validValue(name, value) {
      if (name === "source") return value === "joystick" || value === "gamepad";
      if (name === "controllerId") return typeof value === "string";
      if (name === "controllerIndex") return value === null || (Number.isInteger(value) && value >= 0);
      if (name === "deadZone") return Number.isFinite(value) && value >= 0 && value <= 0.9;
      if (name === "wheelRevolutiondmm") return [1000, 500, 100, 2540, 254].includes(value);
      if (name.includes("Axis")) return Number.isInteger(value) && value >= 0 && value <= 15;
      if (name.includes("Invert")) return typeof value === "boolean";
      return false;
    }
    function accept(values) {
      // Ignore incomplete numeric edits and damaged saved fields. Valid selections
      // remain usable, and a partial edit must not silently become axis zero.
      Object.keys(defaults).forEach(function (name) {
        if (validValue(name, values[name])) settings[name] = values[name];
      });
    }

    try {
      storage = suppliedStorage === undefined ? window.localStorage : suppliedStorage;
      if (!storage) throw new Error("Browser storage unavailable");
      const saved = storage.getItem(storageKey);
      if (saved !== null) {
        const values = JSON.parse(saved);
        if (!values || values.version !== 1) throw new Error("Unknown input settings format");
        accept(values);
      }
    } catch (_) {
      notice = storage ? "Saved input settings could not be read. Defaults are in use." : "Input settings are kept in this tab only; browser storage is unavailable.";
    }

    return {
      storageKey,
      get: function () { return Object.assign({}, settings); },
      notice: function () { return notice; },
      update: function (values) {
        accept(values);
        try {
          if (!storage) throw new Error("Browser storage unavailable");
          storage.setItem(storageKey, JSON.stringify(settings));
          notice = "";
        } catch (_) {
          notice = "Input settings are kept in this tab only; browser storage is unavailable.";
        }
        return this.get();
      }
    };
  };
})(window.MoveSim);
