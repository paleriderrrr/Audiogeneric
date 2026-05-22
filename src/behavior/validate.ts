import type { BehaviorModule, BehaviorTimeline } from './types.js';

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
  'charge-strike'
]);
const VALID_INTENTS = new Set(['warmup', 'pressure', 'chase', 'lockdown', 'burst', 'release']);
const VALID_PHASE_ROLES = new Set(['setup', 'pressure', 'burst', 'reposition', 'recovery']);

export function validateBehaviorTimeline(timeline: BehaviorTimeline): {
  valid: boolean;
  warnings: string[];
} {
  const warnings: string[] = [];
  if (timeline.modules.length === 0) {
    warnings.push('Timeline must contain at least one module');
    return { valid: false, warnings };
  }

  const sorted = [...timeline.modules].sort((left, right) => left.start - right.start);
  if (!timeline.modules.every((module, index) => module === sorted[index])) {
    warnings.push('Modules must be sorted by start time');
  }

  for (const module of timeline.modules) {
    validateModule(module, warnings);
  }

  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1];
    const current = sorted[index];
    if (current.start < previous.end) {
      warnings.push(`Overlapping modules: ${previous.id} -> ${current.id}`);
    } else if (current.start - previous.end > 0.001) {
      warnings.push(`Gap between modules: ${previous.id} -> ${current.id}`);
    }
  }

  return { valid: warnings.length === 0, warnings };
}

function validateModule(module: BehaviorModule, warnings: string[]): void {
  if (!module.id) warnings.push('Missing module id');
  if (!module.presetId) warnings.push(`Missing preset id: ${module.id}`);
  if (!Number.isFinite(module.start) || !Number.isFinite(module.end)) warnings.push(`Non-finite time range: ${module.id}`);
  if (!VALID_MOVEMENTS.has(module.movement)) warnings.push(`Invalid movement: ${module.movement}`);
  if (!VALID_ATTACKS.has(module.attack)) warnings.push(`Invalid attack: ${module.attack}`);
  if (!VALID_INTENTS.has(module.intent)) warnings.push(`Invalid intent: ${module.intent}`);
  if (!VALID_PHASE_ROLES.has(module.phaseRole)) warnings.push(`Invalid phase role: ${module.id}`);
  if (!(module.end > module.start)) warnings.push(`Invalid duration: ${module.id}`);
  if (module.bulletCount < 0) warnings.push(`Invalid bullet count: ${module.id}`);
  if (!Number.isFinite(module.bulletSpeed) || module.bulletSpeed < 0) warnings.push(`Invalid bullet speed: ${module.id}`);
  if (!Number.isFinite(module.pressureLevel) || module.pressureLevel < 0) warnings.push(`Invalid pressure level: ${module.id}`);
  if (!Number.isFinite(module.warningIntensity) || module.warningIntensity < 0 || module.warningIntensity > 1) {
    warnings.push(`Invalid warning intensity: ${module.id}`);
  }
}
