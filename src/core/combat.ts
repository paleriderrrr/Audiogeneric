import type { RhythmTracker } from './rhythm.js';
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
  blockTime: number;
  dashCooldown: number;
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
}

export interface WorldEvent {
  type:
    | 'attack-hit'
    | 'dash-blocked-by-cooldown'
    | 'projectiles-fired'
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
      blockTime: 0,
      dashCooldown: 0,
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
  tickTimers(world.player, dt);
  updatePlayer(world, dt, input);
  updateBoss(world, input.time);
  updateProjectiles(world, dt);
  resolveCombat(world, input);
  resolveOutcome(world);
}

function tickTimers(player: PlayerState, dt: number): void {
  player.attackTime = Math.max(0, player.attackTime - dt);
  player.blockTime = Math.max(0, player.blockTime - dt);
  player.dashCooldown = Math.max(0, player.dashCooldown - dt);
  player.invulnerableTime = Math.max(0, player.invulnerableTime - dt);
}

function updatePlayer(world: WorldState, dt: number, input: CombatInput): void {
  const player = world.player;
  const dx = input.pointerX - player.x;
  const dy = input.pointerY - player.y;
  if (dx !== 0 || dy !== 0) player.facing = Math.atan2(dy, dx);

  if (input.attack && player.attackTime <= 0) {
    player.attackTime = 0.22;
  }

  if (input.block) {
    player.blockTime = 0.28;
    const judgment = world.rhythm.judge(input.time, 'block');
    if (judgment.perfectDefense) {
      player.invulnerableTime = Math.max(player.invulnerableTime, 0.25);
      player.nextAttackMultiplier = 1.5;
      world.events.push({ type: 'perfect-defense' });
    }
  }

  let speed = player.speed;
  if (input.dash) {
    if (player.dashCooldown <= 0) {
      const judgment = world.rhythm.judge(input.time, 'dash');
      speed *= 3.2;
      player.dashCooldown = 0.5;
      player.invulnerableTime = judgment.perfectDefense ? 0.35 : 0.2;
      if (judgment.perfectDefense) {
        player.nextAttackMultiplier = 1.5;
        world.events.push({ type: 'perfect-defense' });
      }
    } else {
      world.events.push({ type: 'dash-blocked-by-cooldown' });
    }
  }

  const length = Math.hypot(input.moveX, input.moveY) || 1;
  player.x = clamp(player.x + (input.moveX / length) * speed * dt, world.arena.minX + player.radius, world.arena.maxX - player.radius);
  player.y = clamp(player.y + (input.moveY / length) * speed * dt, world.arena.minY + player.radius, world.arena.maxY - player.radius);
}

function updateBoss(world: WorldState, time: number): void {
  const boss = world.boss;
  const behavior = getBehaviorAtTime(world.behaviorPlan, time);
  world.activeBehavior = behavior;

  if (behavior.movement === 'idle') {
    boss.x = approach(boss.x, boss.homeX, 0.04);
    boss.y = approach(boss.y, boss.homeY, 0.04);
  } else if (behavior.movement === 'wander') {
    boss.x = clamp(boss.homeX + Math.sin(time * 1.3) * 48, world.arena.minX, world.arena.maxX);
    boss.y = clamp(boss.homeY + Math.cos(time * 0.9) * 28, world.arena.minY, world.arena.maxY);
  } else if (behavior.movement === 'orbit') {
    boss.x = clamp(boss.homeX + Math.cos(time * 1.1) * 72, world.arena.minX, world.arena.maxX);
    boss.y = clamp(boss.homeY + Math.sin(time * 1.1) * 44, world.arena.minY, world.arena.maxY);
  } else if (behavior.movement === 'dash') {
    boss.x = clamp(boss.homeX + Math.sign(Math.sin(time * 2.5)) * 90, world.arena.minX, world.arena.maxX);
    boss.y = clamp(boss.homeY + Math.sin(time * 3.2) * 52, world.arena.minY, world.arena.maxY);
  } else {
    boss.x = clamp(boss.homeX + Math.sin(time * 34) * 10, world.arena.minX, world.arena.maxX);
    boss.y = clamp(boss.homeY + Math.cos(time * 31) * 10, world.arena.minY, world.arena.maxY);
  }

  if (world.rhythm.isOnBeat(time) && canFireOnBeat(world, behavior, time)) {
    boss.lastBeatSpawnAt = time;
    spawnProjectiles(world, behavior);
  }
}

function spawnProjectiles(world: WorldState, behavior: BehaviorModule): void {
  if (behavior.attack === 'none' || behavior.bulletCount <= 0) return;
  const count = Math.max(0, Math.round(behavior.bulletCount * world.difficulty));
  if (count <= 0) return;
  const speed = behavior.bulletSpeed * world.difficulty;
  const damage = 10 * world.difficulty;
  const aimedAngle = Math.atan2(world.player.y - world.boss.y, world.player.x - world.boss.x);
  for (let i = 0; i < count; i += 1) {
    const angle =
      behavior.attack === 'aimed-burst'
        ? aimedAngle + (i - (count - 1) / 2) * 0.12
        : behavior.attack === 'screen-ring'
          ? (Math.PI * 2 * i) / count + Math.sin(world.boss.lastBeatSpawnAt) * 0.2
          : behavior.attack === 'lane-burst'
            ? (i % 2 === 0 ? Math.PI / 2 : -Math.PI / 2)
          : (Math.PI * 2 * i) / count;
    world.projectiles.push({
      x: behavior.attack === 'lane-burst' ? world.boss.x + (i - (count - 1) / 2) * 18 : world.boss.x,
      y: world.boss.y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      radius: 6,
      damage
    });
  }
  world.events.push({ type: 'projectiles-fired' });
}

function updateProjectiles(world: WorldState, dt: number): void {
  for (const projectile of world.projectiles) {
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

function resolveCombat(world: WorldState, input: CombatInput): void {
  if (world.player.attackTime > 0 && distance(world.player, world.boss) <= 85 && isFacing(world.player, world.boss)) {
    const judgment = world.rhythm.judge(input.time, 'attack');
    const damage = 25 * judgment.damageMultiplier * world.player.nextAttackMultiplier;
    world.player.nextAttackMultiplier = 1;
    world.boss.hp -= damage;
    world.damageDealt += damage;
    world.score += Math.round(damage) + judgment.scoreBonus;
    world.player.attackTime = 0;
    world.events.push({ type: 'attack-hit' });
  }

  for (let index = world.projectiles.length - 1; index >= 0; index -= 1) {
    const projectile = world.projectiles[index];
    if (distance(projectile, world.player) <= projectile.radius + world.player.radius) {
      world.projectiles.splice(index, 1);
      if (world.player.invulnerableTime > 0 || world.player.blockTime > 0) {
        world.events.push({ type: 'player-blocked-hit' });
      } else {
        world.player.hp -= projectile.damage;
        world.events.push({ type: 'player-hit' });
      }
    }
  }
}

function resolveOutcome(world: WorldState): void {
  if (world.boss.hp <= 0) {
    world.result = 'victory';
    world.events.push({ type: 'victory' });
  } else if (world.player.hp <= 0) {
    world.result = 'defeat';
    world.events.push({ type: 'defeat' });
  }
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function canFireOnBeat(world: WorldState, behavior: BehaviorModule, time: number): boolean {
  if (time - world.boss.lastBeatSpawnAt <= 0.2) return false;
  const fireWindowBeats = behavior.fireWindowBeats ?? 1;
  const beatInterval = world.rhythm.timeToNextBeat(time + 0.001) + 0.001;
  return time - world.boss.lastBeatSpawnAt >= beatInterval * fireWindowBeats - 0.01;
}

function isFacing(player: PlayerState, target: Actor): boolean {
  const targetAngle = Math.atan2(target.y - player.y, target.x - player.x);
  const diff = Math.atan2(Math.sin(targetAngle - player.facing), Math.cos(targetAngle - player.facing));
  return Math.abs(diff) <= 0.65;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function approach(current: number, target: number, rate: number): number {
  return current + (target - current) * rate;
}
