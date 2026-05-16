import test from 'node:test';
import assert from 'node:assert/strict';
import { pickCombatFeedback } from '../src/game/feedback.js';

test('prioritizes perfect defense feedback over generic blocked hits', () => {
  const feedback = pickCombatFeedback([
    { type: 'player-blocked-hit' },
    { type: 'perfect-defense' }
  ]);

  assert.equal(feedback?.text, '完美防御');
  assert.equal(feedback?.playerFlash, 'guard');
  assert.equal((feedback?.screenShake ?? 0) > 0, true);
});

test('surfaces attack-hit feedback with boss flash emphasis', () => {
  const feedback = pickCombatFeedback([
    { type: 'attack-hit' }
  ]);

  assert.equal(feedback?.text, '节拍命中');
  assert.equal(feedback?.bossFlash, 'hit');
  assert.equal(feedback?.playerFlash, 'none');
});

test('falls back to projectile pressure feedback when no higher-priority event exists', () => {
  const feedback = pickCombatFeedback([
    { type: 'projectiles-fired' }
  ]);

  assert.equal(feedback?.text, '规避弹幕');
  assert.equal(feedback?.tone, 'warning');
});

test('surfaces boss self damage above generic attack warnings', () => {
  const feedback = pickCombatFeedback([
    { type: 'projectiles-fired' },
    { type: 'boss-self-hit' }
  ]);

  assert.equal(feedback?.text, '反噬命中');
  assert.equal(feedback?.bossFlash, 'hit');
});

test('reports charge pressure as a warning cue', () => {
  const feedback = pickCombatFeedback([
    { type: 'boss-charged' }
  ]);

  assert.equal(feedback?.text, '冲撞压制');
  assert.equal(feedback?.tone, 'warning');
});

test('reports direct boss attack pressure as warning cues', () => {
  const laserFeedback = pickCombatFeedback([
    { type: 'boss-laser' }
  ]);
  const sweepFeedback = pickCombatFeedback([
    { type: 'boss-sweep' }
  ]);

  assert.equal(laserFeedback?.text, '光束锁定');
  assert.equal(laserFeedback?.tone, 'warning');
  assert.equal(sweepFeedback?.text, '近身扫击');
  assert.equal(sweepFeedback?.tone, 'warning');
});

test('surfaces graze feedback below direct combat events', () => {
  const grazeFeedback = pickCombatFeedback([
    { type: 'near-graze' }
  ]);

  assert.equal(grazeFeedback?.text, '极限擦弹');
  assert.equal(grazeFeedback?.tone, 'success');

  const hitFeedback = pickCombatFeedback([
    { type: 'near-graze' },
    { type: 'player-hit' }
  ]);

  assert.equal(hitFeedback?.text, '注意规避');
});
