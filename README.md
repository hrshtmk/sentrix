# SENTRIX

> **Smart India Hackathon 2026** | Problem Statement: **SIH26007**  
> **Team:** Sigma6 | **Author:** Harshit Mukhedkar  

**SENTRIX** is a high-performance 3D telemetry and anti-collision simulation system designed for autonomous haul trucks in open-pit mining operations. Built using **CesiumJS** for high-precision 3D geospatial rendering and **WebAssembly (WASM)** for real-time proximity and dynamic yielding logic.

---

## Prerequisite: Cesium Ion Token

To run and simulate SENTRIX, you **must provide a valid Cesium Ion Access Token** to load 3D terrain and Google Photorealistic 3D Tiles.

1. Create a free account at [Cesium Ion](https://ion.cesium.com/).
2. Copy your **Default Access Token**.
3. Open `config.js` and replace `'ACCESS TOKEN'` with your actual key:

```javascript
// config.js
Cesium.Ion.defaultAccessToken = 'ACCESS TOKEN';
