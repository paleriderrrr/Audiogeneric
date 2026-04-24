import type { BehaviorModule, BehaviorTimeline } from './types.js';

const VALID_MOVEMENTS = new Set(['idle', 'wander', 'dash', 'orbit', 'shake']);
const VALID_ATTACKS = new Set(['none', 'sparse-ring', 'aimed-burst', 'screen-ring', 'lane-burst']);
const VALID_INTENTS = new Set(['warmup', 'pressure', 'chase', 'lockdown', 'burst', 'release']);

export function validateBehaviorTimeline(timeline: BehaviorTimeline): {
  valid: boolean;
  warnings: string[];
} {
  const warnings: string[] = [];
  for (const module of timeline.modules) {
    validateModule(module, warnings);
  }
  return { valid: warnings.length === 0, warnings };
}

function validateModule(module: BehaviorModule, warnings: string[]): void {
  if (!VALID_MOVEMENTS.has(module.movement)) warnings.push(`Invalid movement: ${module.movement}`);
  if (!VALID_ATTACKS.has(module.attack)) warnings.push(`Invalid attack: ${module.attack}`);
  if (!VALID_INTENTS.has(module.intent)) warnings.push(`Invalid intent: ${module.intent}`);
  if (!(module.end > module.start)) warnings.push(`Invalid duration: ${module.id}`);
  if (module.bulletCount < 0) warnings.push(`Invalid bullet count: ${module.id}`);
}
