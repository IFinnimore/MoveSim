"use strict";
(function (sim) {
  // Models describe their own parameters. The notebook handles names, notes and
  // storage without needing to know what a parameter means to motion.
  sim.parameterDefaults = function (schema) {
    const parameters = {};
    Object.keys(schema).forEach(function (name) { parameters[name] = schema[name].defaultValue; });
    return parameters;
  };

  sim.createPresetStore = function (options) {
    const storageKey = "movesim.presets.v1." + encodeURIComponent(options.modelId);
    const schema = options.parameterSchema;
    let storage;
    let storageNotice = "";
    let presets = [];

    function copy(value) { return JSON.parse(JSON.stringify(value)); }
    function nameKey(name) { return name.trim().toLowerCase(); }
    function checkedName(name) {
      if (typeof name !== "string" || !name.trim()) throw new Error("Give this set a name.");
      if (name.trim().length > 80) throw new Error("Use 80 characters or fewer for the name.");
      return name.trim();
    }
    function checkedNote(note) {
      if (typeof note !== "string" || note.length > 2000) throw new Error("Use 2,000 characters or fewer for the note.");
      return note;
    }
    function checkedParameters(parameters) {
      if (!parameters || typeof parameters !== "object") throw new Error("This set has no model parameters.");
      const checked = {};
      Object.keys(schema).forEach(function (name) {
        const rule = schema[name];
        // A newly introduced field starts with its model's default. Existing fields
        // must still be valid, so a damaged set cannot create an endless event loop.
        const value = parameters[name] === undefined ? rule.defaultValue : parameters[name];
        const valid = rule.type === "boolean" ? typeof value === "boolean" : Number.isFinite(value) && (!rule.integer || Number.isInteger(value)) && value >= rule.minimum && value <= rule.maximum;
        if (!valid) {
          throw new Error("Check the value for " + rule.label + ".");
        }
        checked[name] = value;
      });
      return checked;
    }
    function defaultPreset() { return { name: "Defaults", note: "", parameters: sim.parameterDefaults(schema) }; }
    function sortedPresets() {
      return copy(presets).sort(function (first, second) { return first.name.localeCompare(second.name, undefined, { sensitivity: "base" }); });
    }
    function indexOf(name) { return presets.findIndex(function (preset) { return nameKey(preset.name) === nameKey(name); }); }
    function existing(name) {
      const index = indexOf(name);
      if (index < 0) throw new Error("Choose a saved set first.");
      return index;
    }
    function persist() {
      try {
        if (!storage) throw new Error("No browser storage");
        storage.setItem(storageKey, JSON.stringify({ version: 1, presets }));
        storageNotice = "";
      } catch (_) {
        // The notebook still works for this page if privacy settings or a full
        // browser store prevent persistence. Tell the user rather than claim a save.
        storageNotice = "Changes are kept in this tab only; browser storage is unavailable.";
      }
    }

    try {
      storage = options.storage === undefined ? window.localStorage : options.storage;
      if (!storage) throw new Error("No browser storage");
      const saved = storage.getItem(storageKey);
      if (saved !== null) {
        const document = JSON.parse(saved);
        if (!document || document.version !== 1 || !Array.isArray(document.presets)) throw new Error("Unknown notebook format");
        document.presets.forEach(function (preset) {
          const name = checkedName(preset.name);
          if (indexOf(name) >= 0) throw new Error("Duplicate name");
          presets.push({ name, note: checkedNote(preset.note), parameters: checkedParameters(preset.parameters) });
        });
      }
    } catch (_) {
      // Reading must never erase the existing notebook. A later explicit Save or
      // Delete is the only action that writes a replacement to browser storage.
      storageNotice = storage ? "Some saved sets could not be read. Stored data has not been changed." : "Sets are kept in this tab only; browser storage is unavailable.";
    }
    if (!presets.length) presets.push(defaultPreset());

    return {
      storageKey,
      list: sortedPresets,
      get: function (name) { return copy(presets[existing(name)]); },
      notice: function () { return storageNotice; },
      save: function (name, note, parameters) {
        const preset = { name: checkedName(name), note: checkedNote(note), parameters: checkedParameters(parameters) };
        const index = indexOf(preset.name);
        if (index < 0) presets.push(preset); else presets[index] = preset;
        persist();
        return copy(preset);
      },
      rename: function (previousName, newName) {
        const index = existing(previousName);
        const name = checkedName(newName);
        const duplicate = indexOf(name);
        if (duplicate >= 0 && duplicate !== index) throw new Error("That name is already in use. Choose another name.");
        presets[index].name = name;
        persist();
        return copy(presets[index]);
      },
      remove: function (name) {
        const sortedIndex = sortedPresets().findIndex(function (preset) { return nameKey(preset.name) === nameKey(name); });
        const index = existing(name);
        presets.splice(index, 1);
        const resetToDefaults = presets.length === 0;
        if (resetToDefaults) presets.push(defaultPreset());
        persist();
        return { preset: sortedPresets()[Math.min(sortedIndex, presets.length - 1)], resetToDefaults };
      }
    };
  };

  // Each model supplies its parameter form read/write functions. Selection changes
  // only that form; this service never clears a recording or applies motion settings.
  sim.bindPresetControls = function (options) {
    const store = options.store;
    const controls = options.controls;

    function report(message, failed) {
      const notice = store.notice();
      controls.status.textContent = message + (notice ? " " + notice : "");
      controls.status.classList.toggle("preset-warning", Boolean(failed || notice));
    }
    function refresh(selectedName) {
      controls.select.replaceChildren();
      store.list().forEach(function (preset) {
        const option = document.createElement("option");
        option.value = preset.name;
        option.textContent = preset.name;
        controls.select.append(option);
      });
      controls.select.value = selectedName;
      controls.summary.textContent = selectedName;
    }
    function showIdentity(preset) {
      controls.name.value = preset.name;
      controls.note.value = preset.note;
      controls.summary.textContent = preset.name;
    }
    function attempt(action) {
      try { action(); } catch (error) { report(error.message, true); }
    }

    controls.select.addEventListener("change", function () {
      attempt(function () {
        const preset = store.get(controls.select.value);
        showIdentity(preset);
        options.writeParameters(preset.parameters);
        report("Selected settings and note loaded into the controls.");
      });
    });
    controls.save.addEventListener("click", function () {
      attempt(function () {
        const preset = store.save(controls.name.value, controls.note.value, options.readParameters());
        refresh(preset.name);
        showIdentity(preset);
        report("Saved name, note and displayed parameters.");
      });
    });
    controls.rename.addEventListener("click", function () {
      attempt(function () {
        const preset = store.rename(controls.select.value, controls.name.value);
        refresh(preset.name);
        controls.name.value = preset.name;
        // Keep an edited note in place. Rename changes the stored name only;
        // Save remains the explicit action that records settings and observations.
        report("Renamed. Save records any edits to the note or parameters.");
      });
    });
    controls.remove.addEventListener("click", function () {
      attempt(function () {
        const result = store.remove(controls.select.value);
        refresh(result.preset.name);
        showIdentity(result.preset);
        options.writeParameters(result.preset.parameters);
        if (result.resetToDefaults) {
          report("Last set deleted. Defaults restored in the controls.");
        } else report("Deleted. The next selected set's settings and note are loaded.");
      });
    });

    const savedSets = store.list();
    const first = savedSets.find(function (preset) { return preset.name.toLowerCase() === "defaults"; }) || savedSets[0];
    refresh(first.name);
    showIdentity(first);
    options.writeParameters(first.parameters);
    report("Selecting a set loads its settings and note. Save records the displayed values.");
    return { store };
  };
})(window.MoveSim);
