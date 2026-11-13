"use strict";
(function (sim) {
  sim.createCameraView = function () {
    const board = Object.freeze({ widthdmm: 1001, heightdmm: 621, positionXdmm: sim.centrePositiondmm, positionYdmm: sim.centrePositiondmm });
    const image = new Image();
    image.src = "assets/pcb1-scaled.png";

    return {
      board,
      isReady: function () { return image.complete && image.naturalWidth > 0; },
      layout: function (width, height, zoom) {
        // A square aperture keeps both physical axes at the same scale. The
        // unused canvas margins remain dark on a rectangular screen.
        const size = Math.max(1, Math.min(width, height));
        return { left: (width - size) / 2, top: (height - size) / 2, width: size, height: size, scale: size * zoom / 1000 };
      },
      drawBoard: function (context, screenPoint, scale) {
        if (!image.complete || !image.naturalWidth) return;
        // The PCB stays fixed in machine space. Following the model moves the
        // image beneath the reticle, as a camera moving over a real board would.
        const topLeft = screenPoint(board.positionXdmm - board.widthdmm / 2, board.positionYdmm + board.heightdmm / 2);
        context.drawImage(image, topLeft.x, topLeft.y, board.widthdmm * scale, board.heightdmm * scale);
      },
      drawReticle: function (context, area, colour) {
        const centreX = area.left + area.width / 2;
        const centreY = area.top + area.height / 2;
        const dotRadius = 3;
        const outline = 1;
        const inner = dotRadius + outline + 3;
        context.save();
        context.lineCap = "butt";
        // A dark outline keeps the model colour readable over copper and labels.
        // The arms start three CSS pixels beyond the outlined centre dot.
        context.beginPath();
        context.moveTo(area.left, centreY); context.lineTo(centreX - inner, centreY);
        context.moveTo(centreX + inner, centreY); context.lineTo(area.left + area.width, centreY);
        context.moveTo(centreX, area.top); context.lineTo(centreX, centreY - inner);
        context.moveTo(centreX, centreY + inner); context.lineTo(centreX, area.top + area.height);
        context.strokeStyle = "#071014"; context.lineWidth = 3; context.stroke();
        context.strokeStyle = colour; context.lineWidth = 1; context.stroke();
        context.beginPath(); context.arc(centreX, centreY, dotRadius + outline, 0, Math.PI * 2);
        context.fillStyle = "#071014"; context.fill();
        context.beginPath(); context.arc(centreX, centreY, dotRadius, 0, Math.PI * 2);
        context.fillStyle = colour; context.fill();
        context.restore();
      }
    };
  };
})(window.MoveSim);
