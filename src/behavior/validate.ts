import type { BehaviorModule } from './types.js';

const VALID_MOVEMENTS = new Set([
  'idle',
  'wander',
  'dash',
  'orbit',
  'shake',
  'chase',
  'keep-distance',
  'outer-orbit'
]);
const VALID_ATTACKS = new Set([
  'none',
  'sparse-ring',
  'aimed-burst',
  'screen-ring',
  'lane-burst',
  'melee-sweep',
  'laser-ray',
  'explosive-burst',
  'charge-strike',
  'ground-slam',
  'cone-cleave',
  'laser-barrage',
  'charge-sweep'
]);
const VALID_INTENTS = new Set(['warmup', 'pressure', 'chase', 'lockdown', 'burst', 'release']);
const VALID_TRANSITIONS = new Set(['snap', 'blend']);
const VALID_PHASE_ROLES = new Set(['setup', 'pressure', 'burst', 'reposition', 'recovery']);

export function validateBehaviorTimeline(timeline: unknown): {
  valid: boolean;
  warnings: string[];
} {
  const warnings: string[] = [];
  if (!isRecord(timeline)) {
    return { valid: false, warnings: ['Invalid timeline: expected object'] };
  }

  if (timeline.source !== 'rules' && timeline.source !== 'llm') {
    warnings.push(`Invalid timeline source: ${String(timeline.source)}`);
  }
  if (!Array.isArray(timeline.modules)) {
    warnings.push('Invalid timeline: modules must be an array');
  }
  if (!isRecord(timeline.metadata)) {
    warnings.push('Invalid timeline: metadata must be an object');
  }

  const metadata = isRecord(timeline.metadata) ? timeline.metadata : {};
  if (timeline.source === 'llm' && typeof metadata.styleApplied === 'string' && !['rock', 'electronic', 'hiphop', 'ambient', 'pop', 'orchestral', 'unknown'].includes(metadata.styleApplied)) {
    warnings.push(`Invalid styleApplied: ${metadata.styleApplied}`);
  }
  const modules = Array.isArray(timeline.modules) ? timeline.modules : [];
  if (modules.length === 0) {
    warnings.push('Timeline must contain at least one module');
    return { valid: false, warnings };
  }

  const sorted = [...modules].sort((left, right) => {
    const leftStart = isRecord(left) && typeof left.start === 'number' ? left.start : Number.POSITIVE_INFINITY;
    const rightStart = isRecord(right) && typeof right.start === 'number' ? right.start : Number.POSITIVE_INFINITY;
    return leftStart - rightStart;
  });
  if (!modules.every((module, index) => module === sorted[index])) {
    warnings.push('Modules must be sorted by start time');
  }

  for (const module of modules) {
    validateModule(module, warnings);
  }

  validateTimelineOrder(sorted, warnings);
  return { valid: warnings.length === 0, warnings };
}

function validateModule(value: unknown, warnings: string[]): void {
  if (!isRecord(value)) {
    warnings.push('Invalid module: expected object');
    return;
  }

  const module = value as Partial<BehaviorModule>;
  const id = String(module.id ?? 'unknown');
  const bulletCount = module.bulletCount;
  const bulletSpeed = module.bulletSpeed;
  const fireWindowBeats = module.fireWindowBeats;
  const pressureLevel = module.pressureLevel;
  const warningIntensity = module.warningIntensity;
  if (!module.id) warnings.push('Missing module id');
  if (!module.presetId) warnings.push(`Missing preset id: ${id}`);
  if (typeof module.movement !== 'string' || !VALID_MOVEMENTS.has(module.movement)) warnings.push(`Invalid movement: ${module.movement}`);
  if (typeof module.attack !== 'string' || !VALID_ATTACKS.has(module.attack)) warnings.push(`Invalid attack: ${module.attack}`);
  if (typeof module.intent !== 'string' || !VALID_INTENTS.has(module.intent)) warnings.push(`Invalid intent: ${module.intent}`);
  if (typeof module.phaseRole !== 'string' || !VALID_PHASE_ROLES.has(module.phaseRole)) warnings.push(`Invalid phase role: ${id}`);
  if (typeof module.transitionIn !== 'string' || !VALID_TRANSITIONS.has(module.transitionIn)) warnings.push(`Invalid transitionIn: ${id}`);
  if (typeof module.transitionOut !== 'string' || !VALID_TRANSITIONS.has(module.transitionOut)) warnings.push(`Invalid transitionOut: ${id}`);
  if (!Number.isFinite(module.start) || !Number.isFinite(module.end)) warnings.push(`Non-finite time range: ${id}`);
  if (!(typeof module.start === 'number' && typeof module.end === 'number' && module.end > module.start)) warnings.push(`Invalid duration: ${id}`);
  if (!Number.isFinite(bulletCount) || (bulletCount as number) < 0) warnings.push(`Invalid bullet count: ${id}`);
  if (!Number.isFinite(bulletSpeed) || (bulletSpeed as number) < 0) warnings.push(`Invalid bullet speed: ${id}`);
  if (!Number.isFinite(fireWindowBeats) || (fireWindowBeats as number) <= 0) warnings.push(`Invalid fire window: ${id}`);
  if (!Number.isFinite(pressureLevel) || (pressureLevel as number) < 0 || (pressureLevel as number) > 100) warnings.push(`Invalid pressure level: ${id}`);
  if (!Number.isFinite(warningIntensity) || (warningIntensity as number) < 0 || (warningIntensity as number) > 1) {
    warnings.push(`Invalid warning intensity: ${id}`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function validateTimelineOrder(modules: unknown[], warnings: string[]): void {
  for (let index = 1; index < modules.length; index += 1) {
    const previous = modules[index - 1] as Partial<BehaviorModule>;
    const current = modules[index] as Partial<BehaviorModule>;
    if (typeof current.start !== 'number' || typeof previous.end !== 'number') continue;
    if (current.start < previous.end) {
      warnings.push(`Overlapping modules: ${previous.id} -> ${current.id}`);
    } else if (current.start - previous.end > 0.001) {
      warnings.push(`Gap between modules: ${previous.id} -> ${current.id}`);
    }
  }
}
