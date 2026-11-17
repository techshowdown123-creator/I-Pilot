# I-Pilot

A web-based eye-gaze interaction system with **semantic element snapping** and **blink-confirmed selection**. An ordinary webcam estimates where you are looking, the page's DOM is read to find the interactive element you most likely mean, and a deliberate slow blink activates it. All video is processed on the device: no frames are stored or uploaded, and the MediaPipe model and WASM are self-hosted.

- **Live demo:** https://ipilot-kappa.vercel.app/
- **Project report:** [report/IPilot_Project_Report.pdf](report/IPilot_Project_Report.pdf)

It ships in two forms:

- **Website** (React 18 + TypeScript + Vite + Tailwind) with two steps: **1 · Calibrate** (camera preview, blink check, dots) and **2 · Play**, the eye-controlled game *Lantern Drift*.
- **Chrome extension** (Manifest V3): runs the full selection pipeline on any website.

## Quick start

```bash
npm install
npm run dev          # http://localhost:5173 (downloads the face model once)
```

1. **Start camera** → **Calibrate** (about 30 s): a blink check, then follow the dot with your eyes.
2. **Play Lantern Drift**: look at *Start* and **close your eyes slowly for about half a second**, then steer the lantern by looking higher or lower. Normal blinks are ignored.
3. If the gaze drifts, recalibrate.

Keyboard (for a helper): `Alt+Shift+P` pauses or resumes. For development without a webcam, open `http://localhost:5173/?sim#/game`: the mouse is the eye and holding **Shift** for at least 500 ms is a slow blink.

## Pipeline (synopsis §6)

| # | Stage | Code |
|---|-------|------|
| 1 | Camera capture (`getUserMedia`, secure context) | `src/core/input/mediapipe.ts` |
| 2 | Face & iris landmarks, blink blendshapes, head pose (MediaPipe Face Landmarker) | `src/core/input/mediapipe.ts`, `src/core/gaze/features.ts` |
| 3 | Gaze estimation: ridge regression from 16 iris, blendshape, head-pose and eyelid features to screen coordinates, fitted at calibration | `src/core/gaze/regression.ts`, `src/core/gaze/calibration.ts` |
| 4 | Smoothing: One Euro filter | `src/core/filters/oneEuro.ts` |
| 5 | Fixation detection: online I-DT, landing after about 200 ms within 90 px | `src/core/fixation/idt.ts` |
| 6 | Target resolver: DOM candidates (semantic + ARIA + `cursor:pointer`), Gaussian-overlap scoring, size and type weights, hysteresis, ambiguity detection, canvas grid fallback | `src/core/targets/` |
| 7 | Blink detector (deliberate is 500–2000 ms; natural blinks are ignored) and TRACKING / LOCKED / PAUSED state machine | `src/core/blink/`, `src/core/engine/stateMachine.ts` |
| 8 | Action executor (full pointer/mouse event sequence) and shadow-DOM overlay | `src/core/engine/actions.ts`, `src/core/overlay/` |

`src/core/engine/engine.ts` wires stages 4–8 together. The core is framework-free TypeScript, so the extension reuses it unchanged. On the website, stages 6–8 select the game's buttons; during play the engine runs in gaze-only mode.

### Design principles (synopsis §5)

- **Landing-based selection**: the highlight moves only when a fixation lands, not continuously.
- **Semantic snapping**: the element containing the point wins. Otherwise the target is the candidate with the most probability mass under a Gaussian gaze-error model (σ comes from the calibration's measured error). Clickable containers give way to the controls inside them.
- **Close-target disambiguation**: if the runner-up scores more than 70 % of the winner, both are numbered on the page. Selecting then opens a chooser with large, widely spaced tiles. Hysteresis (1.25×) stops the lock flipping on small drift, gaze clearly inside another element switches at once, and small eye movements inside one fixation (about 25 px or more) re-check the target so the lock follows steps to the next option.
- **Blink-confirmed activation**: the target is latched when the eyes start to close. A closure of 500–2000 ms clicks it (or double-clicks, if configured) when the eyes reopen. A progress ring turns green once the blink is long enough.
- **Off-screen handling**: if the face is lost, or the median of recent gaze samples leaves the screen for more than 400 ms, I-Pilot moves to PAUSED. It fires no events and keeps the last highlight. It resumes once the face is back and the gaze has been on screen and roughly steady for 400 ms (at most 1.2 s, so noisy webcams don't get stuck). You then look at a target again to select it.
- **Learning from selections**: each confirmed, unambiguous selection of a compact target adds the features from the fixation just before it to the gaze model, labelled with the target's centre, and refits. This corrects drift from head movement as you use it. It can be turned off in the settings (`learnFromSelections`).
- **Calibration tuning**: calibration uses 13 points and keeps frames where the eyelids are lowered from looking down. It sets the eye-closed threshold above anything open eyes produced, and sets the fixation radius from the measured gaze jitter.
- **Fallbacks and safety**: a dwell mode (1 s) for users who can't blink deliberately. Dwell fires once per look, so you look away to repeat. Delete, pay and submit actions need a confirmation. A `<select>` becomes a gaze chooser, and text fields open a gaze keyboard. The on-screen toolbar has Pause/Resume, Scroll and Back.

Page authors can opt elements in or out with `data-ipilot-target`, `data-ipilot-ignore`, `data-ipilot-danger` and `data-ipilot-safe`.

## Lantern Drift (eye-controlled game)

**2 · Play** is a side-scroller steered only by gaze: the lantern follows the height you look at, and you guide it through gaps between bamboo stalks. Gaps narrow and speed rises as you score. While you play, I-Pilot runs in gaze-only mode (no snapping or clicks). The game pauses with I-Pilot when your face is lost or you look away. Start and *Play again* are pressed with a look and a slow blink. Easy / Normal / Hard set the gap size and speed.

## Chrome extension

```bash
npm run build:ext    # → dist-extension/
```

To install it, open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked** and choose `dist-extension/`. Then switch I-Pilot on from the toolbar popup and choose **Calibrate on this page**. On the first run a tab asks for camera permission once.

The camera runs in a single offscreen document (`MediaStreamTrackProcessor`, so it keeps working while hidden). That document reduces each frame to a 14-number feature vector plus blink scores and streams it to the visible tab's content script. The content script holds the calibration and runs stages 3–8 against that page's DOM. One calibration, stored in `chrome.storage`, is shared by all tabs.

## Tests

```bash
npm test             # Vitest unit tests: filter, I-DT, blink, gaze regression, scoring, state machine
npm run e2e          # Playwright in installed Chrome: the game with simulated gaze, the camera pipeline with a fake camera
npm run e2e:ext      # extension test; needs `npx playwright install chromium`
```

## Deployment

The app needs HTTPS for camera access. Run `npm run build` and serve `dist/`. For GitHub Pages under a sub-path, build with `VITE_BASE=/repo-name/ npm run build`. Routing is hash-based, so no server rewrites are needed.

## Scope notes and limitations

- Accuracy depends on lighting, camera quality, glasses glare and head movement, so a stable setup is assumed. Calibration is in screen coordinates and assumes 100 % browser zoom.
- Cross-origin iframes and canvases expose no elements, so a coarse grid fallback is used there. Same-origin iframes are searched normally.
- The tracking logic is the version from before target prediction and the zoom lens (commit `c2e2d46`). Later experiments are kept on git branches: `backup/prediction-zoom-lens`, `backup/full-site-3d-engine` (the 3D eye-model engine, Recentre and the full demo site) and `backup/calibrate-game-3d-engine`. A WebGazer.js comparison model (synopsis §7) is not included, and neither is remote control over WebSocket.
- Signal processing (filter, I-DT, scoring) runs on the main thread, where it takes microseconds per frame. In the extension, MediaPipe inference already runs off the page in the offscreen document.
