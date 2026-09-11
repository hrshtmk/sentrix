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
```

---

## Features

* **WASM-Powered Engine:** High-speed C++ collision check module (`MineCollisionEngine`) compiled to WebAssembly for sub-millisecond execution loops.
* **3D Photorealistic Digital Twin:** Integrates Google Photorealistic 3D Tiles over mining terrain using CesiumJS.
* **Dynamic Yielding & Priority Tracking:** Real-time speed modulation, yield zone calculations, and path trajectory monitoring.
* **Live Telemetry Dashboard:** HUD displaying real-time vehicle status (`CLEAR`, `WAITING`, `ARRIVED`, `CRASHED`), speed adjustments, and event logs.
* **KML Trajectory Parsing:** Native support for loading multi-path KML coordinate vectors into Local East-North-Up (ENU) spatial frames.

---

## Quick Start

Because this project relies on WebAssembly (`.wasm`) modules and external assets, it must be served over a local HTTP server (running directly from `file://` will cause CORS restrictions).

### Option 1: Using Python
```bash
# Navigate to your repository directory
cd sentrix

# Run a simple HTTP server (Python 3)
python3 -m http.server 8000
```
Open your browser and navigate to `http://localhost:8000`.

### Option 2: Using VS Code Live Server
1. Open the project folder in **VS Code**.
2. Install the **Live Server** extension.
3. Click **Go Live** at the bottom status bar or right-click `index.html` → **Open with Live Server**.

---

## 🛠️ Built With

* **Core Logic:** C++ / WebAssembly (Emscripten)
* **Frontend:** HTML5, CSS3, JavaScript (ES6+)
* **3D Engine:** [CesiumJS](https://cesium.com/platform/cesiumjs/)
