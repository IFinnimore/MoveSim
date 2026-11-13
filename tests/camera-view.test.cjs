"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function fixture() {
  let image;
  const context = vm.createContext({ window: {}, Image: function () { image = this; this.complete = true; this.naturalWidth = 286; } });
  for (const name of ["common", "camera-view"]) vm.runInContext(fs.readFileSync(path.join(__dirname, "../js/" + name + ".js"), "utf8"), context);
  return {camera: context.window.MoveSim.createCameraView(), getImage: function () { return image; }};
}
function close(actual, expected) { assert.ok(Math.abs(actual-expected)<1e-8,actual+" should equal "+expected); }

test("CAM-era has a square 100 mm field at reset with equal scale on both axes", function () {
  const {camera}=fixture();
  for (const [width,height] of [[800,600],[350,470]]) {
    const area=camera.layout(width,height,1);
    close(area.left+area.width/2,width/2);
    close(area.top+area.height/2,height/2);
    close(area.width/area.scale,1000);
    close(area.height/area.scale,1000);
    const enlarged=camera.layout(width,height,2);
    close(enlarged.width/enlarged.scale,500);
  }
});

test("PCB placement uses 100.1 by 62.1 mm at the fixed machine home", function () {
  const {camera,getImage}=fixture();
  const draws=[];
  const context={drawImage:function(...args){draws.push(args);}};
  camera.drawBoard(context,function(x,y){return{x:500+(x-2000)*2,y:400-(y-2000)*2};},2);
  assert.equal(getImage().src,"assets/pcb1-scaled.png");
  const draw=draws[0];
  close(draw[1]+draw[3]/2,500);
  close(draw[2]+draw[4]/2,400);
  close(draw[3]/2,1001);
  close(draw[4]/2,621);
  getImage().naturalWidth=0;
  assert.equal(camera.isReady(),false);
  camera.drawBoard(context,function(){throw new Error("Unreadable image must not draw");},1);
  assert.equal(draws.length,1);
});

test("crosshair arms leave a three CSS pixel gap beyond the visible centre dot", function () {
  const {camera}=fixture();
  const points=[];
  const dots=[];
  const context={save(){},restore(){},beginPath(){},stroke(){},fill(){},moveTo(x,y){points.push([x,y]);},lineTo(x,y){points.push([x,y]);},arc(x,y,r){dots.push([x,y,r]);}};
  camera.drawReticle(context,{left:100,top:0,width:400,height:400},"#62baff");
  assert.deepEqual(dots,[[300,200,4],[300,200,3]]);
  assert.deepEqual(points,[[100,200],[293,200],[307,200],[500,200],[300,0],[300,193],[300,207],[300,400]]);
  close(300-4-293,3);
});
