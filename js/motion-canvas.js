"use strict";
(function (sim) {
  sim.createMotionCanvas = function (canvas) {
    const modelsView = { zoom: 1, panX: 0, panY: 0 };
    const cameraViews = new Map();
    const camera = sim.createCameraView();
    let followedModelId = null;
    let gridVisible = true;
    let gatesVisible = false;
    let drag = null;
    let view = { width: 1, height: 1, scale: 1, centreXdmm: sim.centrePositiondmm, centreYdmm: sim.centrePositiondmm, panX: 0, panY: 0 };
    function settings() { return followedModelId === null ? modelsView : cameraViews.get(followedModelId); }
    const gates = [
      { positionXdmm: 950, positionYdmm: 1100, sizedmm: 100 },
      { positionXdmm: 1650, positionYdmm: 1500, sizedmm: 100 },
      { positionXdmm: 2350, positionYdmm: 1100, sizedmm: 100 },
      { positionXdmm: 2950, positionYdmm: 2100, sizedmm: 100 },
      { positionXdmm: 2250, positionYdmm: 2850, sizedmm: 100 },
      { positionXdmm: 1350, positionYdmm: 2450, sizedmm: 100 }
    ];

    function screenPoint(positionXdmm, positionYdmm) {
      return { x: view.width / 2 + view.panX + (positionXdmm - view.centreXdmm) * view.scale, y: view.height / 2 + view.panY - (positionYdmm - view.centreYdmm) * view.scale };
    }

    function zoomAt(factor, screenX, screenY) {
      const current = settings();
      const previousZoom = current.zoom;
      current.zoom = sim.clamp(current.zoom * factor, 0.25, 100);
      // CAM-era always zooms about the followed point. Models retains its
      // cursor-anchored navigation independently of all camera zoom settings.
      if (followedModelId !== null) return;
      const ratio = current.zoom / previousZoom;
      current.panX = screenX - view.width / 2 - (screenX - view.width / 2 - current.panX) * ratio;
      current.panY = screenY - view.height / 2 - (screenY - view.height / 2 - current.panY) * ratio;
    }
    canvas.addEventListener("wheel", function (event) {
      event.preventDefault();
      const bounds = canvas.getBoundingClientRect();
      zoomAt(Math.exp(-event.deltaY * 0.0015), event.clientX - bounds.left, event.clientY - bounds.top);
    }, { passive: false });
    canvas.addEventListener("pointerdown", function (event) {
      if (followedModelId !== null || event.button !== 0 || drag) return;
      drag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, panX: modelsView.panX, panY: modelsView.panY };
      canvas.setPointerCapture(event.pointerId);
      canvas.style.cursor = "grabbing";
    });
    canvas.addEventListener("pointermove", function (event) {
      if (!drag || drag.pointerId !== event.pointerId) return;
      modelsView.panX = drag.panX + event.clientX - drag.x;
      modelsView.panY = drag.panY + event.clientY - drag.y;
    });
    function endDrag() { drag = null; canvas.style.cursor = followedModelId === null ? "grab" : "default"; }
    ["pointerup", "pointercancel", "lostpointercapture"].forEach(function (name) { canvas.addEventListener(name, endDrag); });
    canvas.style.cursor = "grab";

    function gateHits(models, timeMs) {
      const hits = gates.map(function () { return false; });
      models.filter(function (model) { return model.visible; }).forEach(function (model) {
        const modelTimeMs = Math.min(timeMs, model.latestTimeMs);
        const endIndex = sim.findAtTime(model.history, timeMs);
        for (let index = 0; index <= endIndex; index++) {
          const start = model.history[index];
          const end = index < endIndex ? model.history[index + 1] : model.stateAt(modelTimeMs);
          gates.forEach(function (gate, gateIndex) {
            if (!hits[gateIndex] && sim.segmentIntersectsSquare(start, end, gate)) hits[gateIndex] = true;
          });
        }
      });
      return hits;
    }

    function drawGrid(context, width, height) {
      const area = view.area;
      const lowerLeft = screenPoint(0, 0);
      const upperRight = screenPoint(sim.areaSizedmm, sim.areaSizedmm);
      context.fillStyle = "#0e1b20";
      context.fillRect(lowerLeft.x, upperRight.y, upperRight.x - lowerLeft.x, lowerLeft.y - upperRight.y);
      // Change grid spacing with the view, down to the public 0.1 mm unit.
      const spacingsdmm = [1, 5, 10, 50, 100, 500, 1000, 2000];
      const spacingdmm = spacingsdmm.find(function (spacing) { return spacing * view.scale >= 45; }) || 2000;
      const minimumXdmm = Math.max(0, view.centreXdmm + (area.left - width / 2 - view.panX) / view.scale);
      const maximumXdmm = Math.min(sim.areaSizedmm, view.centreXdmm + (area.left + area.width - width / 2 - view.panX) / view.scale);
      const minimumYdmm = Math.max(0, view.centreYdmm - (area.top + area.height - height / 2 - view.panY) / view.scale);
      const maximumYdmm = Math.min(sim.areaSizedmm, view.centreYdmm - (area.top - height / 2 - view.panY) / view.scale);
      context.font = "12px Consolas, monospace";
      context.lineWidth = 1;
      if (gridVisible) {
        context.strokeStyle = "#23343b";
        context.fillStyle = "#7d989f";
        for (let positionXdmm = Math.ceil(minimumXdmm / spacingdmm) * spacingdmm; positionXdmm <= maximumXdmm; positionXdmm += spacingdmm) {
          const point = screenPoint(positionXdmm, 0);
          context.beginPath(); context.moveTo(point.x, Math.max(0, upperRight.y)); context.lineTo(point.x, Math.min(height, lowerLeft.y)); context.stroke();
          context.fillText(String(positionXdmm / 10), point.x + 4, sim.clamp(lowerLeft.y + 16, area.top + 18, area.top + area.height - 9));
        }
        for (let positionYdmm = Math.ceil(minimumYdmm / spacingdmm) * spacingdmm; positionYdmm <= maximumYdmm; positionYdmm += spacingdmm) {
          const point = screenPoint(0, positionYdmm);
          context.beginPath(); context.moveTo(Math.max(0, lowerLeft.x), point.y); context.lineTo(Math.min(width, upperRight.x), point.y); context.stroke();
          context.fillText(String(positionYdmm / 10), sim.clamp(lowerLeft.x - 33, area.left + 6, area.left + area.width - 40), point.y + 3);
        }
      }
      context.strokeStyle = "#4b6869";
      context.strokeRect(lowerLeft.x, upperRight.y, upperRight.x - lowerLeft.x, lowerLeft.y - upperRight.y);
      const centre = screenPoint(sim.centrePositiondmm, sim.centrePositiondmm);
      context.strokeStyle = "#4d6b63";
      context.beginPath(); context.moveTo(centre.x - 7, centre.y); context.lineTo(centre.x + 7, centre.y); context.moveTo(centre.x, centre.y - 7); context.lineTo(centre.x, centre.y + 7); context.stroke();
    }

    function drawModel(context, model, timeMs, isFollowed) {
      timeMs = Math.min(timeMs, model.latestTimeMs);
      const endIndex = sim.findAtTime(model.history, timeMs);
      context.strokeStyle = model.colour;
      context.lineWidth = 1.6;
      context.lineJoin = "round";
      context.beginPath();
      // Drawing uses precise internal endpoints to avoid visible speed wobble at high
      // zoom. The public model.points array remains integer dmm for sharing and tests.
      for (let index = 0; index <= endIndex; index++) {
        const state = model.history[index];
        const point = screenPoint(state.positionXdmm, state.positionYdmm);
        if (index === 0) context.moveTo(point.x, point.y); else context.lineTo(point.x, point.y);
      }
      const current = model.stateAt(timeMs);
      const cursor = screenPoint(current.positionXdmm, current.positionYdmm);
      context.lineTo(cursor.x, cursor.y);
      context.stroke();
      // The reticle supplies the followed model's dot, leaving its three-pixel
      // gap clear. Other model cursors retain their existing appearance.
      if (isFollowed) return;
      context.shadowColor = model.colour;
      context.shadowBlur = 11;
      context.fillStyle = model.colour;
      context.beginPath(); context.arc(cursor.x, cursor.y, 3.2, 0, Math.PI * 2); context.fill();
      context.shadowBlur = 0;
      context.strokeStyle = model.colour;
      context.globalAlpha = 0.5;
      context.beginPath(); context.arc(cursor.x, cursor.y, 8, 0, Math.PI * 2); context.stroke();
      context.globalAlpha = 1;
    }

    return {
      fit: function () { Object.assign(settings(), { zoom: 1, panX: 0, panY: 0 }); },
      resetViews: function () {
        Object.assign(modelsView, { zoom: 1, panX: 0, panY: 0 });
        cameraViews.forEach(function (state) { state.zoom = 1; });
      },
      setView: function (modelId) {
        followedModelId = modelId || null;
        if (followedModelId !== null && !cameraViews.has(followedModelId)) cameraViews.set(followedModelId, { zoom: 1, panX: 0, panY: 0 });
        endDrag();
        document.getElementById("camera-dro").hidden = followedModelId === null;
        document.getElementById("canvas-fit").textContent = followedModelId === null ? "Full area" : "100 × 100 mm";
        canvas.setAttribute("aria-label", followedModelId === null ? "Motion canvas, 400 by 400 millimetres. Scroll to zoom at the cursor. Drag to pan." : "CAM-era follows the selected model. Scroll to zoom about the crosshair. Pan is locked.");
      },
      getView: function () { return Object.assign({}, view, { area: Object.assign({}, view.area), followedModelId, zoom: settings().zoom, pcbReady: camera.isReady() }); },
      zoom: function (factor) { zoomAt(factor, view.width / 2, view.height / 2); },
      setGrid: function (visible) { gridVisible = visible; },
      setGates: function (visible) { gatesVisible = visible; },
      gates,
      gateHits,
      draw: function (models, timeMs) {
        const prepared = sim.prepareCanvas(canvas);
        const context = prepared.context;
        const current = settings();
        const followed = models.find(function (model) { return model.id === followedModelId; });
        const centre = followed ? followed.stateAt(Math.min(timeMs, followed.latestTimeMs)) : { positionXdmm: sim.centrePositiondmm, positionYdmm: sim.centrePositiondmm };
        const area = followed ? camera.layout(prepared.width, prepared.height, current.zoom) : { left: 0, top: 0, width: prepared.width, height: prepared.height };
        view = { timeMs, width: prepared.width, height: prepared.height,
          scale: followed ? area.scale : Math.max(0.01, Math.min((prepared.width - 100) / sim.areaSizedmm, (prepared.height - 85) / sim.areaSizedmm)) * current.zoom,
          centreXdmm: centre.positionXdmm, centreYdmm: centre.positionYdmm, panX: current.panX, panY: current.panY, area };
        context.clearRect(0, 0, view.width, view.height);
        context.save();
        if (followed) { context.beginPath(); context.rect(area.left, area.top, area.width, area.height); context.clip(); }
        drawGrid(context, view.width, view.height);
        if (followed) camera.drawBoard(context, screenPoint, view.scale);
        const hits = gatesVisible ? gateHits(models, timeMs) : [];
        if (gatesVisible) gates.forEach(function (gate, index) {
          const topLeft = screenPoint(gate.positionXdmm, gate.positionYdmm + gate.sizedmm);
          const size = gate.sizedmm * view.scale;
          context.fillStyle = hits[index] ? "#ff637b35" : "#66f7ac18";
          context.strokeStyle = hits[index] ? "#ff637b" : sim.colours.green;
          context.lineWidth = 1.5;
          context.fillRect(topLeft.x, topLeft.y, size, size);
          context.strokeRect(topLeft.x, topLeft.y, size, size);
        });
        models.filter(function (model) { return model.visible; }).forEach(function (model) { drawModel(context, model, timeMs, model === followed); });
        if (followed) camera.drawReticle(context, area, followed.colour);
        context.restore();
        if (followed) {
          context.strokeStyle = "#293840"; context.lineWidth = 1;
          context.strokeRect(area.left + 0.5, area.top + 0.5, area.width - 1, area.height - 1);
          document.getElementById("camera-x").textContent = "X" + (Math.round(centre.positionXdmm) / 10).toFixed(1);
          document.getElementById("camera-y").textContent = "Y" + (Math.round(centre.positionYdmm) / 10).toFixed(1);
          document.getElementById("camera-dro").style.color = followed.colour;
        }
        document.getElementById("canvas-overlay").style.left = (area.left + 19) + "px";
        document.getElementById("canvas-overlay").style.top = (area.top + 17) + "px";
        document.getElementById("canvas-help").textContent = followed ? "SCROLL TO ZOOM · FOLLOWING " + followed.name.toUpperCase() : "SCROLL TO ZOOM · DRAG TO PAN";
        document.getElementById("canvas-view-label").textContent = (followed ? "100 × 100 mm" : "400 × 400 mm") + " · " + current.zoom.toFixed(1) + "×";
        document.getElementById("gates-label").textContent = hits.filter(Boolean).length + " / " + gates.length + " gates hit";
      }
    };
  };
})(window.MoveSim);
