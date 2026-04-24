import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialWorld, stepWorld } from '../src/core/combat.js';
import { createRhythmTracker } from '../src/core/rhythm.js';
import { createBehaviorPlan } from '../src/core/behavior.js';

test('moves the player within the arena and applies dash cooldown explicitly', () => {
  const rhythm = createRhythmTracker({ bpm: 120, firstBeat: 0, duration: 20 });
  const world = createInitialWorld({ width: 400, height: 300, difficulty: 1, rhythm });

  stepWorld(world, 0.1, {
    moveX: -1,
    moveY: -1,
    pointerX: 0,
    pointerY: 0,
    attack: false,
    block: false,
    dash: true,
    time: 1
  });

  assert.equal(world.player.dashCooldown > 0, true);
  assert.equal(world.player.invulnerableTime > 0, true);
  assert.equal(world.player.x >= world.arena.minX, true);
  assert.equal(world.player.y >= world.arena.minY, true);

  const xAfterDash = world.player.x;
  stepWorld(world, 0.1, {
    moveX: 1,
    moveY: 0,
    pointerX: 400,
    pointerY: 300,
    attack: false,
    block: false,
    dash: true,
    time: 1.1
  });

  assert.equal(world.player.x > xAfterDash, true);
  assert.equal(world.events.some((event) => event.type === 'dash-blocked-by-cooldown'), true);
});

test('scores rhythm-boosted melee hits and ends in victory when the boss falls', () => {
  const rhythm = createRhythmTracker({ bpm: 120, firstBeat: 0, duration: 20 });
  const world = createInitialWorld({ width: 400, height: 300, difficulty: 1, rhythm });
  world.player.x = world.boss.x - 40;
  world.player.y = world.boss.y;
  world.boss.hp = 40;

  stepWorld(world, 0.016, {
    moveX: 0,
    moveY: 0,
    pointerX: world.boss.x,
    pointerY: world.boss.y,
    attack: true,
    block: false,
    dash: false,
    time: 1
  });

  assert.equal(world.boss.hp <= 0, true);
  assert.equal(world.result, 'victory');
  assert.equal(world.score >= 150, true);
  assert.equal(world.damageDealt >= 50, true);
});

test('spawns beat-driven bullets and damages the player on collision', () => {
  const rhythm = createRhythmTracker({ bpm: 120, firstBeat: 0, duration: 20 });
  const world = createInitialWorld({ width: 400, height: 300, difficulty: 1, rhythm });
  world.player.x = world.boss.x;
  world.player.y = world.boss.y + 20;

  stepWorld(world, 0.016, {
    moveX: 0,
    moveY: 0,
    pointerX: 0,
    pointerY: 0,
    attack: false,
    block: false,
    dash: false,
    time: 1
  });

  assert.equal(world.projectiles.length > 0, true);

  for (const projectile of world.projectiles) {
    projectile.x = world.player.x;
    projectile.y = world.player.y;
  }

  stepWorld(world, 0.016, {
    moveX: 0,
    moveY: 0,
    pointerX: 0,
    pointerY: 0,
    attack: false,
    block: false,
    dash: false,
    time: 1.016
  });

  assert.equal(world.player.hp < world.player.maxHp, true);
  assert.equal(world.events.some((event) => event.type === 'player-hit'), true);
});

test('uses the active music segment module for boss movement and bullet patterns', () => {
  const rhythm = createRhythmTracker({ bpm: 120, firstBeat: 0, duration: 30 });
  const behaviorPlan = createBehaviorPlan([
    { start: 0, end: 10, label: 'verse', energy: 0.25 },
    { start: 10, end: 20, label: 'chorus', energy: 0.9 }
  ], 120, 1);
  const world = createInitialWorld({ width: 500, height: 400, difficulty: 1, rhythm, behaviorPlan });

  stepWorld(world, 0.016, {
    moveX: 0,
    moveY: 0,
    pointerX: 0,
    pointerY: 0,
    attack: false,
    block: false,
    dash: false,
    time: 1
  });
  const verseCount = world.projectiles.length;
  const verseX = world.boss.x;

  world.projectiles = [];
  world.boss.lastBeatSpawnAt = -Infinity;
  stepWorld(world, 0.016, {
    moveX: 0,
    moveY: 0,
    pointerX: 0,
    pointerY: 0,
    attack: false,
    block: false,
    dash: false,
    time: 11
  });

  assert.equal(world.activeBehavior?.label, 'chorus');
  assert.equal(world.projectiles.length > verseCount, true);
  assert.equal(Math.abs(world.boss.x - verseX) > 10, true);
});

test('perfect defense empowers the next melee hit only once', () => {
  const rhythm = createRhythmTracker({ bpm: 120, firstBeat: 0, duration: 20 });
  const world = createInitialWorld({ width: 400, height: 300, difficulty: 1, rhythm });
  world.player.x = world.boss.x - 40;
  world.player.y = world.boss.y;

  stepWorld(world, 0.016, {
    moveX: 0,
    moveY: 0,
    pointerX: world.boss.x,
    pointerY: world.boss.y,
    attack: false,
    block: true,
    dash: false,
    time: 1
  });

  assert.equal(world.player.nextAttackMultiplier > 1, true);

  const hpBefore = world.boss.hp;
  stepWorld(world, 0.016, {
    moveX: 0,
    moveY: 0,
    pointerX: world.boss.x,
    pointerY: world.boss.y,
    attack: true,
    block: false,
    dash: false,
    time: 1.5
  });

  assert.equal(hpBefore - world.boss.hp > 50, true);
  assert.equal(world.player.nextAttackMultiplier, 1);
});
