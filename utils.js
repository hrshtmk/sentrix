/**
 * @file      util.js
 * @brief     Coordinate transformations (ENU frames), KML parsing, and path interpolation.
 * 
 * @project   Smart India Hackathon 2026
 * @problem   SIH26007
 * @team      Sigma6
 * @author    Harshit Mukhedkar
 * @date      2026-09-11
 */

function logEvent(msg, className) {
  const logBox = document.getElementById('eventLog');
  const time = new Date().toLocaleTimeString().split(' ')[0];
  const item = document.createElement('div');
  item.className = `log-item ${className || ''}`;
  item.innerHTML = `<span class="log-time">[${time}]</span> ${msg}`;
  logBox.appendChild(item);
  logBox.scrollTop = logBox.scrollHeight;
}

function initEnuFrame(originCartesian) {
  enuOrigin = originCartesian;
  enuTransform = Cesium.Transforms.eastNorthUpToFixedFrame(originCartesian);
  enuInverseTransform = Cesium.Matrix4.inverse(enuTransform, new Cesium.Matrix4());
}

function cartesianToPoint2D(cartesian) {
  const local = Cesium.Matrix4.multiplyByPoint(enuInverseTransform, cartesian, new Cesium.Cartesian3());
  return { x: local.x, y: local.y };
}

function liftAboveGround(viewer, position, heightOffsetM, cacheObj) {
  const carto = Cesium.Cartographic.fromCartesian(position);
  const groundHeight = viewer.scene.sampleHeight(carto);
  
  let baseHeight = carto.height;
  if (groundHeight !== undefined && groundHeight !== null) {
    baseHeight = groundHeight;
    if (cacheObj) cacheObj.lastGoodHeight = groundHeight;
  } else if (cacheObj && cacheObj.lastGoodHeight !== undefined) {
    baseHeight = cacheObj.lastGoodHeight;
  }

  return Cesium.Cartesian3.fromRadians(carto.longitude, carto.latitude, baseHeight + heightOffsetM);
}

function parseKMLPaths(kmlText) {
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(kmlText, "text/xml");
  const placemarks = xmlDoc.querySelectorAll("Placemark");
  const result = [];

  placemarks.forEach((p, index) => {
    const name = p.querySelector("name") ? p.querySelector("name").textContent : `Path ${index}`;
    const coordsNode = p.querySelector("coordinates");
    if (!coordsNode) return;

    const raw = coordsNode.textContent.trim().split(/\s+/);
    const cartesians = [];

    raw.forEach(pt => {
      const parts = pt.split(',');
      if (parts.length >= 2) {
        cartesians.push(Cesium.Cartesian3.fromDegrees(parseFloat(parts[0]), parseFloat(parts[1]), 0));
      }
    });

    if (cartesians.length > 1) {
      result.push({ name, points: cartesians });
    }
  });
  return result;
}

function computePathDistances(points) {
  const dists = [0];
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += Cesium.Cartesian3.distance(points[i-1], points[i]);
    dists.push(total);
  }
  return { distances: dists, totalLength: total };
}

function evaluatePathAtDistance(points, distances, targetDist) {
  const total = distances[distances.length - 1];
  let d = Math.max(0, Math.min(targetDist, total));

  let idx = 0;
  while (idx < distances.length - 1 && distances[idx + 1] < d) { idx++; }
  if (idx >= points.length - 1) { idx = points.length - 2; }

  const p0 = points[idx];
  const p1 = points[idx + 1];
  const segLength = distances[idx + 1] - distances[idx];
  const t = segLength > 0 ? (d - distances[idx]) / segLength : 0;

  const position = Cesium.Cartesian3.lerp(p0, p1, t, new Cesium.Cartesian3());
  const dir = Cesium.Cartesian3.subtract(p1, p0, new Cesium.Cartesian3());
  Cesium.Cartesian3.normalize(dir, dir);

  return { position, direction: dir };
}

function computeOrientationFromDirection(position, direction) {
  const up = Cesium.Cartesian3.normalize(position, new Cesium.Cartesian3());
  const right = Cesium.Cartesian3.cross(direction, up, new Cesium.Cartesian3());
  Cesium.Cartesian3.normalize(right, right);
  const correctedUp = Cesium.Cartesian3.cross(right, direction, new Cesium.Cartesian3());

  const rotMatrix = new Cesium.Matrix3();
  Cesium.Matrix3.setColumn(rotMatrix, 0, right, rotMatrix);
  Cesium.Matrix3.setColumn(rotMatrix, 1, direction, rotMatrix);
  Cesium.Matrix3.setColumn(rotMatrix, 2, correctedUp, rotMatrix);

  return Cesium.Quaternion.fromRotationMatrix(rotMatrix);
}
