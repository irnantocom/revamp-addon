// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { fitWithin, frameTimes, MAX_PASSTHROUGH_BYTES, needsReencode } from '../src/utils/media-processing';

describe('fitWithin', () => {
  it('shrinks the longest edge to the limit and keeps the aspect ratio', () => {
    expect(fitWithin(4000, 2000, 1000)).toEqual({ width: 1000, height: 500 });
    expect(fitWithin(2000, 4000, 1000)).toEqual({ width: 500, height: 1000 });
  });

  it('never enlarges', () => {
    expect(fitWithin(500, 300, 1000)).toEqual({ width: 500, height: 300 });
  });

  it('never produces a zero-sized side', () => {
    expect(fitWithin(1, 5000, 100).width).toBe(1);
  });
});

describe('frameTimes', () => {
  it('takes one frame from the middle of each equal slice', () => {
    expect(frameTimes(60, 6)).toEqual([5, 15, 25, 35, 45, 55]);
  });

  it('falls back to the first frame when the duration is unknown or zero', () => {
    expect(frameTimes(0, 6)).toEqual([0]);
    expect(frameTimes(NaN, 6)).toEqual([0]);
    expect(frameTimes(Infinity, 6)).toEqual([0]);
  });

  it('returns at most `count` times, all inside the clip', () => {
    const times = frameTimes(2, 6);
    expect(times).toHaveLength(6);
    expect(times.every((t) => t >= 0 && t <= 2)).toBe(true);
  });
});

describe('needsReencode', () => {
  it('keeps a small image that fits as it is', () => {
    expect(needsReencode('image/png', 100_000, true)).toBe(false);
    expect(needsReencode('image/jpeg', 100_000, true)).toBe(false);
  });

  it('re-encodes an image that has to be resized', () => {
    expect(needsReencode('image/jpeg', 100_000, false)).toBe(true);
  });

  it('always re-encodes a GIF (Gemini does not take GIFs and OpenAI only still ones)', () => {
    expect(needsReencode('image/gif', 100, true)).toBe(true);
  });

  it('re-encodes an image too big for Claude\'s 5 MB limit even when its pixel size fits', () => {
    expect(needsReencode('image/png', MAX_PASSTHROUGH_BYTES + 1, true)).toBe(true);
    expect(needsReencode('image/png', MAX_PASSTHROUGH_BYTES, true)).toBe(false);
  });
});
