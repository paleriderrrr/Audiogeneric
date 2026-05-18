import type { BehaviorModule } from './types.js';

const VALID_MOVEMENTS = new Set(['idle', 'wander', 'dash', 'orbit', 'shake']);
const VALID_ATTACKS = new Set(['none', 'sparse-ring', 'aimed-burst', 'screen-ring', 'lane-burst']);
const VALID_INTENTS = new Set(['warmup', 'pressure', 'chase', 'lockdown', 'burst', 'release']);
const VALID_TRANSITIONS = new Set(['snap', 'blend']);

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
  for (const module of modules) {
    validateModule(module, warnings);
  }
  validateTimelineOrder(modules, warnings);
  return { valid: warnings.length === 0, warnings };
}

function validateModule(value: unknown, warnings: string[]): void {
  if (!isRecord(value)) {
    warnings.push('Invalid module: expected object');
    return;
  }
  const module = value as Partial<BehaviorModule>;
  const id = String(module.id ?? 'unknown');
  const movement = module.movement;
  const attack = module.attack;
  const intent = module.intent;
  const transitionIn = module.transitionIn;
  const transitionOut = module.transitionOut;
  const start = module.start;
  const end = module.end;
  const bulletCount = module.bulletCount;
  const bulletSpeed = module.bulletSpeed;
  const fireWindowBeats = module.fireWindowBeats;
  const warningIntensity = module.warningIntensity;
  const pressureLevel = module.pressureLevel;

  if (typeof movement !== 'string' || !VALID_MOVEMENTS.has(movement)) warnings.push(`Invalid movement: ${movement}`);
  if (typeof attack !== 'string' || !VALID_ATTACKS.has(attack)) warnings.push(`Invalid attack: ${attack}`);
  if (typeof intent !== 'string' || !VALID_INTENTS.has(intent)) warnings.push(`Invalid intent: ${intent}`);
  if (typeof transitionIn !== 'string' || !VALID_TRANSITIONS.has(transitionIn)) warnings.push(`Invalid transitionIn: ${id}`);
  if (typeof transitionOut !== 'string' || !VALID_TRANSITIONS.has(transitionOut)) warnings.push(`Invalid transitionOut: ${id}`);
  if (typeof start !== 'number' || typeof end !== 'number' || !(end > start)) warnings.push(`Invalid duration: ${id}`);
  if (!Number.isFinite(bulletCount) || typeof bulletCount !== 'number' || bulletCount < 0) warnings.push(`Invalid bullet count: ${id}`);
  if (!Number.isFinite(bulletSpeed) || typeof bulletSpeed !== 'number' || bulletSpeed <= 0) warnings.push(`Invalid bullet speed: ${id}`);
  if (!Number.isFinite(fireWindowBeats) || typeof fireWindowBeats !== 'number' || fireWindowBeats <= 0) warnings.push(`Invalid fire window: ${id}`);
  if (!Number.isFinite(warningIntensity) || typeof warningIntensity !== 'number' || warningIntensity < 0 || warningIntensity > 1) warnings.push(`Invalid warning intensity: ${id}`);
  if (!Number.isFinite(pressureLevel) || typeof pressureLevel !== 'number' || pressureLevel < 0 || pressureLevel > 100) warnings.push(`Invalid pressure level: ${id}`);
}

function validateTimelineOrder(modules: unknown[], warnings: string[]): void {
  for (let index = 1; index < modules.length; index += 1) {
    const previous = modules[index - 1] as Partial<BehaviorModule>;
    const current = modules[index] as Partial<BehaviorModule>;
    if (typeof current.start !== 'number' || typeof previous.end !== 'number') continue;
    if (current.start < previous.end) warnings.push(`Timeline overlap: ${previous.id} -> ${current.id}`);
    if (current.start > previous.end) warnings.push(`Timeline gap: ${previous.id} -> ${current.id}`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
