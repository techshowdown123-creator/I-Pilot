import { describe, expect, it } from 'vitest';
import { checkPose, medianPose, poseFromLandmarks, type HeadPose } from '../../src/core/gaze/headPose';

const ref: HeadPose = { cx: 0.5, cy: 0.24, iod: 0.11, roll: 0, yaw: 0, pitch: 0 };

describe('head pose from landmarks', () => {
  it('measures position, size and tilt from the outer eye corners', () => {
    const lm = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5 }));
    // 1280×720 frame, eye corners at (580, 300) and (720, 314): 140.7 px apart, tilted ~5.7°.
    lm[33] = { x: 580 / 1280, y: 300 / 720 };
    lm[263] = { x: 720 / 1280, y: 314 / 720 };
    const f = new Array(16).fill(0);
    f[8] = 0.05;
    f[9] = -0.02;
    const p = poseFromLandmarks(lm, 1280, 720, f)!;
    expect(p.cx).toBeCloseTo(650 / 1280, 6);
    expect(p.cy).toBeCloseTo(307 / 1280, 6); // y in image-width units
    expect(p.iod).toBeCloseTo(Math.hypot(140, 14) / 1280, 6);
    expect((p.roll * 180) / Math.PI).toBeCloseTo(5.71, 1);
    expect(p.yaw).toBe(0.05);
    expect(p.pitch).toBe(-0.02);
  });

  it('takes the median of each part over many frames', () => {
    const m = medianPose([ref, { ...ref, cx: 0.52 }, { ...ref, cx: 0.9 }])!;
    expect(m.cx).toBe(0.52);
  });
});

describe('position check against where you calibrated', () => {
  it('is fine within about 3 cm, 8% distance and 6°', () => {
    expect(checkPose({ ...ref, cx: ref.cx + 0.03, iod: 0.115, roll: 0.05 }, ref).ok).toBe(true);
  });

  it('says which way to move, in your own left/right (the camera sees you mirrored)', () => {
    // Face further right in the image = you moved to your left.
    expect(checkPose({ ...ref, cx: ref.cx + 0.06 }, ref).hints).toEqual(['Move a little to your right']);
    expect(checkPose({ ...ref, cx: ref.cx - 0.06 }, ref).hints).toEqual(['Move a little to your left']);
    expect(checkPose({ ...ref, cy: ref.cy + 0.06 }, ref).hints).toEqual(['Raise your head a little']);
    expect(checkPose({ ...ref, cy: ref.cy - 0.06 }, ref).hints).toEqual(['Lower your head a little']);
  });

  it('notices leaning in or out, tilting and turning', () => {
    expect(checkPose({ ...ref, iod: 0.13 }, ref).hints[0]).toBe('Lean back a little');
    expect(checkPose({ ...ref, iod: 0.095 }, ref).hints[0]).toBe('Come a little closer');
    expect(checkPose({ ...ref, roll: 0.2 }, ref).hints[0]).toMatch(/level/);
    expect(checkPose({ ...ref, yaw: 0.2 }, ref).hints[0]).toMatch(/straight on/);
    // Against the default (not recorded) spot, turning isn't judged.
    expect(checkPose({ ...ref, yaw: 0.2 }, ref, false).ok).toBe(true);
  });

  it('measures shifts relative to face size, so it works at any distance', () => {
    const far = { ...ref, iod: 0.06 };
    // 0.03 of the image is half an eye-corner width when far away: too much.
    expect(checkPose({ ...far, cx: far.cx + 0.03 }, far).ok).toBe(false);
    // The same 0.03 is under a third of an eye-corner width when close: fine.
    const near = { ...ref, iod: 0.16 };
    expect(checkPose({ ...near, cx: near.cx + 0.03 }, near).ok).toBe(true);
  });
});
