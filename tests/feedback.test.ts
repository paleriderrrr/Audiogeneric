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
  const laserBlastFeedback = pickCombatFeedback([
    { type: 'boss-laser-blast' }
  ]);
  const sweepFeedback = pickCombatFeedback([
    { type: 'boss-sweep' }
  ]);

  assert.equal(laserFeedback?.text, '光束锁定');
  assert.equal(laserFeedback?.tone, 'warning');
  assert.equal(laserBlastFeedback?.text, '光束贯穿');
  assert.equal(laserBlastFeedback?.tone, 'warning');
  assert.equal(sweepFeedback?.text, '近身扫击');
  assert.equal(sweepFeedback?.tone, 'warning');
});

test('reports area warnings and area blasts distinctly', () => {
  const warningFeedback = pickCombatFeedback([
    { type: 'boss-area-warning' }
  ]);
  const blastFeedback = pickCombatFeedback([
    { type: 'boss-area-blast' }
  ]);

  assert.equal(warningFeedback?.text, '范围预警');
  assert.equal(warningFeedback?.tone, 'warning');
  assert.equal(blastFeedback?.text, '范围爆发');
  assert.equal(blastFeedback?.tone, 'warning');
  assert.equal((blastFeedback?.screenShake ?? 0) > (warningFeedback?.screenShake ?? 0), true);
});

test('surfaces beat-synced player actions as light feedback', () => {
  const attackFeedback = pickCombatFeedback([
    { type: 'player-attack' },
    { type: 'player-attack-beat' }
  ]);
  const dashFeedback = pickCombatFeedback([
    { type: 'player-dash' },
    { type: 'player-dash-beat' }
  ]);
  const blockFeedback = pickCombatFeedback([
    { type: 'player-block' },
    { type: 'player-block-beat' }
  ]);

  assert.equal(attackFeedback?.text, '攻击同步');
  assert.equal(attackFeedback?.tone, 'success');
  assert.equal(attackFeedback?.bossFlash, 'hit');
  assert.equal(dashFeedback?.text, '闪避同步');
  assert.equal(dashFeedback?.playerFlash, 'guard');
  assert.equal(blockFeedback?.text, '防御同步');
  assert.equal(blockFeedback?.playerFlash, 'guard');
});

test('keeps danger feedback above player action feedback', () => {
  const feedback = pickCombatFeedback([
    { type: 'player-attack-beat' },
    { type: 'player-hit' }
  ]);

  assert.equal(feedback?.text, '注意规避');
  assert.equal(feedback?.tone, 'danger');
});

test('reports blocked operation feedback without screen shake', () => {
  const attackFeedback = pickCombatFeedback([
    { type: 'attack-blocked-by-cooldown' }
  ]);
  const dashFeedback = pickCombatFeedback([
    { type: 'dash-blocked-by-cooldown' }
  ]);

  assert.equal(attackFeedback?.text, '攻击冷却');
  assert.equal(attackFeedback?.tone, 'warning');
  assert.equal(attackFeedback?.screenShake, 0);
  assert.equal(dashFeedback?.text, '闪避冷却');
  assert.equal(dashFeedback?.screenShake, 0);
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
