import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createBehaviorPlan,
  getBehaviorAtTime,
  type MusicSegmentInput
} from '../src/core/behavior.js';

test('maps calm and intense music segments to distinct boss skill modules', () => {
  const segments: MusicSegmentInput[] = [
    { start: 0, end: 10, label: 'verse', energy: 0.25 },
    { start: 10, end: 20, label: 'chorus', energy: 0.85 },
    { start: 20, end: 30, label: 'drop', energy: 0.95 }
  ];

  const plan = createBehaviorPlan(segments, 120, 1);

  assert.equal(plan[0].movement, 'keep-distance');
  assert.equal(plan[0].attack, 'melee-sweep');
  assert.equal(plan[1].movement, 'chase');
  assert.equal(plan[1].attack, 'melee-sweep');
  assert.equal(plan[2].movement, 'shake');
  assert.equal(['charge-strike', 'charge-sweep'].includes(plan[2].attack), true);
  assert.equal(getBehaviorAtTime(plan, 15).label, 'chorus');
});

test('scales bullet density by segment intensity and difficulty', () => {
  const segment: MusicSegmentInput = { start: 0, end: 8, label: 'chorus', energy: 0.82 };
  const low = createBehaviorPlan([segment], 120, 0.5);
  const high = createBehaviorPlan([segment], 120, 1.8);

  assert.equal(low[0].bulletCount < high[0].bulletCount, true);
  assert.equal(low[0].bulletSpeed < high[0].bulletSpeed, true);
  assert.equal(high[0].warningIntensity > low[0].warningIntensity, true);
});

test('returns a safe idle behavior before the first scheduled segment starts', () => {
  const plan = createBehaviorPlan([
    { start: 4, end: 12, label: 'chorus', energy: 0.82 }
  ], 120, 1);

  const behavior = getBehaviorAtTime(plan, 1);

  assert.equal(behavior.attack, 'none');
  assert.equal(behavior.movement, 'idle');
  assert.equal(behavior.label, 'intro');
});
