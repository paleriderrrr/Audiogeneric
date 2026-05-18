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

test('keeps the full player body inside the arena', () => {
  const rhythm = createRhythmTracker({ bpm: 120, firstBeat: 0, duration: 20 });
  const world = createInitialWorld({ width: 400, height: 300, difficulty: 1, rhythm });

  stepWorld(world, 1, {
    moveX: -1,
    moveY: -1,
    pointerX: 0,
    pointerY: 0,
    attack: false,
    block: false,
    dash: false,
    time: 0.3
  });

  assert.equal(world.player.x >= world.arena.minX + world.player.radius, true);
  assert.equal(world.player.y >= world.arena.minY + world.player.radius, true);
});

test('requires melee attacks to face the boss', () => {
  const rhythm = createRhythmTracker({ bpm: 120, firstBeat: 0, duration: 20 });
  const world = createInitialWorld({ width: 400, height: 300, difficulty: 1, rhythm });
  world.player.x = world.boss.x - 40;
  world.player.y = world.boss.y;
  const hpBefore = world.boss.hp;

  stepWorld(world, 0.016, {
    moveX: 0,
    moveY: 0,
    pointerX: world.player.x - 100,
    pointerY: world.player.y,
    attack: true,
    block: false,
    dash: false,
    time: 1
  });

  assert.equal(world.boss.hp, hpBefore);
});

test('does not fire or report projectiles for none attacks', () => {
  const rhythm = createRhythmTracker({ bpm: 120, firstBeat: 0, duration: 20 });
  const world = createInitialWorld({
    width: 400,
    height: 300,
    difficulty: 1,
    rhythm,
    behaviorPlan: [{
      start: 0,
      end: 20,
      label: 'intro',
      movement: 'idle',
      attack: 'none',
      bulletCount: 8,
      bulletSpeed: 140,
      fireWindowBeats: 1,
      warningIntensity: 0.1
    }]
  });

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

  assert.equal(world.projectiles.length, 0);
  assert.equal(world.events.some((event) => event.type === 'projectiles-fired'), false);
});

test('respects fire windows when spawning beat projectiles', () => {
  const rhythm = createRhythmTracker({ bpm: 120, firstBeat: 0, duration: 20 });
  const world = createInitialWorld({
    width: 400,
    height: 300,
    difficulty: 1,
    rhythm,
    behaviorPlan: [{
      start: 0,
      end: 20,
      label: 'verse',
      movement: 'wander',
      attack: 'sparse-ring',
      bulletCount: 4,
      bulletSpeed: 140,
      fireWindowBeats: 4,
      warningIntensity: 0.3
    }]
  });

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
  const firstCount = world.projectiles.length;

  stepWorld(world, 0.016, {
    moveX: 0,
    moveY: 0,
    pointerX: 0,
    pointerY: 0,
    attack: false,
    block: false,
    dash: false,
    time: 1.5
  });

  assert.equal(world.projectiles.length, firstCount);
});

test('implements orbit and lane-burst behavior distinctly', () => {
  const rhythm = createRhythmTracker({ bpm: 120, firstBeat: 0, duration: 20 });
  const world = createInitialWorld({
    width: 500,
    height: 400,
    difficulty: 1,
    rhythm,
    behaviorPlan: [{
      start: 0,
      end: 20,
      label: 'bridge',
      movement: 'orbit',
      attack: 'lane-burst',
      bulletCount: 6,
      bulletSpeed: 160,
      fireWindowBeats: 1,
      warningIntensity: 0.5
    }]
  });

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

  assert.equal(Math.abs(world.boss.x - world.boss.homeX) > 20, true);
  assert.equal(new Set(world.projectiles.map((projectile) => Math.round(projectile.vy))).size <= 2, true);
});

test('scales projectile pressure by difficulty', () => {
  const easyRhythm = createRhythmTracker({ bpm: 120, firstBeat: 0, duration: 20 });
  const hardRhythm = createRhythmTracker({ bpm: 120, firstBeat: 0, duration: 20 });
  const behaviorPlan = [{
    start: 0,
    end: 20,
    label: 'chorus' as const,
    movement: 'dash' as const,
    attack: 'screen-ring' as const,
    bulletCount: 8,
    bulletSpeed: 160,
    fireWindowBeats: 1,
    warningIntensity: 0.7
  }];
  const easy = createInitialWorld({ width: 400, height: 300, difficulty: 0.5, rhythm: easyRhythm, behaviorPlan });
  const hard = createInitialWorld({ width: 400, height: 300, difficulty: 1.5, rhythm: hardRhythm, behaviorPlan });

  for (const world of [easy, hard]) {
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
  }

  assert.equal(hard.projectiles.length > easy.projectiles.length, true);
  assert.equal(Math.hypot(hard.projectiles[0].vx, hard.projectiles[0].vy) > Math.hypot(easy.projectiles[0].vx, easy.projectiles[0].vy), true);
});
