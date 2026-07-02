# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This repository is a research project for hand-tracking-based interaction. It contains multiple independent **environment variants** (`env-1` through `env-4`) representing iterative prototypes, plus a `frontend/` (React + Vite) and a `backend/` (FastAPI) that are scaffolded but currently thin.

All `env-*` environments are **static HTML/CSS/JS** — no build step. They require a local HTTP server to work (ES Modules cannot load from `file://`).

## Running the Environments

Each environment is standalone. Start any one with:

```bash
cd env-4          # or env-1, env-2, env-3
python -m http.server 8080
# Open http://localhost:8080
```

There is no build, lint, or test command for the `env-*` environments.

## Running the Frontend (React / Vite)

```bash
cd frontend
npm install
npm run dev       # starts at http://localhost:3000
npm run build
npm run preview
```

`VITE_API_URL` in `frontend/.env.local` points to the backend (`http://localhost:8000`).

## Running the Backend (FastAPI)

```bash
cd backend
.\venv\Scripts\activate      # Windows PowerShell
pip install -r requirements.txt
uvicorn main:app --reload    # starts at http://localhost:8000
```

The backend currently only serves health-check endpoints (`/` and `/api/health`). CORS is open to `http://localhost:5173`.

## Architecture

### env-* Environments (Active Prototype Work)

Each environment follows the same three-module pattern:

| File | Class | Role |
|------|-------|------|
| `js/handTracking.js` | `HandTracker` | MediaPipe initialization, webcam, `detectHands()`, landmark smoothing |
| `js/gestures.js` | `GestureRecognizer` | FIST/OPEN gesture detection, palm center, hysteresis |
| `js/main.js` | `HandGridController` | Grid/object management, grab/drop, contamination scoring, experiment protocol, draw loop |

Entry point: `index.html` loads `js/main.js` as `<script type="module">`. MediaPipe is dynamically imported from `esm.sh` CDN at runtime — no local install needed.

**Per-frame data flow:**
```
HandTracker.detectHands()
  → per hand: { landmarks, worldLandmarks, handedness }
    → GestureRecognizer.recognize()
      → { gesture: FIST/OPEN/NONE, palmCenter, isBack }
    → processHands() — grab/drop/pipette
    → updateContamination()
    → checkProtocolStep()
    → drawHandLandmarks()
```

### Coordinate System

- Camera video is displayed mirror-flipped via CSS `scaleX(-1)`.
- `getCellIndex(x, y)` receives normalized coordinates and **inverts x** (`flippedX = 1 - x`) before mapping to grid cell index.
- `worldLandmarks` (meter-scale 3D) are used only for front/back-of-hand detection via palm normal z.

### Differences Between Environments

| Env | MediaPipe model | Notable features |
|-----|----------------|-----------------|
| env-1 | Hand Landmarker | Three.js 3D particle effects, no grid |
| env-2 | Hand Landmarker | Grid + grab/drop, basic contamination |
| env-3 | **Holistic** (hand + full-body pose) | Adds pose wrist to contamination scoring |
| env-4 | Hand Landmarker only | Adds **pipette object** (aspirate/dispense); lighter than env-3 |

### Experiment Protocol (env-3 / env-4)

Active only when grid is **3×3** and experiment mode is ON.

- Objects start at cells 6, 7, 8 (bottom row).
- Phase 1: move 6→3, 7→4, 8→5 in order.
- Phase 2: move 3→6, 4→7, 5→8 in order.
- Any out-of-order drop triggers `PhaseFailed`; reset requires page restart.
- Each object tracks its origin via `dataset.initialCell`.

### env-4 Pipette (env-4 specific)

- Pipette image fixed to upper-right 3×2 cells, displayed landscape.
- Aspirate condition: thumbs-up-like pose with palm center overlapping the pipette tip, excluding pinch gestures (`pipetteSuckPoseOk()`).
- Liquid level 0–100; at ≥99.5 ("full"), liquid is dispensed into the box at the pipette mouth.

### Frontend (React)

`frontend/` is a React + Three.js + `@react-three/fiber` scaffold built with Vite. The `HAND_CONNECTIONS` and `JOINT_COLORS` constants in `frontend/constants.ts` define the 21-landmark hand skeleton used for rendering.

## Known Issues / Caveats

- `main.js` in env-3/env-4 contains `fetch('http://127.0.0.1:7242/...')` debug logging calls. These fail silently if no local log server is running, but should be removed before any production use.
- `smoothingFactor = 1.0` in env-4's `HandTracker` means landmark smoothing is effectively disabled. Values of 0.6–0.85 reduce jitter.
