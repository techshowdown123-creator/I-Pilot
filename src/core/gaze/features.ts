/**
 * Turns MediaPipe Face Landmarker output (478 landmarks incl. iris, 52
 * blendshapes, facial transformation matrix) into a compact gaze feature
 * vector for the calibration regression (stage 3).
 */

export interface LM {
  x: number;
  y: number;
  z?: number;
}

export interface BlendshapeLike {
  categoryName: string;
  score: number;
}

// Eye-corner / eyelid landmark indices of the MediaPipe face mesh.
const EYE_A = { outer: 33, inner: 133, upper: 159, lower: 145 }; // subject's right eye
const EYE_B = { outer: 263, inner: 362, upper: 386, lower: 374 }; // subject's left eye
const IRIS_1 = 468; // centre of one iris (468..472)
const IRIS_2 = 473; // centre of the other iris (473..477)

export const FEATURE_NAMES = [
  'irisAx', 'irisAy', 'irisBx', 'irisBy',
  'lookAh', 'lookAv', 'lookBh', 'lookBv',
  'yaw', 'pitch', 'roll', 'headX', 'headY', 'headZ',
] as const;
export const FEATURE_COUNT = FEATURE_NAMES.length;

/** Iris position inside the eye, in an eye-aligned frame normalised by eye width. */
function irisInEye(lm: LM[], eye: typeof EYE_A, iris: LM): [number, number] {
  const o = lm[eye.outer];
  const i = lm[eye.inner];
  const cx = (o.x + i.x) / 2;
  const cy = (o.y + i.y) / 2;
  let ux = i.x - o.x;
  let uy = i.y - o.y;
  const w = Math.hypot(ux, uy) || 1e-6;
  ux /= w;
  uy /= w;
  // Vertical reference: midpoint between eyelids, so lid motion partly cancels.
  const lidMidY = (lm[eye.upper].y + lm[eye.lower].y) / 2;
  const lidMidX = (lm[eye.upper].x + lm[eye.lower].x) / 2;
  const dx = iris.x - cx;
  const dy = iris.y - cy;
  const h = (dx * ux + dy * uy) / w;
  // perpendicular axis (−uy, ux)
  const vIris = (-dx * uy + dy * ux) / w;
  const vLid = (-(lidMidX - cx) * uy + (lidMidY - cy) * ux) / w;
  return [h, vIris - vLid * 0.5];
}

function bs(shapes: BlendshapeLike[] | undefined, name: string): number {
  if (!shapes) return 0;
  for (const s of shapes) if (s.categoryName === name) return s.score;
  return 0;
}

/** Yaw/pitch/roll (radians) and translation from a column-major 4x4 matrix. */
function poseFromMatrix(m: number[] | undefined): [number, number, number, number, number, number] {
  if (!m || m.length < 16) return [0, 0, 0, 0, 0, 0];
  // column-major: element (row r, col c) = m[c*4 + r]
  const r = (row: number, col: number) => m[col * 4 + row];
  const yaw = Math.atan2(-r(2, 0), Math.hypot(r(0, 0), r(1, 0)));
  const pitch = Math.atan2(r(2, 1), r(2, 2));
  const roll = Math.atan2(r(1, 0), r(0, 0));
  return [yaw, pitch, roll, r(0, 3), r(1, 3), r(2, 3)];
}

export function extractFeatures(
  landmarks: LM[],
  blendshapes: BlendshapeLike[] | undefined,
  matrix: number[] | undefined,
): number[] {
  if (!landmarks || landmarks.length < 478) return [];
  const eyeACentre = { x: (landmarks[EYE_A.outer].x + landmarks[EYE_A.inner].x) / 2, y: (landmarks[EYE_A.outer].y + landmarks[EYE_A.inner].y) / 2 };
  const i1 = landmarks[IRIS_1];
  const i2 = landmarks[IRIS_2];
  // Assign irises to eyes by proximity rather than trusting index order.
  const d1 = Math.hypot(i1.x - eyeACentre.x, i1.y - eyeACentre.y);
  const d2 = Math.hypot(i2.x - eyeACentre.x, i2.y - eyeACentre.y);
  const [irisA, irisB] = d1 <= d2 ? [i1, i2] : [i2, i1];

  const [ax, ay] = irisInEye(landmarks, EYE_A, irisA);
  const [bx, by] = irisInEye(landmarks, EYE_B, irisB);

  // Blendshape gaze directions (subject's right = "Right").
  const lookAh = bs(blendshapes, 'eyeLookOutRight') - bs(blendshapes, 'eyeLookInRight');
  const lookAv = bs(blendshapes, 'eyeLookUpRight') - bs(blendshapes, 'eyeLookDownRight');
  const lookBh = bs(blendshapes, 'eyeLookInLeft') - bs(blendshapes, 'eyeLookOutLeft');
  const lookBv = bs(blendshapes, 'eyeLookUpLeft') - bs(blendshapes, 'eyeLookDownLeft');

  const pose = poseFromMatrix(matrix);
  return [ax, ay, bx, by, lookAh, lookAv, lookBh, lookBv, ...pose];
}

export function blinkScores(blendshapes: BlendshapeLike[] | undefined): { left: number; right: number } {
  return { left: bs(blendshapes, 'eyeBlinkLeft'), right: bs(blendshapes, 'eyeBlinkRight') };
}
