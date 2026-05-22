import type { Judgment, RhythmTracker } from './rhythm.js';
import { getBehaviorAtTime, type BehaviorModule } from './behavior.js';

export type GameResult = 'playing' | 'victory' | 'defeat';

export interface Arena {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface Actor {
  x: number;
  y: number;
  radius: number;
  hp: number;
  maxHp: number;
}

export interface PlayerState extends Actor {
  speed: number;
  attackTime: number;
  attackCooldown: number;
  attackAim: number;
  attackJudgment: Judgment | null;
  blockTime: number;
  dashCooldown: number;
  dodgeTime: number;
  dodgeDirectionX: number;
  dodgeDirectionY: number;
  dodgeEnhanced: boolean;
  invulnerableTime: number;
  facing: number;
  nextAttackMultiplier: number;
}

export interface BossState extends Actor {
  attackTimer: number;
  lastBeatSpawnAt: number;
  homeX: number;
  homeY: number;
}

export interface Projectile {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  damage: number;
  grazed: boolean;
  kind?: 'bullet' | 'laser' | 'explosion' | 'melee';
  age?: number;
}

export interface ActiveHazard {
  kind: 'laser' | 'circle' | 'cone';
  x: number;
  y: number;
  angle: number;
  radius: number;
  halfAngle: number;
  width: number;
  reach: number;
  damage: number;
  damageAt: number;
}

export interface WorldEvent {
  type:
    | 'attack-hit'
    | 'boss-break'
    | 'dash-cleared-projectiles'
    | 'dash-blocked-by-cooldown'
    | 'projectiles-fired'
    | 'boss-laser'
    | 'boss-laser-blast'
    | 'boss-sweep'
    | 'boss-charged'
    | 'boss-area-warning'
    | 'boss-area-blast'
    | 'near-graze'
    | 'player-move'
    | 'player-move-beat'
    | 'player-attack'
    | 'player-attack-beat'
    | 'attack-blocked-by-cooldown'
    | 'player-block'
    | 'player-block-beat'
    | 'player-dash'
    | 'player-dash-beat'
    | 'player-hit'
    | 'player-blocked-hit'
    | 'perfect-defense'
    | 'victory'
    | 'defeat';
}

export interface CombatInput {
  moveX: number;
  moveY: number;
  pointerX: number;
  pointerY: number;
  attack: boolean;
  block: boolean;
  dash: boolean;
  time: number;
}

export interface WorldState {
  arena: Arena;
  player: PlayerState;
  boss: BossState;
  projectiles: Projectile[];
  hazards: ActiveHazard[];
  rhythm: RhythmTracker;
  difficulty: number;
  score: number;
  damageDealt: number;
  result: GameResult;
  events: WorldEvent[];
  behaviorPlan: BehaviorModule[];
  activeBehavior: BehaviorModule | null;
}

const PLAYER_RADIUS = 14;
const BOSS_RADIUS = 34;
const DODGE_DURATION = 0.08;
const DODGE_DISTANCE = 96;
const DODGE_CLEAR_RADIUS = 28;
const SLASH_RADIUS = 92;
const SLASH_HALF_ANGLE = Math.PI / 5;
const LOCK_ATTACK_RADIUS = 118;
const LOCK_ATTACK_HALF_ANGLE = Math.PI / 4;
const ATTACK_ACTIVE_TIME = 0.18;
const ATTACK_COOLDOWN = 0.42;

export function createInitialWorld(config: {
  width: number;
  height: number;
  difficulty: number;
  rhythm: RhythmTracker;
  behaviorPlan?: BehaviorModule[];
}): WorldState {
  const arenaSize = Math.max(280, Math.min(720, config.width - 32, config.height - 32));
  const centerX = config.width / 2;
  const centerY = config.height / 2;
  const arena = {
    minX: centerX - arenaSize / 2,
    minY: centerY - arenaSize / 2,
    maxX: centerX + arenaSize / 2,
    maxY: centerY + arenaSize / 2
  };

  return {
    arena,
    player: {
      x: centerX,
      y: centerY + arenaSize * 0.25,
      radius: PLAYER_RADIUS,
      hp: 100,
      maxHp: 100,
      speed: 260,
      attackTime: 0,
      attackCooldown: 0,
      attackAim: -Math.PI / 2,
      attackJudgment: null,
      blockTime: 0,
      dashCooldown: 0,
      dodgeTime: 0,
      dodgeDirectionX: 0,
      dodgeDirectionY: -1,
      dodgeEnhanced: false,
      invulnerableTime: 0,
      facing: -Math.PI / 2,
      nextAttackMultiplier: 1
    },
    boss: {
      x: centerX,
      y: centerY - arenaSize * 0.2,
      radius: BOSS_RADIUS,
      hp: 600,
      maxHp: 600,
      attackTimer: 0,
      lastBeatSpawnAt: -Infinity,
      homeX: centerX,
      homeY: centerY - arenaSize * 0.2
    },
    projectiles: [],
    hazards: [],
    rhythm: config.rhythm,
    difficulty: config.difficulty,
    score: 0,
    damageDealt: 0,
    result: 'playing',
    events: [],
    behaviorPlan: config.behaviorPlan ?? [],
    activeBehavior: null
  };
}

export function stepWorld(world: WorldState, dt: number, input: CombatInput): void {
  if (world.result !== 'playing') return;

  world.events = [];
  const timerSnapshot = tickTimers(world.player, dt);
  updatePlayer(world, dt, input, timerSnapshot.dodgeTime);
  updateBoss(world, input.time, dt);
  updateProjectiles(world, dt);
  resolveHazards(world, input.time);
  resolveCombat(world, input);
  resolveOutcome(world);
}

function tickTimers(player: PlayerState, dt: number): { dodgeTime: number } {
  const dodgeTime = player.dodgeTime;
  player.attackTime = Math.max(0, player.attackTime - dt);
  player.attackCooldown = Math.max(0, player.attackCooldown - dt);
  if (player.attackTime <= 0) {
    player.attackJudgment = null;
  }
  player.blockTime = Math.max(0, player.blockTime - dt);
  player.dashCooldown = Math.max(0, player.dashCooldown - dt);
  player.dodgeTime = Math.max(0, player.dodgeTime - dt);
  player.invulnerableTime = Math.max(0, player.invulnerableTime - dt);
  if (player.dodgeTime <= 0) {
    player.dodgeEnhanced = false;
  }
  return { dodgeTime };
}

function updatePlayer(world: WorldState, dt: number, input: CombatInput, dodgeTimeBeforeTick: number): void {
  const player = world.player;
  const dx = input.pointerX - player.x;
  const dy = input.pointerY - player.y;
  if (dx !== 0 || dy !== 0) player.facing = Math.atan2(dy, dx);

  if (input.attack) {
    if (player.attackCooldown <= 0) {
      const judgment = world.rhythm.judge(input.time, 'attack');
      player.attackTime = ATTACK_ACTIVE_TIME;
      player.attackCooldown = ATTACK_COOLDOWN;
      player.attackAim = player.facing;
      player.attackJudgment = judgment;
      world.events.push({ type: 'player-attack' });
      if (judgment.rank !== 'miss') {
        world.events.push({ type: 'player-attack-beat' });
      }
    } else {
      world.events.push({ type: 'attack-blocked-by-cooldown' });
    }
  }

  if (input.block) {
    player.blockTime = 0.28;
    world.events.push({ type: 'player-block' });
    const judgment = world.rhythm.judge(input.time, 'block');
    if (judgment.rank !== 'miss') {
      world.events.push({ type: 'player-block-beat' });
    }
    if (judgment.perfectDefense) {
      player.invulnerableTime = Math.max(player.invulnerableTime, 0.25);
      player.nextAttackMultiplier = 1.5;
      world.events.push({ type: 'perfect-defense' });
    }
  }

  let speed = player.speed;
  let dashTriggered = false;
  if (input.dash) {
    if (player.dashCooldown <= 0) {
      const judgment = world.rhythm.judge(input.time, 'dash');
      const direction = resolveDodgeDirection(player, input);
      player.dashCooldown = 0.5;
      player.dodgeTime = DODGE_DURATION;
      player.dodgeDirectionX = direction.x;
      player.dodgeDirectionY = direction.y;
      player.dodgeEnhanced = judgment.perfectDefense;
      player.invulnerableTime = judgment.perfectDefense ? 0.38 : 0.2;
      dashTriggered = true;
      world.events.push({ type: 'player-dash' });
      if (judgment.rank !== 'miss') {
        world.events.push({ type: 'player-dash-beat' });
      }
      if (judgment.perfectDefense) {
        player.nextAttackMultiplier = 1.5;
        world.events.push({ type: 'perfect-defense' });
      }
    } else {
      world.events.push({ type: 'dash-blocked-by-cooldown' });
    }
  }

  const dodgeTravelTime = dashTriggered ? dt : Math.min(dt, dodgeTimeBeforeTick);
  if (dashTriggered || dodgeTimeBeforeTick > 0) {
    const previousX = player.x;
    const previousY = player.y;
    const dodgeSpeed = DODGE_DISTANCE / DODGE_DURATION;
    player.x = clamp(player.x + player.dodgeDirectionX * dodgeSpeed * dodgeTravelTime, world.arena.minX + player.radius, world.arena.maxX - player.radius);
    player.y = clamp(player.y + player.dodgeDirectionY * dodgeSpeed * dodgeTravelTime, world.arena.minY + player.radius, world.arena.maxY - player.radius);
    if (dashTriggered) {
      player.dodgeTime = Math.max(0, player.dodgeTime - dodgeTravelTime);
    }
    if (player.dodgeEnhanced) {
      clearProjectilesAlongSegment(world, previousX, previousY, player.x, player.y);
    }
    return;
  }

  const moveLength = Math.hypot(input.moveX, input.moveY);
  const length = moveLength || 1;
  player.x = clamp(player.x + (input.moveX / length) * speed * dt, world.arena.minX + player.radius, world.arena.maxX - player.radius);
  player.y = clamp(player.y + (input.moveY / length) * speed * dt, world.arena.minY + player.radius, world.arena.maxY - player.radius);
  if (moveLength > 0) {
    world.events.push({ type: 'player-move' });
    if (world.rhythm.isOnBeat(input.time)) {
      world.events.push({ type: 'player-move-beat' });
    }
  }
}

function updateBoss(world: WorldState, time: number, dt: number): void {
  const boss = world.boss;
  const player = world.player;
  const behavior = getBehaviorAtTime(world.behaviorPlan, time);
  world.activeBehavior = behavior;

  if (behavior.movement === 'idle') {
    boss.x = approach(boss.x, boss.homeX, 0.04);
    boss.y = approach(boss.y, boss.homeY, 0.04);
  } else if (behavior.movement === 'wander') {
    boss.x = clamp(boss.homeX + Math.sin(time * 1.3) * 48, world.arena.minX, world.arena.maxX);
    boss.y = clamp(boss.homeY + Math.cos(time * 0.9) * 28, world.arena.minY, world.arena.maxY);
  } else if (behavior.movement === 'dash') {
    boss.x = clamp(boss.homeX + Math.sign(Math.sin(time * 2.5)) * 90, world.arena.minX, world.arena.maxX);
    boss.y = clamp(boss.homeY + Math.sin(time * 3.2) * 52, world.arena.minY, world.arena.maxY);
  } else if (behavior.movement === 'orbit') {
    const orbitRadiusX = 68 + behavior.warningIntensity * 32;
    const orbitRadiusY = 34 + behavior.warningIntensity * 18;
    boss.x = clamp(boss.homeX + Math.cos(time * 1.9) * orbitRadiusX, world.arena.minX, world.arena.maxX);
    boss.y = clamp(boss.homeY + Math.sin(time * 1.9) * orbitRadiusY, world.arena.minY, world.arena.maxY);
  } else if (behavior.movement === 'chase') {
    moveBossToward(world, player.x, player.y, 96 + behavior.warningIntensity * 80, dt);
  } else if (behavior.movement === 'keep-distance') {
    const desiredDistance = 128 + behavior.warningIntensity * 40;
    const dx = boss.x - player.x;
    const dy = boss.y - player.y;
    const distance = Math.max(0.001, Math.hypot(dx, dy));
    const targetX = player.x + (dx / distance) * desiredDistance;
    const targetY = player.y + (dy / distance) * desiredDistance;
    moveBossToward(world, targetX, targetY, 82 + behavior.warningIntensity * 54, dt);
  } else if (behavior.movement === 'outer-orbit') {
    const phase = time * (0.85 + behavior.warningIntensity * 0.5);
    const radiusX = (world.arena.maxX - world.arena.minX) * 0.42;
    const radiusY = (world.arena.maxY - world.arena.minY) * 0.39;
    boss.x = clamp(boss.homeX + Math.cos(phase) * radiusX, world.arena.minX, world.arena.maxX);
    boss.y = clamp(boss.homeY + Math.sin(phase) * radiusY, world.arena.minY, world.arena.maxY);
  } else {
    boss.x = clamp(boss.homeX + Math.sin(time * 34) * 10, world.arena.minX, world.arena.maxX);
    boss.y = clamp(boss.homeY + Math.cos(time * 31) * 10, world.arena.minY, world.arena.maxY);
  }

  const beatInterval = world.rhythm.getBeatInterval();
  const fireWindowBeats = Math.max(1, behavior.fireWindowBeats ?? 1);
  const minimumSpawnGap = Math.max(0.2, beatInterval * fireWindowBeats * 0.95);

  if (world.rhythm.isOnBeat(time) && time - boss.lastBeatSpawnAt >= minimumSpawnGap) {
    boss.lastBeatSpawnAt = time;
    spawnProjectiles(world, behavior);
  }
}

function spawnProjectiles(world: WorldState, behavior: BehaviorModule): void {
  if (behavior.attack === 'none') return;

  const difficulty = clamp(world.difficulty, 0.3, 2);
  if (behavior.attack === 'laser-barrage') {
    performBossLaser(world, behavior, difficulty);
    spawnProjectileVolley(world, { ...behavior, attack: 'aimed-burst' }, difficulty);
    return;
  }

  if (behavior.attack === 'charge-sweep') {
    performBossCharge(world, behavior, difficulty);
    performBossSweep(world, behavior, difficulty);
    return;
  }

  if (behavior.attack === 'charge-strike') {
    performBossCharge(world, behavior, difficulty);
    return;
  }

  if (behavior.attack === 'laser-ray') {
    performBossLaser(world, behavior, difficulty);
    return;
  }

  if (behavior.attack === 'melee-sweep') {
    performBossSweep(world, behavior, difficulty);
    return;
  }

  if (behavior.attack === 'ground-slam') {
    scheduleCircleHazard(world, behavior, difficulty);
    return;
  }

  if (behavior.attack === 'cone-cleave') {
    scheduleConeHazard(world, behavior, difficulty);
    return;
  }

  spawnProjectileVolley(world, behavior, difficulty);
}

function spawnProjectileVolley(world: WorldState, behavior: BehaviorModule, difficulty: number): void {
  if (behavior.bulletCount <= 0) return;

  const baseCount = Math.max(1, Math.round(behavior.bulletCount * difficulty * 0.5));
  const baseSpeed = behavior.bulletSpeed * (0.92 + difficulty * 0.18);
  const pattern = resolveProjectilePattern(behavior.attack, baseCount, baseSpeed, 8 + Math.round(difficulty * 3));
  const aimedAngle = Math.atan2(world.player.y - world.boss.y, world.player.x - world.boss.x);
  for (let i = 0; i < pattern.count; i += 1) {
    const angle = resolveProjectileAngle(behavior, aimedAngle, pattern.count, i, world.boss.lastBeatSpawnAt);
    const spawnOffset = world.boss.radius + pattern.spawnClearance + 6;
    world.projectiles.push({
      x: world.boss.x + Math.cos(angle) * spawnOffset,
      y: world.boss.y + Math.sin(angle) * spawnOffset,
      vx: Math.cos(angle) * pattern.speed,
      vy: Math.sin(angle) * pattern.speed,
      radius: pattern.radius,
      damage: pattern.damage,
      grazed: false,
      kind: pattern.kind,
      age: 0
    });
  }
  world.events.push({ type: 'projectiles-fired' });
}

function resolveProjectilePattern(
  attack: BehaviorModule['attack'],
  baseCount: number,
  baseSpeed: number,
  baseDamage: number
): {
  count: number;
  speed: number;
  radius: number;
  spawnClearance: number;
  damage: number;
  kind: NonNullable<Projectile['kind']>;
} {
  if (attack === 'explosive-burst') {
    return {
      count: Math.max(3, Math.ceil(baseCount * 0.65)),
      speed: baseSpeed * 0.62,
      radius: 16,
      spawnClearance: 16 * 3.2,
      damage: baseDamage + 4,
      kind: 'explosion'
    };
  }

  return {
    count: baseCount,
    speed: baseSpeed,
    radius: 6,
    spawnClearance: 6,
    damage: baseDamage,
    kind: 'bullet'
  };
}

function resolveProjectileAngle(
  behavior: BehaviorModule,
  aimedAngle: number,
  count: number,
  index: number,
  beatTime: number
): number {
  if (behavior.attack === 'aimed-burst') {
    return aimedAngle + (index - (count - 1) / 2) * 0.12;
  }
  if (behavior.attack === 'screen-ring') {
    return (Math.PI * 2 * index) / count + Math.sin(beatTime) * 0.2;
  }
  if (behavior.attack === 'lane-burst') {
    const laneOffsets = [-0.42, -0.16, 0.16, 0.42];
    return aimedAngle + laneOffsets[index % laneOffsets.length];
  }
  if (behavior.attack === 'explosive-burst') {
    return (Math.PI * 2 * index) / count + (index % 2 === 0 ? 0.16 : -0.16);
  }
  return (Math.PI * 2 * index) / count;
}

function performBossLaser(world: WorldState, behavior: BehaviorModule, difficulty: number): void {
  const boss = world.boss;
  const player = world.player;
  const angle = Math.atan2(player.y - boss.y, player.x - boss.x);
  const reach = clamp(170 + behavior.bulletSpeed * 1.15, 220, 560) * (0.92 + difficulty * 0.08);
  const width = 6 + behavior.warningIntensity * 14;
  const muzzleOffset = boss.radius + width + 8;
  const origin = projectPoint(boss.x, boss.y, angle, muzzleOffset);
  world.events.push({ type: 'boss-laser' });
  world.hazards.push({
    kind: 'laser',
    x: origin.x,
    y: origin.y,
    angle,
    radius: 0,
    halfAngle: 0,
    width,
    reach: Math.max(48, reach - muzzleOffset),
    damage: 10 + Math.round(difficulty * 4 + behavior.warningIntensity * 4),
    damageAt: boss.lastBeatSpawnAt + 0.22
  });
}

function performBossSweep(world: WorldState, behavior: BehaviorModule, difficulty: number): void {
  const range = world.boss.radius + world.player.radius + 72 + behavior.warningIntensity * 54;
  world.events.push({ type: 'boss-sweep' });

  if (distance(world.boss, world.player) > range) return;

  applyBossDirectDamage(world, 12 + Math.round(difficulty * 4 + behavior.warningIntensity * 3));
}

function scheduleCircleHazard(world: WorldState, behavior: BehaviorModule, difficulty: number): void {
  const radius = 52 + behavior.warningIntensity * 58 + difficulty * 8;
  world.hazards.push({
    kind: 'circle',
    x: world.player.x,
    y: world.player.y,
    angle: 0,
    radius,
    halfAngle: 0,
    width: 0,
    reach: 0,
    damage: 13 + Math.round(difficulty * 5 + behavior.warningIntensity * 5),
    damageAt: world.boss.lastBeatSpawnAt + 0.26
  });
  world.events.push({ type: 'boss-area-warning' });
}

function scheduleConeHazard(world: WorldState, behavior: BehaviorModule, difficulty: number): void {
  const angle = Math.atan2(world.player.y - world.boss.y, world.player.x - world.boss.x);
  world.hazards.push({
    kind: 'cone',
    x: world.boss.x,
    y: world.boss.y,
    angle,
    radius: 135 + behavior.warningIntensity * 90 + difficulty * 12,
    halfAngle: Math.PI * (0.22 + behavior.warningIntensity * 0.12),
    width: 0,
    reach: 0,
    damage: 12 + Math.round(difficulty * 5 + behavior.warningIntensity * 4),
    damageAt: world.boss.lastBeatSpawnAt + 0.24
  });
  world.events.push({ type: 'boss-area-warning' });
}

function performBossCharge(world: WorldState, behavior: BehaviorModule, difficulty: number): void {
  const boss = world.boss;
  const player = world.player;
  const angle = Math.atan2(player.y - boss.y, player.x - boss.x);
  const distanceToPlayer = distance(boss, player);
  const chargeDistance = clamp(
    56 + behavior.warningIntensity * 72 + behavior.bulletSpeed * 0.12,
    48,
    130
  ) * (0.85 + difficulty * 0.12);
  const travel = Math.min(chargeDistance, Math.max(0, distanceToPlayer - boss.radius * 0.35));

  boss.x = clamp(boss.x + Math.cos(angle) * travel, world.arena.minX, world.arena.maxX);
  boss.y = clamp(boss.y + Math.sin(angle) * travel, world.arena.minY, world.arena.maxY);
  world.events.push({ type: 'boss-charged' });

  const contactDistance = boss.radius + player.radius + 10;
  if (distance(boss, player) > contactDistance) return;

  applyBossDirectDamage(world, 14 + Math.round(difficulty * 5));
}

function applyBossDirectDamage(world: WorldState, damage: number): void {
  const player = world.player;
  if (player.invulnerableTime > 0 || player.blockTime > 0) {
    world.events.push({ type: 'player-blocked-hit' });
    return;
  }

  player.hp -= damage;
  world.events.push({ type: 'player-hit' });
}

function updateProjectiles(world: WorldState, dt: number): void {
  for (const projectile of world.projectiles) {
    projectile.age = (projectile.age ?? 0) + dt;
    projectile.x += projectile.vx * dt;
    projectile.y += projectile.vy * dt;
  }
  world.projectiles = world.projectiles.filter(
    (projectile) =>
      projectile.x >= world.arena.minX - 40 &&
      projectile.x <= world.arena.maxX + 40 &&
      projectile.y >= world.arena.minY - 40 &&
      projectile.y <= world.arena.maxY + 40
  );
}

function resolveHazards(world: WorldState, time: number): void {
  for (let index = world.hazards.length - 1; index >= 0; index -= 1) {
    const hazard = world.hazards[index];
    if (time < hazard.damageAt) continue;
    world.hazards.splice(index, 1);
    world.events.push({ type: hazard.kind === 'laser' ? 'boss-laser-blast' : 'boss-area-blast' });
    if (!hazardHitsPlayer(hazard, world.player)) continue;
    applyBossDirectDamage(world, hazard.damage);
  }
}

function hazardHitsPlayer(hazard: ActiveHazard, player: PlayerState): boolean {
  if (hazard.kind === 'circle') {
    return Math.hypot(player.x - hazard.x, player.y - hazard.y) <= hazard.radius + player.radius;
  }

  if (hazard.kind === 'cone') {
    const dx = player.x - hazard.x;
    const dy = player.y - hazard.y;
    const distanceToPlayer = Math.hypot(dx, dy);
    const angleToPlayer = Math.atan2(dy, dx);
    return distanceToPlayer <= hazard.radius + player.radius
      && Math.abs(normalizeAngle(angleToPlayer - hazard.angle)) <= hazard.halfAngle;
  }

  const endX = hazard.x + Math.cos(hazard.angle) * hazard.reach;
  const endY = hazard.y + Math.sin(hazard.angle) * hazard.reach;
  return distancePointToSegment(player.x, player.y, hazard.x, hazard.y, endX, endY) <= player.radius + hazard.width;
}

function resolveCombat(world: WorldState, input: CombatInput): void {
  if (world.player.attackTime > 0 && bossInsideAttackLock(world.player, world.boss)) {
    const judgment = world.player.attackJudgment ?? world.rhythm.judge(input.time, 'attack');
    const damage = 25 * judgment.damageMultiplier * world.player.nextAttackMultiplier;
    world.player.nextAttackMultiplier = 1;
    world.boss.hp -= damage;
    world.damageDealt += damage;
    world.score += Math.round(damage) + judgment.scoreBonus;
    world.player.attackTime = 0;
    world.player.attackJudgment = null;
    world.events.push({ type: 'attack-hit' });
  }

  for (let index = world.projectiles.length - 1; index >= 0; index -= 1) {
    const projectile = world.projectiles[index];
    const hitDistance = projectile.radius + world.player.radius;
    const playerDistance = distance(projectile, world.player);
    if (playerDistance <= hitDistance) {
      world.projectiles.splice(index, 1);
      if (world.player.invulnerableTime > 0 || world.player.blockTime > 0) {
        world.events.push({ type: 'player-blocked-hit' });
      } else {
        world.player.hp -= projectile.damage;
        world.events.push({ type: 'player-hit' });
      }
    } else if (!projectile.grazed && playerDistance <= hitDistance + 18) {
      projectile.grazed = true;
      world.score += 15;
      world.events.push({ type: 'near-graze' });
    }
  }
}

function moveBossToward(world: WorldState, targetX: number, targetY: number, speed: number, dt: number): void {
  const dx = targetX - world.boss.x;
  const dy = targetY - world.boss.y;
  const distance = Math.hypot(dx, dy);
  if (distance <= 0.001) return;
  const step = Math.min(distance, speed * dt);
  world.boss.x = clamp(world.boss.x + (dx / distance) * step, world.arena.minX, world.arena.maxX);
  world.boss.y = clamp(world.boss.y + (dy / distance) * step, world.arena.minY, world.arena.maxY);
}

function resolveOutcome(world: WorldState): void {
  if (world.boss.hp <= 0) {
    world.boss.hp = world.boss.maxHp;
    world.events.push({ type: 'boss-break' });
  }

  if (world.player.hp <= 0) {
    world.result = 'defeat';
    world.events.push({ type: 'defeat' });
  }
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function bossInsideAttackLock(player: PlayerState, boss: BossState): boolean {
  const dx = boss.x - player.x;
  const dy = boss.y - player.y;
  const distanceToBoss = Math.hypot(dx, dy);
  const angleToBoss = Math.atan2(dy, dx);
  const aim = player.attackTime > 0 ? player.attackAim : player.facing;
  if (distanceToBoss <= SLASH_RADIUS) {
    return Math.abs(normalizeAngle(angleToBoss - aim)) <= SLASH_HALF_ANGLE;
  }

  if (distanceToBoss > LOCK_ATTACK_RADIUS) {
    return false;
  }

  return Math.abs(normalizeAngle(angleToBoss - aim)) <= LOCK_ATTACK_HALF_ANGLE;
}

function resolveDodgeDirection(player: PlayerState, input: CombatInput): { x: number; y: number } {
  const moveLength = Math.hypot(input.moveX, input.moveY);
  if (moveLength > 0) {
    return {
      x: input.moveX / moveLength,
      y: input.moveY / moveLength
    };
  }

  return {
    x: Math.cos(player.facing),
    y: Math.sin(player.facing)
  };
}

function clearProjectilesAlongSegment(
  world: WorldState,
  startX: number,
  startY: number,
  endX: number,
  endY: number
): void {
  let cleared = 0;
  world.projectiles = world.projectiles.filter((projectile) => {
    const distanceToPath = distancePointToSegment(projectile.x, projectile.y, startX, startY, endX, endY);
    const shouldClear = distanceToPath <= projectile.radius + DODGE_CLEAR_RADIUS;
    if (shouldClear) {
      cleared += 1;
    }
    return !shouldClear;
  });

  if (cleared > 0) {
    world.score += cleared * 20;
    world.events.push({ type: 'dash-cleared-projectiles' });
  }
}

function distancePointToSegment(
  pointX: number,
  pointY: number,
  startX: number,
  startY: number,
  endX: number,
  endY: number
): number {
  const segmentX = endX - startX;
  const segmentY = endY - startY;
  const lengthSquared = (segmentX * segmentX) + (segmentY * segmentY);
  if (lengthSquared === 0) {
    return Math.hypot(pointX - startX, pointY - startY);
  }

  const projection = ((pointX - startX) * segmentX + (pointY - startY) * segmentY) / lengthSquared;
  const clampedProjection = clamp(projection, 0, 1);
  const closestX = startX + segmentX * clampedProjection;
  const closestY = startY + segmentY * clampedProjection;
  return Math.hypot(pointX - closestX, pointY - closestY);
}

function projectPoint(originX: number, originY: number, angle: number, distance: number): { x: number; y: number } {
  return {
    x: originX + Math.cos(angle) * distance,
    y: originY + Math.sin(angle) * distance
  };
}

function normalizeAngle(angle: number): number {
  let value = angle;
  while (value > Math.PI) value -= Math.PI * 2;
  while (value < -Math.PI) value += Math.PI * 2;
  return value;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function approach(current: number, target: number, rate: number): number {
  return current + (target - current) * rate;
}
