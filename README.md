# I-Pilot

A web-based eye-gaze interaction system with **semantic element snapping** and **blink-confirmed selection**. An ordinary webcam estimates where you are looking, the page's DOM is read to find the interactive element you most likely mean, and a deliberate slow blink activates it. All video is processed on the device: no frames are stored or uploaded, and the MediaPipe model and WASM are self-hosted.

It ships in two forms:

- **Demo app** (React 18 + TypeScript + Vite + Tailwind): calibration, demo pages, settings, an evaluation study runner and a results dashboard.
- **Chrome extension** (Manifest V3): runs the same pipeline on any website.

## Quick start

```bash
npm install
npm run dev          # http://localhost:5173 (downloads the face model once)
```

1. **Start camera** → **Calibrate**: follow the dot with your eyes (about 30 s, including a blink check).
2. Look at a link or button until it is outlined, then **close your eyes slowly for about half a second and open them** to click it. Normal blinks are ignored.
3. With no webcam, use **Simulate with mouse**: the mouse is your gaze, holding **Shift** for at least 500 ms and releasing it is a slow blink, and moving the mouse out of the window counts as looking away. You can add simulated webcam noise under *Settings → Mouse simulation*.

Keyboard (for a helper): `Alt+Shift+P` pauses or resumes, and `Esc` closes dialogs.

## Pipeline (synopsis §6)

| # | Stage | Code |
|---|-------|------|
| 1 | Camera capture (`getUserMedia`, secure context) | `src/core/input/mediapipe.ts` |
| 2 | Face & iris landmarks, blink blendshapes, head pose (MediaPipe Face Landmarker) | `src/core/input/mediapipe.ts`, `src/core/gaze/features.ts` |
| 3 | Gaze estimation: ridge regression from 14 iris/blendshape/head-pose features to screen coordinates | `src/core/gaze/regression.ts`, `src/core/gaze/calibration.ts` |
| 4 | Smoothing: One Euro filter | `src/core/filters/oneEuro.ts` |
| 5 | Fixation detection: online I-DT, landing after about 200 ms within 90 px | `src/core/fixation/idt.ts` |
| 6 | Target resolver: DOM candidates (semantic + ARIA + `cursor:pointer`), Gaussian-overlap scoring, size and type weights, hysteresis, ambiguity detection, canvas grid fallback | `src/core/targets/` |
| 7 | Blink detector (deliberate is 500–2000 ms; natural blinks are ignored) and TRACKING / LOCKED / PAUSED state machine | `src/core/blink/`, `src/core/engine/stateMachine.ts` |
| 8 | Action executor (full pointer/mouse event sequence) and shadow-DOM overlay | `src/core/engine/actions.ts`, `src/core/overlay/` |

`src/core/engine/engine.ts` wires stages 4–8 together. The core is framework-free TypeScript, so the extension reuses it unchanged.

### Design principles (synopsis §5)

- **Landing-based selection**: the highlight moves only when a fixation lands, not continuously.
- **Semantic snapping**: the element containing the point wins. Otherwise the target is the candidate with the most probability mass under a Gaussian gaze-error model (σ comes from the calibration's measured error). Clickable containers give way to the controls inside them.
- **Close-target disambiguation**: if the runner-up scores more than 70 % of the winner, both are numbered on the page. Selecting then opens a chooser with large, widely spaced tiles. Hysteresis (1.4×) stops the lock flipping on small drift.
- **Blink-confirmed activation**: the target is latched when the eyes start to close. A closure of 500–2000 ms clicks it (or double-clicks, if configured) when the eyes reopen. A progress ring turns green once the blink is long enough.
- **Off-screen handling**: if the face is lost, or the median of recent gaze samples leaves the screen for more than 400 ms, I-Pilot moves to PAUSED. It fires no events and keeps the last highlight. It resumes once the face is back and the gaze has been on screen and roughly steady for 400 ms (at most 1.2 s, so noisy webcams don't get stuck). You then look at a target again to select it.
- **Learning from selections**: each confirmed, unambiguous selection of a compact target adds the features from the fixation just before it to the gaze model, labelled with the target's centre, and refits. This corrects drift from head movement as you use it. It can be turned off in Settings.
- **Calibration tuning**: calibration uses 13 points and keeps frames where the eyelids are lowered from looking down. It sets the eye-closed threshold above anything open eyes produced, and sets the fixation radius from the measured gaze jitter.
- **Fallbacks and safety**: a dwell mode (1 s) for users who can't blink deliberately. Dwell fires once per look, so you look away to repeat. Delete, pay and submit actions need a confirmation. A `<select>` becomes a gaze chooser, and text fields open a gaze keyboard. The on-screen toolbar has Pause/Resume, Scroll and Back.

Page authors can opt elements in or out with `data-ipilot-target`, `data-ipilot-ignore`, `data-ipilot-danger` and `data-ipilot-safe`.

## Evaluation (synopsis §9)

**Study** runs each participant through conditions **A** (raw gaze cursor + dwell), **B** (snapping + dwell) and **C** (snapping + blink) in a Latin-square order. The tasks are pointing at 18 targets in three sizes, a two-level menu, a short form, a 60 s natural-reading task that counts false triggers, and the SUS questionnaire.

**Results** reports, per condition:

- selection time
- wrong-selection rate
- corrections per trial
- false blink triggers per minute
- trigger→action latency (mean and p95)
- SUS score
- calibration accuracy in px and degrees

You can export the data as JSON or CSV, or send it to the optional log server. Logs hold only an anonymous participant code, timings and counts.

```bash
npm run server       # optional collector on http://localhost:8787 → server/data/sessions.jsonl
```

Set its URL under *Settings → Calibration & data*.

## Chrome extension

```bash
npm run build:ext    # → dist-extension/
```

To install it, open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked** and choose `dist-extension/`. Then switch I-Pilot on from the toolbar popup and choose **Calibrate on this page**. On the first run a tab asks for camera permission once.

The camera runs in a single offscreen document (`MediaStreamTrackProcessor`, so it keeps working while hidden). That document reduces each frame to a 14-number feature vector plus blink scores and streams it to the visible tab's content script. The content script holds the calibration and runs stages 3–8 against that page's DOM. One calibration, stored in `chrome.storage`, is shared by all tabs.

## Tests

```bash
npm test             # Vitest unit tests: filter, I-DT, blink, regression, scoring, state machine, metrics
npm run e2e          # Playwright in installed Chrome, with simulated gaze + fake camera
npm run e2e:ext      # extension test; needs `npx playwright install chromium`
```

## Deployment

The app needs HTTPS for camera access. Run `npm run build` and serve `dist/`. For GitHub Pages under a sub-path, build with `VITE_BASE=/repo-name/ npm run build`. Routing is hash-based, so no server rewrites are needed.

## Scope notes and limitations

- Accuracy depends on lighting, camera quality, glasses glare and head movement, so a stable setup is assumed. Calibration is in screen coordinates and assumes 100 % browser zoom.
- Cross-origin iframes and canvases expose no elements, so a coarse grid fallback is used there. Same-origin iframes are searched normally.
- Gaze estimation uses a custom ridge regression over MediaPipe features. A WebGazer.js comparison model (synopsis §7) is not included, and neither is remote control over WebSocket.
- Signal processing (filter, I-DT, scoring) runs on the main thread, where it takes microseconds per frame. In the extension, MediaPipe inference already runs off the page in the offscreen document.
