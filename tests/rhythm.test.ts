import test from 'node:test';
import assert from 'node:assert/strict';
import { createRhythmTracker } from '../src/core/rhythm.js';

test('judges actions against a stable beat grid and updates combo stats', () => {
  const rhythm = createRhythmTracker({ bpm: 120, firstBeat: 0, duration: 30 });

  const perfect = rhythm.judge(1.01, 'attack');
  assert.equal(perfect.rank, 'perfect');
  assert.equal(perfect.damageMultiplier, 2);
  assert.equal(perfect.scoreBonus, 100);

  const good = rhythm.judge(1.16, 'dash');
  assert.equal(good.rank, 'good');
  assert.equal(good.damageMultiplier, 1.2);
  assert.equal(good.scoreBonus, 50);

  const miss = rhythm.judge(1.26, 'block');
  assert.equal(miss.rank, 'miss');
  assert.equal(miss.damageMultiplier, 1);

  assert.deepEqual(rhythm.getStats(), {
    perfect: 1,
    good: 1,
    miss: 1,
    actions: 3,
    combo: 0,
    maxCombo: 2,
    accuracy: 50
  });
});

test('reports upcoming beat timing for visual and attack scheduling', () => {
  const rhythm = createRhythmTracker({ bpm: 100, firstBeat: 0.1, duration: 20 });

  assert.equal(rhythm.isOnBeat(0.1), true);
  assert.equal(rhythm.isOnBeat(0.35), false);
  assert.ok(Math.abs(rhythm.timeToNextBeat(0.4) - 0.3) < 0.00001);
});

test('uses detected beat grid before the derived metronome phase', () => {
  const rhythm = createRhythmTracker({
    bpm: 120,
    firstBeat: 0,
    duration: 8,
    beatGrid: [0.18, 0.69, 1.17, 1.68]
  });

  assert.equal(rhythm.isOnBeat(1.17), true);
  assert.equal(rhythm.isOnBeat(1), false);
  assert.ok(Math.abs(rhythm.timeToNextBeat(1.18) - 0.5) < 0.00001);
});
