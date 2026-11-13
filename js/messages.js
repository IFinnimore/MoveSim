"use strict";
(function (sim) {
  sim.createMessageLog = function () {
    const entries = [];
    let nextId = 1;
    return {
      entries,
      add: function (message) {
        message.id = nextId++;
        entries.push(message);
        return message;
      },
      clear: function () { entries.length = 0; nextId = 1; }
    };
  };
})(window.MoveSim);
