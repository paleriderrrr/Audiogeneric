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

test('commits dodge travel even without movement input by using facing direction', () => {
  const rhythm = createRhythmTracker({ bpm: 120, firstBeat: 0, duration: 20 });
  const world = createInitialWorld({ width: 500, height: 400, difficulty: 1, rhythm });
  const startX = world.player.x;
  const startY = world.player.y;
  world.player.facing = 0;

  stepWorld(world, 0.05, {
    moveX: 0,
    moveY: 0,
    pointerX: world.player.x + 100,
    pointerY: world.player.y,
    attack: false,
    block: false,
    dash: true,
    time: 1
  });

  stepWorld(world, 0.05, {
    moveX: 0,
    moveY: 0,
    pointerX: world.player.x + 100,
    pointerY: world.player.y,
    attack: false,
    block: false,
    dash: false,
    time: 1.05
  });

  assert.equal(world.player.x - startX >= 70, true);
  assert.equal(Math.abs(world.player.y - startY) < 6, true);
});

test('emits player operation events for attack block and successful dash inputs', () => {
  const rhythm = createRhythmTracker({ bpm: 120, firstBeat: 0, duration: 20 });
  const world = createInitialWorld({ width: 500, height: 400, difficulty: 1, rhythm });

  stepWorld(world, 0.016, {
    moveX: 0,
    moveY: 0,
    pointerX: world.player.x + 100,
    pointerY: world.player.y,
    attack: true,
    block: true,
    dash: true,
    time: 1
  });

  assert.equal(world.events.some((event) => event.type === 'player-attack'), true);
  assert.equal(world.events.some((event) => event.type === 'player-block'), true);
  assert.equal(world.events.some((event) => event.type === 'player-dash'), true);
  assert.equal(world.events.some((event) => event.type === 'player-attack-beat'), true);
  assert.equal(world.events.some((event) => event.type === 'player-block-beat'), true);
  assert.equal(world.events.some((event) => event.type === 'player-dash-beat'), true);
});

test('extends invulnerability when a dodge lands on beat', () => {
  const rhythmA = createRhythmTracker({ bpm: 120, firstBeat: 0, duration: 20 });
  const rhythmB = createRhythmTracker({ bpm: 120, firstBeat: 0, duration: 20 });
  const perfectWorld = createInitialWorld({ width: 500, height: 400, difficulty: 1, rhythm: rhythmA });
  const missWorld = createInitialWorld({ width: 500, height: 400, difficulty: 1, rhythm: rhythmB });
  perfectWorld.player.facing = 0;
  missWorld.player.facing = 0;

  stepWorld(perfectWorld, 0.016, {
    moveX: 0,
    moveY: 0,
    pointerX: perfectWorld.player.x + 100,
    pointerY: perfectWorld.player.y,
    attack: false,
    block: false,
    dash: true,
    time: 1
  });

  stepWorld(missWorld, 0.016, {
    moveX: 0,
    moveY: 0,
    pointerX: missWorld.player.x + 100,
    pointerY: missWorld.player.y,
    attack: false,
    block: false,
    dash: true,
    time: 1.18
  });

  assert.equal(perfectWorld.player.invulnerableTime > missWorld.player.invulnerableTime, true);
});

test('clears bullets along the dodge path when the dodge lands on beat', () => {
  const rhythm = createRhythmTracker({ bpm: 120, firstBeat: 0, duration: 20 });
  const world = createInitialWorld({ width: 500, height: 400, difficulty: 1, rhythm });
  world.player.facing = 0;
  world.projectiles = [
    {
      x: world.player.x + 40,
      y: world.player.y + 24,
      vx: 0,
      vy: 0,
      radius: 6,
      damage: 10,
      grazed: false
    }
  ];

  stepWorld(world, 0.05, {
    moveX: 0,
    moveY: 0,
    pointerX: world.player.x + 100,
    pointerY: world.player.y,
    attack: false,
    block: false,
    dash: true,
    time: 1
  });

  stepWorld(world, 0.05, {
    moveX: 0,
    moveY: 0,
    pointerX: world.player.x + 100,
    pointerY: world.player.y,
    attack: false,
    block: false,
    dash: false,
    time: 1.05
  });

  assert.equal(world.projectiles.length, 0);
});

test('does not clear nearby bullets when the dodge misses the beat window', () => {
  const rhythm = createRhythmTracker({ bpm: 120, firstBeat: 0, duration: 20 });
  const world = createInitialWorld({ width: 500, height: 400, difficulty: 1, rhythm });
  world.player.facing = 0;
  world.projectiles = [
    {
      x: world.player.x + 40,
      y: world.player.y + 24,
      vx: 0,
      vy: 0,
      radius: 6,
      damage: 10,
      grazed: false
    }
  ];

  stepWorld(world, 0.05, {
    moveX: 0,
    moveY: 0,
    pointerX: world.player.x + 100,
    pointerY: world.player.y,
    attack: false,
    block: false,
    dash: true,
    time: 1.18
  });

  stepWorld(world, 0.05, {
    moveX: 0,
    moveY: 0,
    pointerX: world.player.x + 100,
    pointerY: world.player.y,
    attack: false,
    block: false,
    dash: false,
    time: 1.23
  });

  assert.equal(world.projectiles.length, 1);
});

test('resets boss health instead of ending the song early when the boss falls', () => {
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

  assert.equal(world.boss.hp, world.boss.maxHp);
  assert.equal(world.result, 'playing');
  assert.equal(world.events.some((event) => event.type === 'boss-break'), true);
  assert.equal(world.score >= 150, true);
  assert.equal(world.damageDealt >= 50, true);
});

test('hits the boss when it is inside the forward slash cone', () => {
  const rhythm = createRhythmTracker({ bpm: 120, firstBeat: 0, duration: 20 });
  const world = createInitialWorld({ width: 500, height: 400, difficulty: 1, rhythm });
  world.player.x = 220;
  world.player.y = 220;
  world.player.facing = 0;
  world.boss.x = world.player.x + 72;
  world.boss.y = world.player.y + 4;
  const hpBefore = world.boss.hp;

  stepWorld(world, 0.016, {
    moveX: 0,
    moveY: 0,
    pointerX: world.player.x + 100,
    pointerY: world.player.y,
    attack: true,
    block: false,
    dash: false,
    time: 1
  });

  assert.equal(world.boss.hp < hpBefore, true);
  assert.equal(world.events.some((event) => event.type === 'attack-hit'), true);
  assert.equal(world.events.some((event) => event.type === 'player-attack-beat'), true);
});

test('misses the boss when it is close but outside the slash cone angle', () => {
  const rhythm = createRhythmTracker({ bpm: 120, firstBeat: 0, duration: 20 });
  const world = createInitialWorld({ width: 500, height: 400, difficulty: 1, rhythm });
  world.player.x = 220;
  world.player.y = 220;
  world.player.facing = 0;
  world.boss.x = world.player.x - 24;
  world.boss.y = world.player.y;
  const hpBefore = world.boss.hp;

  stepWorld(world, 0.016, {
    moveX: 0,
    moveY: 0,
    pointerX: world.player.x + 100,
    pointerY: world.player.y,
    attack: true,
    block: false,
    dash: false,
    time: 1
  });

  assert.equal(world.boss.hp, hpBefore);
  assert.equal(world.events.some((event) => event.type === 'attack-hit'), false);
});

test('misses the boss when it is outside the slash radius even if aimed correctly', () => {
  const rhythm = createRhythmTracker({ bpm: 120, firstBeat: 0, duration: 20 });
  const world = createInitialWorld({ width: 500, height: 400, difficulty: 1, rhythm });
  world.player.x = 220;
  world.player.y = 220;
  world.player.facing = 0;
  world.boss.x = world.player.x + 132;
  world.boss.y = world.player.y;
  const hpBefore = world.boss.hp;

  stepWorld(world, 0.016, {
    moveX: 0,
    moveY: 0,
    pointerX: world.player.x + 150,
    pointerY: world.player.y,
    attack: true,
    block: false,
    dash: false,
    time: 1
  });

  assert.equal(world.boss.hp, hpBefore);
});

test('keeps slash reach stable while beat timing only changes damage output', () => {
  const rhythmA = createRhythmTracker({ bpm: 120, firstBeat: 0, duration: 20 });
  const rhythmB = createRhythmTracker({ bpm: 120, firstBeat: 0, duration: 20 });
  const perfectWorld = createInitialWorld({ width: 500, height: 400, difficulty: 1, rhythm: rhythmA });
  const missWorld = createInitialWorld({ width: 500, height: 400, difficulty: 1, rhythm: rhythmB });

  for (const world of [perfectWorld, missWorld]) {
    world.player.x = 220;
    world.player.y = 220;
    world.player.facing = 0;
    world.boss.x = world.player.x + 72;
    world.boss.y = world.player.y;
  }

  const perfectHpBefore = perfectWorld.boss.hp;
  const missHpBefore = missWorld.boss.hp;

  stepWorld(perfectWorld, 0.016, {
    moveX: 0,
    moveY: 0,
    pointerX: perfectWorld.player.x + 100,
    pointerY: perfectWorld.player.y,
    attack: true,
    block: false,
    dash: false,
    time: 1
  });

  stepWorld(missWorld, 0.016, {
    moveX: 0,
    moveY: 0,
    pointerX: missWorld.player.x + 100,
    pointerY: missWorld.player.y,
    attack: true,
    block: false,
    dash: false,
    time: 1.18
  });

  assert.equal(perfectWorld.boss.hp < perfectHpBefore, true);
  assert.equal(missWorld.boss.hp < missHpBefore, true);
  assert.equal((perfectHpBefore - perfectWorld.boss.hp) > (missHpBefore - missWorld.boss.hp), true);
});

test('spawns beat-driven bullets and damages the player on collision', () => {
  const rhythm = createRhythmTracker({ bpm: 120, firstBeat: 0, duration: 20 });
  const world = createInitialWorld({
    width: 400,
    height: 300,
    difficulty: 1,
    rhythm,
    behaviorPlan: [
      {
        start: 0,
        end: 20,
        label: 'verse',
        movement: 'idle',
        attack: 'sparse-ring',
        bulletCount: 6,
        bulletSpeed: 160,
        warningIntensity: 0.35,
        fireWindowBeats: 1
      }
    ]
  });
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

test('rewards near misses once without damaging the player', () => {
  const rhythm = createRhythmTracker({ bpm: 120, firstBeat: 0, duration: 20 });
  const world = createInitialWorld({ width: 400, height: 300, difficulty: 1, rhythm });
  world.projectiles = [
    {
      x: world.player.x + world.player.radius + 14,
      y: world.player.y,
      vx: 0,
      vy: 0,
      radius: 6,
      damage: 10,
      grazed: false
    }
  ];

  stepWorld(world, 0.016, {
    moveX: 0,
    moveY: 0,
    pointerX: world.boss.x,
    pointerY: world.boss.y,
    attack: false,
    block: false,
    dash: false,
    time: 1
  });

  assert.equal(world.player.hp, world.player.maxHp);
  assert.equal(world.score, 15);
  assert.equal(world.projectiles[0].grazed, true);
  assert.equal(world.events.some((event) => event.type === 'near-graze'), true);

  stepWorld(world, 0.016, {
    moveX: 0,
    moveY: 0,
    pointerX: world.boss.x,
    pointerY: world.boss.y,
    attack: false,
    block: false,
    dash: false,
    time: 1.016
  });

  assert.equal(world.score, 15);
});

test('uses the active music segment module for boss movement and attack patterns', () => {
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
  assert.equal(world.activeBehavior?.attack, 'laser-ray');
  assert.equal(world.events.some((event) => event.type === 'boss-laser'), true);
  assert.equal(world.projectiles.length, 0);
  assert.equal(verseCount > 0, true);
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

test('keeps low-pressure sections readable while still allowing a minimum attack pattern', () => {
  const rhythm = createRhythmTracker({ bpm: 120, firstBeat: 0, duration: 20 });
  const behaviorPlan = createBehaviorPlan([{ start: 0, end: 12, label: 'intro', energy: 0.05 }], 120, 0.3);
  const world = createInitialWorld({ width: 500, height: 400, difficulty: 0.3, rhythm, behaviorPlan });

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

  assert.equal(world.activeBehavior?.attack, 'sparse-ring');
  assert.equal(world.projectiles.length > 0, true);
  assert.equal((world.activeBehavior?.bulletCount ?? 0) <= 4, true);
});

test('uses fireWindowBeats to keep low-pressure sections from firing every beat', () => {
  const rhythm = createRhythmTracker({ bpm: 120, firstBeat: 0, duration: 20 });
  const world = createInitialWorld({
    width: 500,
    height: 400,
    difficulty: 1,
    rhythm,
    behaviorPlan: [
      {
        start: 0,
        end: 20,
        label: 'verse',
        movement: 'wander',
        attack: 'sparse-ring',
        bulletCount: 4,
        bulletSpeed: 150,
        warningIntensity: 0.25,
        fireWindowBeats: 4
      }
    ]
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
  const firstVolleyCount = world.projectiles.length;

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

  assert.equal(firstVolleyCount > 0, true);
  assert.equal(world.projectiles.length, firstVolleyCount);

  stepWorld(world, 0.016, {
    moveX: 0,
    moveY: 0,
    pointerX: 0,
    pointerY: 0,
    attack: false,
    block: false,
    dash: false,
    time: 3
  });

  assert.equal(world.projectiles.length > firstVolleyCount, true);
});

test('uses lane-burst for drop segments and orbit movement for bridge pressure', () => {
  const rhythm = createRhythmTracker({ bpm: 120, firstBeat: 0, duration: 30 });
  const behaviorPlan = createBehaviorPlan([
    { start: 0, end: 12, label: 'bridge', energy: 0.55 },
    { start: 12, end: 24, label: 'drop', energy: 0.98 }
  ], 120, 1.8);
  const world = createInitialWorld({ width: 500, height: 400, difficulty: 1.8, rhythm, behaviorPlan });

  stepWorld(world, 0.016, {
    moveX: 0,
    moveY: 0,
    pointerX: 150,
    pointerY: 120,
    attack: false,
    block: false,
    dash: false,
    time: 1
  });

  const bridgeX = world.boss.x;
  const bridgeY = world.boss.y;
  assert.equal(world.activeBehavior?.movement, 'orbit');

  world.projectiles = [];
  world.boss.lastBeatSpawnAt = -Infinity;
  stepWorld(world, 0.016, {
    moveX: 0,
    moveY: 0,
    pointerX: 320,
    pointerY: 260,
    attack: false,
    block: false,
    dash: false,
    time: 13
  });

  assert.equal(world.activeBehavior?.attack, 'lane-burst');
  assert.equal(world.projectiles.length > 0, true);
  assert.equal(Math.abs(world.projectiles[0].x - world.boss.x) < 8, true);
  assert.equal(Math.abs(world.projectiles[0].y - world.boss.y) < 8, true);
  assert.equal(Math.abs(world.boss.x - bridgeX) > 5 || Math.abs(world.boss.y - bridgeY) > 5, true);
});

test('projectile attacks spawn half of their baseline volley count', () => {
  const rhythm = createRhythmTracker({ bpm: 120, firstBeat: 0, duration: 20 });
  const world = createInitialWorld({
    width: 500,
    height: 400,
    difficulty: 1,
    rhythm,
    behaviorPlan: [
      {
        start: 0,
        end: 20,
        label: 'verse',
        movement: 'idle',
        attack: 'sparse-ring',
        bulletCount: 10,
        bulletSpeed: 180,
        warningIntensity: 0.4,
        fireWindowBeats: 1
      }
    ]
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

  assert.equal(world.projectiles.length, 5);
});

test('laser-ray modules fire an instant beam without spawning projectiles', () => {
  const rhythm = createRhythmTracker({ bpm: 120, firstBeat: 0, duration: 20 });
  const world = createInitialWorld({
    width: 500,
    height: 400,
    difficulty: 1,
    rhythm,
    behaviorPlan: [
      {
        start: 0,
        end: 20,
        label: 'chorus',
        movement: 'idle',
        attack: 'laser-ray',
        bulletCount: 6,
        bulletSpeed: 220,
        warningIntensity: 0.7,
        fireWindowBeats: 1
      }
    ]
  });
  world.player.x = world.boss.x + 120;
  world.player.y = world.boss.y;

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
  assert.equal(world.events.some((event) => event.type === 'boss-laser'), true);
  assert.equal(world.player.hp < world.player.maxHp, true);
});

test('melee-sweep modules strike nearby players without spawning projectiles', () => {
  const rhythm = createRhythmTracker({ bpm: 120, firstBeat: 0, duration: 20 });
  const world = createInitialWorld({
    width: 500,
    height: 400,
    difficulty: 1,
    rhythm,
    behaviorPlan: [
      {
        start: 0,
        end: 20,
        label: 'bridge',
        movement: 'idle',
        attack: 'melee-sweep',
        bulletCount: 8,
        bulletSpeed: 170,
        warningIntensity: 0.75,
        fireWindowBeats: 1
      }
    ]
  });
  world.player.x = world.boss.x + 58;
  world.player.y = world.boss.y;

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
  assert.equal(world.events.some((event) => event.type === 'boss-sweep'), true);
  assert.equal(world.player.hp < world.player.maxHp, true);
});

test('explosive-burst modules spawn large slower explosive projectiles', () => {
  const rhythm = createRhythmTracker({ bpm: 120, firstBeat: 0, duration: 20 });
  const world = createInitialWorld({
    width: 500,
    height: 400,
    difficulty: 1,
    rhythm,
    behaviorPlan: [
      {
        start: 0,
        end: 20,
        label: 'drop',
        movement: 'idle',
        attack: 'explosive-burst',
        bulletCount: 8,
        bulletSpeed: 200,
        warningIntensity: 0.8,
        fireWindowBeats: 1
      }
    ]
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

  assert.equal(world.projectiles.length > 0, true);
  assert.equal(world.projectiles.every((projectile) => projectile.kind === 'explosion'), true);
  assert.equal(world.projectiles.every((projectile) => projectile.radius >= 14), true);
  assert.equal(Math.hypot(world.projectiles[0].vx, world.projectiles[0].vy) < 180, true);
});

test('charge-strike modules move the boss toward the player and apply contact pressure', () => {
  const rhythm = createRhythmTracker({ bpm: 120, firstBeat: 0, duration: 20 });
  const world = createInitialWorld({
    width: 500,
    height: 400,
    difficulty: 1,
    rhythm,
    behaviorPlan: [
      {
        start: 0,
        end: 20,
        label: 'drop',
        movement: 'idle',
        attack: 'charge-strike',
        bulletCount: 1,
        bulletSpeed: 220,
        warningIntensity: 0.85,
        fireWindowBeats: 1
      }
    ]
  });
  world.player.x = world.boss.x + 90;
  world.player.y = world.boss.y;
  const distanceBefore = Math.hypot(world.player.x - world.boss.x, world.player.y - world.boss.y);

  stepWorld(world, 0.016, {
    moveX: 0,
    moveY: 0,
    pointerX: world.player.x,
    pointerY: world.player.y,
    attack: false,
    block: false,
    dash: false,
    time: 1
  });

  const distanceAfter = Math.hypot(world.player.x - world.boss.x, world.player.y - world.boss.y);
  assert.equal(distanceAfter < distanceBefore, true);
  assert.equal(world.events.some((event) => event.type === 'boss-charged'), true);
  assert.equal(world.player.hp < world.player.maxHp, true);
});

test('armed boss projectiles can collide with and damage the boss', () => {
  const rhythm = createRhythmTracker({ bpm: 120, firstBeat: 0, duration: 20 });
  const world = createInitialWorld({ width: 500, height: 400, difficulty: 1, rhythm });
  world.projectiles = [
    {
      x: world.boss.x + 4,
      y: world.boss.y,
      vx: 0,
      vy: 0,
      radius: 6,
      damage: 10,
      grazed: false,
      kind: 'bullet',
      age: 0.35,
      bossCollisionDelay: 0.25
    }
  ];
  const hpBefore = world.boss.hp;

  stepWorld(world, 0.016, {
    moveX: 0,
    moveY: 0,
    pointerX: world.boss.x,
    pointerY: world.boss.y,
    attack: false,
    block: false,
    dash: false,
    time: 1
  });

  assert.equal(world.projectiles.length, 0);
  assert.equal(world.boss.hp < hpBefore, true);
  assert.equal(world.events.some((event) => event.type === 'boss-self-hit'), true);
});
