/**
 * @file      app.js
 * @brief     Main application runtime loop, vehicle state updates, and Cesium event listeners.
 * 
 * @project   Smart India Hackathon 2026
 * @problem   SIH26007
 * @team      Sigma6
 * @author    Harshit Mukhedkar
 * @date      2026-09-11
 */

/* Application Runtime Variables */
let ModuleInstance = null;
let wasmEngine = null;
let systemEnabled = true;
let simFinished = false;
let crashSites = [];
let truckStateVector = null;
let allPathsWasm = null;
let allDistancesWasm = null;
let enuOrigin = null;
let enuTransform = null;
let enuInverseTransform = null;
let trucks = [];
let tilesetReady = false;
let pendingStart = null;

/* Cesium Viewer Init */
const viewer = new Cesium.Viewer('cesiumContainer', {
  baseLayer: false,
  animation: false,
  timeline: false,
  sceneModePicker: false,
  navigationHelpButton: false,
  baseLayerPicker: false,
  geocoder: false
});

viewer.scene.globe.show = false;
viewer.clock.shouldAnimate = true;
viewer.clock.clockStep = Cesium.ClockStep.SYSTEM_CLOCK;
viewer.scene.globe.depthTestAgainstTerrain = false;

function onTilesetReady() {
  tilesetReady = true;
  if (pendingStart) { pendingStart(); pendingStart = null; }
}

(async () => {
  try {
    const tileset = await Cesium.createGooglePhotorealistic3DTileset();
    tileset.enableCollision = true;
    viewer.scene.primitives.add(tileset);
    onTilesetReady();
  } catch (err) {
    console.error('Failed to load Google Photorealistic 3D Tiles:', err);
    logEvent('Photorealistic tiles failed to load', 'log-crash');
    viewer.scene.globe.show = true;
    viewer.imageryLayers.addImageryProvider(
      new Cesium.OpenStreetMapImageryProvider({ url: 'https://tile.openstreetmap.org/' })
    );
    onTilesetReady();
  }
})();

function triggerCollision(truckA, truckB) {
  if (truckA.crashed && truckB.crashed) return;

  truckA.crashed = true; truckB.crashed = true;
  truckA.actualSpeedMPS = 0; truckB.actualSpeedMPS = 0;

  const crashPos = Cesium.Cartesian3.midpoint(
    truckA._lastSamplePos || truckA.points[0],
    truckB._lastSamplePos || truckB.points[0],
    new Cesium.Cartesian3()
  );

  const crashEntity = viewer.entities.add({
    position: crashPos,
    ellipse: {
      semiMinorAxis: WARNING_CIRCLE_RADIUS_M,
      semiMajorAxis: WARNING_CIRCLE_RADIUS_M,
      material: Cesium.Color.RED.withAlpha(0.3),
      outline: true,
      outlineColor: Cesium.Color.RED,
      heightReference: Cesium.HeightReference.CLAMP_TO_GROUND
    }
  });

  crashSites.push({ entity: crashEntity, position: crashPos, radius: WARNING_CIRCLE_RADIUS_M });

  logEvent(`CRASH DETECTED between Truck ${idToName[truckA.id]} and Truck ${idToName[truckB.id]}!`, "log-crash");
  truckA.entity.box.material = Cesium.Color.RED;
  truckB.entity.box.material = Cesium.Color.RED;
}

function resetSimulation() {
  simFinished = false;
  crashSites.forEach(site => { if (site.entity) viewer.entities.remove(site.entity); });
  crashSites = [];

  trucks.forEach((t, i) => {
    t.crashed = false;
    t.wasYielding = false;
    t.currentProgress = t.baseStartProgress;
    t.targetSpeedMPS = t.baseSpeedMPS;
    t.actualSpeedMPS = t.baseSpeedMPS;
    t._lastSamplePos = undefined;

    const sample = evaluatePathAtDistance(t.points, t.distances, t.currentProgress);
    t.entity.position = liftAboveGround(viewer, sample.position, TRUCK_HEIGHT_M / 2 + 1.5, t);
    t.entity.orientation = computeOrientationFromDirection(sample.position, sample.direction);
    t.entity.box.material = TRUCK_BASE_COLOR;

    const state = truckStateVector.get(i);
    state.currentProgress = t.currentProgress;
    state.targetSpeed = t.targetSpeedMPS;
    state.actualSpeed = t.actualSpeedMPS;
    state.isYielding = 0;
    state.yieldingToId = -1;
    state.clearMargin = 0.0;
    truckStateVector.set(i, state);

    const slider = document.getElementById(`speed-slider-${t.id}`);
    const speedLabel = document.getElementById(`speed-value-${t.id}`);
    if (slider) slider.value = t.baseSpeedMPS;
    if (speedLabel) speedLabel.innerText = `${(t.baseSpeedMPS * 3.6).toFixed(1)} km/h`;

    const statusTag = document.getElementById(`status-${t.id}`);
    const reasonTag = document.getElementById(`reason-${t.id}`);
    if (statusTag) { statusTag.innerText = "CLEAR"; statusTag.className = "status-tag moving"; }
    if (reasonTag) { reasonTag.innerText = ""; }
  });

  document.getElementById('eventLog').innerHTML = '';
  logEvent('RESET STATES', 'log-info');
}

function initApp() {
  const parsedPaths = parseKMLPaths(kmlDataString);
  if (parsedPaths.length === 0) return;

  initEnuFrame(parsedPaths[0].points[0]);

  parsedPaths.forEach((path, i) => {
    const colors = [Cesium.Color.CYAN, Cesium.Color.YELLOW, Cesium.Color.LIME, Cesium.Color.MAGENTA];
    viewer.entities.add({
      name: path.name,
      polyline: {
        positions: path.points,
        width: 4,
        material: colors[i % colors.length].withAlpha(0.85),
        clampToGround: true
      }
    });
  });

    // Calculate bounding sphere directly from all KML path points
  const allPoints = parsedPaths.flatMap(p => p.points);
  const boundingSphere = Cesium.BoundingSphere.fromPoints(allPoints);

  viewer.camera.setView({
    destination: boundingSphere.center,
    orientation: {
      heading: Cesium.Math.toRadians(0),
      pitch: Cesium.Math.toRadians(-60),
      roll: 0.0
    }
  });

  // Encapsulate all the paths
  viewer.camera.moveBackward(boundingSphere.radius * 5);

  truckStateVector = new ModuleInstance.VectorTruckState();
  allPathsWasm     = new ModuleInstance.VectorVectorPoint2D();
  allDistancesWasm = new ModuleInstance.VectorVectorDouble();

  parsedPaths.forEach(pathData => {
    const { distances, totalLength } = computePathDistances(pathData.points);
    pathData.distances = distances;
    pathData.totalLength = totalLength;
    pathData.points2D = pathData.points.map(cartesianToPoint2D);

    const pointsVec = new ModuleInstance.VectorPoint2D();
    pathData.points2D.forEach(pt => pointsVec.push_back({ x: pt.x, y: pt.y }));
    allPathsWasm.push_back(pointsVec);

    const distVec = new ModuleInstance.VectorDouble();
    distances.forEach(d => distVec.push_back(d));
    allDistancesWasm.push_back(distVec);
  });

  const truckListUI = document.getElementById('truckList');
  truckListUI.innerHTML = '';
  trucks = [];

  truckConfigs.forEach(cfg => {
    const pathData = parsedPaths[cfg.pathIdx % parsedPaths.length];

    const tState = {
      id: cfg.id,
      pathIndex: cfg.pathIdx % parsedPaths.length,
      currentProgress: cfg.startProgress,
      targetSpeed: cfg.speed,
      actualSpeed: cfg.speed,
      pathTotalLength: pathData.totalLength,
      isYielding: 0, yieldingToId: -1,
      clearMargin: 0.0
    };
    truckStateVector.push_back(tState);

    const initialSample = evaluatePathAtDistance(pathData.points, pathData.distances, cfg.startProgress);
    const cacheObj = { lastGoodHeight: undefined };
    const initPos = liftAboveGround(viewer, initialSample.position, TRUCK_HEIGHT_M / 2 + 1.5, cacheObj);

    const entity = viewer.entities.add({
      name: `Truck ${idToName[cfg.id] || cfg.id}`,
      position: initPos,
      orientation: computeOrientationFromDirection(initialSample.position, initialSample.direction),
      box: {
        dimensions: new Cesium.Cartesian3(TRUCK_WIDTH_M, TRUCK_LENGTH_M, TRUCK_HEIGHT_M),
        material: TRUCK_BASE_COLOR,
        outline: true,
        outlineColor: Cesium.Color.WHITE
      },
      point: {
        pixelSize: 10,
        color: Cesium.Color.YELLOW,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 2,
        disableDepthTestDistance: Number.POSITIVE_INFINITY
      },
      label: {
        text: `Truck ${idToName[cfg.id] || cfg.id}`,
        font: '13px Share Tech Mono',
        fillColor: Cesium.Color.WHITE,
        showBackground: true,
        backgroundColor: new Cesium.Color(0, 0, 0, 0.8),
        pixelOffset: new Cesium.Cartesian2(0, -35),
        disableDepthTestDistance: Number.POSITIVE_INFINITY
      }
    });

    trucks.push({
      id: cfg.id, pathIdx: cfg.pathIdx % parsedPaths.length,
      baseSpeedMPS: cfg.speed, targetSpeedMPS: cfg.speed,
      actualSpeedMPS: cfg.speed, baseStartProgress: cfg.startProgress,
      currentProgress: cfg.startProgress, totalLength: pathData.totalLength,
      points: pathData.points, distances: pathData.distances,
      entity: entity, wasYielding: false, crashed: false,
      lastGoodHeight: cacheObj.lastGoodHeight
    });

    const maxSliderSpeed = Math.max(20, Math.ceil(cfg.speed * 1.8));

    const card = document.createElement('div');
    card.className = 'truck-card';
    card.innerHTML = `
      <div class="truck-card-header">
        <span>Truck ${idToName[cfg.id] || cfg.id} (Path ${cfg.pathIdx})</span>
        <span id="status-${cfg.id}" class="status-tag moving">CLEAR</span>
      </div>
      <div class="speed-row">
        <input type="range" id="speed-slider-${cfg.id}" min="0" max="${maxSliderSpeed}" step="0.5" value="${cfg.speed}">
        <span id="speed-value-${cfg.id}" class="speed-value">${(cfg.speed * 3.6).toFixed(1)} km/h</span>
      </div>
      <div id="reason-${cfg.id}" class="yield-reason"></div>
    `;
    truckListUI.appendChild(card);

    const slider = card.querySelector(`#speed-slider-${cfg.id}`);
    const speedLabel = card.querySelector(`#speed-value-${cfg.id}`);
    slider.addEventListener('input', (e) => {
      const newSpeedMPS = parseFloat(e.target.value);
      const truckRef = trucks.find(tr => tr.id === cfg.id);
      if (truckRef) truckRef.targetSpeedMPS = newSpeedMPS;
      speedLabel.innerText = `${(newSpeedMPS * 3.6).toFixed(1)} km/h`;
    });
  });

  document.getElementById('systemToggle').addEventListener('change', (e) => {
    systemEnabled = e.target.checked;
    logEvent(`ANTI COLLISION ENGINE ${systemEnabled ? 'ENABLED' : 'DISABLED'}`, systemEnabled ? 'log-clear' : 'log-crash');
  });

  document.getElementById('resetBtn').addEventListener('click', () => {
    resetSimulation();
  });

  let lastTime = performance.now();

  viewer.clock.onTick.addEventListener(() => {
    if (simFinished) return;

    const now = performance.now();
    const dt = Math.min((now - lastTime) / 1000.0, 0.1);
    lastTime = now;

    for (let i = 0; i < trucks.length; i++) {
      const t = trucks[i];
      const state = truckStateVector.get(i);
      state.currentProgress = t.currentProgress;
      state.targetSpeed = t.crashed ? 0.0 : t.targetSpeedMPS;
      truckStateVector.set(i, state);
    }

    if (systemEnabled && wasmEngine) {
      wasmEngine.processFrame(truckStateVector, allPathsWasm, allDistancesWasm);
    }

    for (let i = 0; i < trucks.length; i++) {
      const t = trucks[i];
      if (t.crashed) continue;

      const wasmResult = truckStateVector.get(i);
      const nowYielding = systemEnabled && !!wasmResult.isYielding;

      let effectiveSpeed = systemEnabled ? wasmResult.actualSpeed : t.targetSpeedMPS;
      t.actualSpeedMPS = effectiveSpeed;
      
      t.currentProgress = Math.min(t.totalLength, t.currentProgress + t.actualSpeedMPS * dt);

      const sample = evaluatePathAtDistance(t.points, t.distances, t.currentProgress);
      const renderedPos = sample.position;

      t.entity.position = liftAboveGround(viewer, renderedPos, TRUCK_HEIGHT_M / 2 + 1.5, t);
      t.entity.orientation = computeOrientationFromDirection(renderedPos, sample.direction);
      t._lastSamplePos = renderedPos;

      const statusTag = document.getElementById(`status-${t.id}`);
      const reasonTag = document.getElementById(`reason-${t.id}`);

      if (t.currentProgress >= t.totalLength) {
        statusTag.innerText = "ARRIVED"; statusTag.className = "status-tag finished";
        reasonTag.innerText = "";
      } else if (nowYielding) {
        const targetName = idToName[wasmResult.yieldingToId] || wasmResult.yieldingToId;
        statusTag.innerText = "WAITING"; statusTag.className = "status-tag yielding";
        reasonTag.innerText = `Waiting for Truck ${targetName}`;
        if (!t.wasYielding) {
          logEvent(`Truck ${idToName[t.id]} waiting for Truck ${targetName}`, "log-yield");
        }
      } else {
        statusTag.innerText = "CLEAR"; statusTag.className = "status-tag moving";
        reasonTag.innerText = "";
        if (t.wasYielding) {
          logEvent(`Truck ${idToName[t.id]} clear, resuming`, "log-clear");
        }
      }
      t.wasYielding = nowYielding;
    }

    const allFinished = trucks.every(t => t.currentProgress >= t.totalLength && !t.crashed);
    if (allFinished) {
      simFinished = true;
      logEvent("Simulation successful", "log-clear");
      return;
    }

    for (let i = 0; i < trucks.length; i++) {
      const a = trucks[i];
      if (!a._lastSamplePos || a.currentProgress >= a.totalLength) continue;
      
      for (let j = i + 1; j < trucks.length; j++) {
        const b = trucks[j];
        if (!b._lastSamplePos || b.currentProgress >= b.totalLength) continue;
        if (a.crashed && b.crashed) continue;

        const d = Cesium.Cartesian3.distance(a._lastSamplePos, b._lastSamplePos);
        if (d < COLLISION_DISTANCE_M) triggerCollision(a, b);
      }
    }
  });
}

/* WASM Module Script Initialization */
let appStarted = false;
var Module = {
  onRuntimeInitialized: function() {
    if (appStarted) return;
    appStarted = true;
    ModuleInstance = Module;
    try {
      wasmEngine = new Module.MineCollisionEngine(YIELD_ZONE_RADIUS_M);
      document.getElementById('wasmBadge').className = "status-badge active";
      document.getElementById('wasmBadge').querySelector('span').innerText = "WASM Active";
    } catch (err) {
      console.error("WASM instantiation error:", err);
      document.getElementById('wasmBadge').className = "status-badge disabled";
      document.getElementById('wasmBadge').querySelector('span').innerText = "WASM Failed";
    }
    if (tilesetReady) { initApp(); } else { pendingStart = initApp; }
  }
};

const wasmScriptTag = document.createElement('script');
wasmScriptTag.src = 'mine_collision.js';
wasmScriptTag.onerror = () => {
  document.getElementById('wasmBadge').className = "status-badge disabled";
  document.getElementById('wasmBadge').querySelector('span').innerText = "WASM Script Missing";
  logEvent("mine_collision.js failed to load.", "log-crash");
};
document.body.appendChild(wasmScriptTag);
