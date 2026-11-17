/**
 * Face-position guide. The gaze model is learned at the head position used
 * while calibrating; moving away from it (sideways, closer/further, tilting,
 * turning) shifts every estimate. So the head position is recorded during
 * calibration, and the current one is compared with it, with plain hints for
 * getting back.
 *
 * Positions are in units of the camera image WIDTH for both x and y (so they
 * keep their proportions whatever the aspect ratio), unmirrored: the person's
 * left is the image's right.
 */

export interface HeadPose {
  /** Midpoint between the outer eye corners (image px ÷ image width). */
  cx: number;
  cy: number;
  /** Outer-eye-corner distance ÷ image width: bigger means closer to the camera. */
  iod: number;
  /** Tilt of the line through the eye corners, radians. */
  roll: number;
  /** Head turn and nod from MediaPipe's head-pose matrix, radians. */
  yaw: number;
  pitch: number;
}

/** A sensible spot before any calibration: centred, about an arm's length away. */
export const DEFAULT_POSE: HeadPose = { cx: 0.5, cy: 0.24, iod: 0.11, roll: 0, yaw: 0, pitch: 0 };

/**
 * How far you may move before accuracy suffers noticeably: about 3 cm
 * sideways (0.35 eye-corner widths), 8% in distance (~5 cm at arm's length),
 * 6° of tilt or turn.
 */
export const POSE_TOLERANCE = { shift: 0.35, scale: 0.08, angle: (6 * Math.PI) / 180 };

/** Head pose from MediaPipe face landmarks (normalised) and the gaze feature vector (yaw at 8, pitch at 9). */
export function poseFromLandmarks(lm: { x: number; y: number }[], W: number, H: number, features: number[]): HeadPose | null {
  if (!lm || lm.length < 468 || !(W > 0) || !(H > 0)) return null;
  const a = { x: lm[33].x * W, y: lm[33].y * H };
  const b = { x: lm[263].x * W, y: lm[263].y * H };
  const iodPx = Math.hypot(b.x - a.x, b.y - a.y);
  if (!(iodPx > 1)) return null;
  const [l, r] = a.x <= b.x ? [a, b] : [b, a];
  return {
    cx: (a.x + b.x) / 2 / W,
    cy: (a.y + b.y) / 2 / W,
    iod: iodPx / W,
    roll: Math.atan2(r.y - l.y, r.x - l.x),
    yaw: Number.isFinite(features[8]) ? features[8] : 0,
    pitch: Number.isFinite(features[9]) ? features[9] : 0,
  };
}

/** Median of each component (robust to a few bad frames). */
export function medianPose(poses: HeadPose[]): HeadPose | null {
  if (!poses.length) return null;
  const med = (k: keyof HeadPose) => {
    const s = poses.map((p) => p[k]).sort((x, y) => x - y);
    return s[Math.floor(s.length / 2)];
  };
  return { cx: med('cx'), cy: med('cy'), iod: med('iod'), roll: med('roll'), yaw: med('yaw'), pitch: med('pitch') };
}

export interface PoseCheck {
  ok: boolean;
  /** What to do, most important first, in the person's own left/right. */
  hints: string[];
  /** Offsets from the reference, in eye-corner widths. */
  dx: number;
  dy: number;
  /** Current size ÷ reference size (> 1: closer). */
  scale: number;
}

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * Compare the current head pose with the reference. `checkAngles` is false
 * for the default reference (turn/nod are only meaningful against a recorded one).
 */
export function checkPose(cur: HeadPose, ref: HeadPose, checkAngles = true): PoseCheck {
  const t = POSE_TOLERANCE;
  const dx = (cur.cx - ref.cx) / ref.iod;
  const dy = (cur.cy - ref.cy) / ref.iod;
  const scale = cur.iod / ref.iod;
  const hints: string[] = [];
  if (scale > 1 + t.scale) hints.push('Lean back a little');
  else if (scale < 1 - t.scale) hints.push('Come a little closer');
  // The camera sees you mirrored: moving to your left moves your face to the image's right.
  if (dx > t.shift) hints.push('Move a little to your right');
  else if (dx < -t.shift) hints.push('Move a little to your left');
  if (dy > t.shift) hints.push('Raise your head a little');
  else if (dy < -t.shift) hints.push('Lower your head a little');
  if (Math.abs(wrap(cur.roll - ref.roll)) > t.angle) hints.push('Keep your head level (don’t tilt it)');
  if (checkAngles && (Math.abs(wrap(cur.yaw - ref.yaw)) > t.angle || Math.abs(wrap(cur.pitch - ref.pitch)) > t.angle))
    hints.push('Face the screen straight on, as when you calibrated');
  return { ok: hints.length === 0, hints, dx, dy, scale };
}
