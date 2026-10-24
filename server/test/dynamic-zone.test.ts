import { describe, it, expect } from 'vitest';

describe('Dynamic Zone Shrinking Calculation and Limits', () => {
  it('correctly calculates new radius using the authoritative formula: max(minR, currentR * (1 - shrinkPct / 100))', () => {
    let currentR = 1000;
    const shrinkPct = 20; // 20%
    const minR = 100;

    // Formula progression:
    // 1st: 1000 * 0.8 = 800
    currentR = Math.max(minR, Math.round(currentR * (1 - shrinkPct / 100)));
    expect(currentR).toBe(800);

    // 2nd: 800 * 0.8 = 640
    currentR = Math.max(minR, Math.round(currentR * (1 - shrinkPct / 100)));
    expect(currentR).toBe(640);

    // 3rd: 640 * 0.8 = 512
    currentR = Math.max(minR, Math.round(currentR * (1 - shrinkPct / 100)));
    expect(currentR).toBe(512);

    // 4th: 512 * 0.8 = 410
    currentR = Math.max(minR, Math.round(currentR * (1 - shrinkPct / 100)));
    expect(currentR).toBe(410);
  });

  it('strictly stops shrinking when minimum radius is reached', () => {
    let currentR = 120;
    const shrinkPct = 25; // 25% of 120 = 30 -> 90, but minR is 100
    const minR = 100;

    currentR = Math.max(minR, Math.round(currentR * (1 - shrinkPct / 100)));
    expect(currentR).toBe(100);

    // Further shrinking should not decrease below 100
    currentR = Math.max(minR, Math.round(currentR * (1 - shrinkPct / 100)));
    expect(currentR).toBe(100);
  });
});
