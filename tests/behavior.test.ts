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

  assert.equal(plan[0].movement, 'wander');
  assert.equal(plan[0].attack, 'sparse-ring');
  assert.equal(plan[1].movement, 'dash');
  assert.equal(plan[1].attack, 'aimed-burst');
  assert.equal(plan[2].movement, 'shake');
  assert.equal(plan[2].attack, 'screen-ring');
  assert.equal(getBehaviorAtTime(plan, 15).label, 'chorus');
});

test('scales bullet density by segment intensity and difficulty', () => {
  const low = createBehaviorPlan([{ start: 0, end: 8, label: 'verse', energy: 0.2 }], 120, 0.5);
  const high = createBehaviorPlan([{ start: 0, end: 8, label: 'chorus', energy: 1 }], 120, 1.5);

  assert.equal(low[0].bulletCount < high[0].bulletCount, true);
  assert.equal(high[0].warningIntensity > low[0].warningIntensity, true);
});
