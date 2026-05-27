import { extractMusicPrimitives } from '../audio/primitives.js';
import type { MusicPrimitive, MusicPrimitiveKind } from '../audio/types.js';
import type {
  AttackMode,
  BehaviorGenerationInput,
  BehaviorModule,
  BehaviorTimeline,
  CombatIntent,
  MovementMode,
  PhaseRole,
  PrimitiveCoupling,
  PrimitivePlan,
  PrimitiveStep
} from './types.js';

export function createDefaultPrimitivePlan(input: BehaviorGenerationInput): PrimitivePlan {
  const primitives = resolvePrimitiveCatalog(input);
  const groups = groupPrimitivesBySegment(input, primitives);
  return {
    source: 'primitive-plan',
    generatedAt: Date.now(),
    steps: groups.flatMap((group, groupIndex) => {
      const sameSpan = group.primitives;
      const primitive = pickRepresentativePrimitive(sameSpan);
      return buildDefaultStepsForGroup({
        group,
        groupIndex,
        primitive,
        sameSpan,
        allPrimitives: primitives
      });
    }),
    metadata: {
      strategyNotes: ['default primitive plan generated from spectrum primitives']
    }
  };
}

function buildDefaultStepsForGroup(config: {
  group: {
    start: number;
    end: number;
    segmentLabel: BehaviorGenerationInput['segments'][number]['label'];
    energy: number;
    primitives: MusicPrimitive[];
  };
  groupIndex: number;
  primitive: MusicPrimitive | undefined;
  sameSpan: MusicPrimitive[];
  allPrimitives: MusicPrimitive[];
}): PrimitiveStep[] {
  const duration = config.group.end - config.group.start;
  const intensity = config.primitive?.strength ?? clamp(config.group.energy, 0.12, 0.56);
  const splitCount = resolveMicroPhaseCount(duration, intensity, config.group.energy);
  const spans = splitSpan(config.group.start, config.group.end, splitCount);
  const primitiveIds = config.primitive ? buildStepPrimitiveIds(config.primitive, config.sameSpan) : [];
  const coupling = config.primitive ? couplingForPrimitives(primitiveIds, config.allPrimitives) : 'single';
  const intent = config.primitive ? intentForPrimitive(config.primitive.kind) : intentForSegment(config.group.segmentLabel, config.group.energy);
  const roles = resolveMicroPhaseRoles(config.group.segmentLabel, config.primitive?.kind, splitCount, intensity);

  return spans.map((span, phaseIndex) => ({
    id: `primitive-step-${config.groupIndex}-${phaseIndex}`,
    start: span.start,
    end: span.end,
    primitiveIds,
    intent,
    phaseRole: roles[phaseIndex] ?? roles[roles.length - 1] ?? 'pressure',
    coupling,
    intensity: clamp(intensity + phaseIndex * 0.04, 0, 1),
    rationale: config.primitive
      ? `default ${roles[phaseIndex] ?? 'pressure'} plan for ${config.primitive.kind}`
      : `default ${roles[phaseIndex] ?? 'pressure'} coverage for ${config.group.segmentLabel}`
  }));
}

function resolveMicroPhaseCount(duration: number, intensity: number, energy: number): number {
  if (duration >= 28 && (intensity >= 0.72 || energy >= 0.72)) return 3;
  if (duration >= 18 && (intensity >= 0.48 || energy >= 0.42)) return 2;
  return 1;
}

function splitSpan(start: number, end: number, count: number): Array<{ start: number; end: number }> {
  const duration = Math.max(0.001, end - start);
  return Array.from({ length: count }, (_, index) => {
    const spanStart = index === 0 ? start : start + (duration / count) * index;
    const spanEnd = index === count - 1 ? end : start + (duration / count) * (index + 1);
    return {
      start: roundTime(spanStart),
      end: roundTime(spanEnd)
    };
  });
}

function resolveMicroPhaseRoles(
  label: BehaviorGenerationInput['segments'][number]['label'],
  primitiveKind: MusicPrimitiveKind | undefined,
  count: number,
  intensity: number
): PhaseRole[] {
  if (count <= 1) {
    return [primitiveKind ? roleForPrimitive(primitiveKind, intensity) : roleForSegment(intensity)];
  }
  if (count === 2) {
    if (label === 'intro') return ['setup', 'pressure'];
    if (label === 'outro') return ['pressure', 'recovery'];
    return primitiveKind === 'flux-break' ? ['reposition', 'burst'] : ['pressure', 'burst'];
  }
  if (label === 'outro') return ['pressure', 'reposition', 'recovery'];
  if (label === 'intro') return ['setup', 'pressure', 'reposition'];
  return ['setup', 'pressure', 'burst'];
}

function groupPrimitivesBySegment(
  input: BehaviorGenerationInput,
  primitives: MusicPrimitive[]
): Array<{
  start: number;
  end: number;
  segmentLabel: BehaviorGenerationInput['segments'][number]['label'];
  energy: number;
  primitives: MusicPrimitive[];
}> {
  const segments = [...input.segments].sort((left, right) => left.start - right.start);
  if (segments.length === 0) {
    return groupPrimitivesBySpan(primitives).map((group) => ({
      start: group[0].start,
      end: group[0].end,
      segmentLabel: 'verse' as const,
      energy: group[0].features.energy,
      primitives: group
    }));
  }

  return segments.map((segment) => ({
    start: segment.start,
    end: segment.end,
    segmentLabel: segment.label,
    energy: segment.energy,
    primitives: primitives.filter((primitive) => {
      const center = (primitive.start + primitive.end) / 2;
      return center >= segment.start - 0.001 && center <= segment.end + 0.001;
    })
  }));
}

function groupPrimitivesBySpan(primitives: MusicPrimitive[]): MusicPrimitive[][] {
  const groups = new Map<string, MusicPrimitive[]>();
  for (const primitive of primitives) {
    const key = `${primitive.start}:${primitive.end}:${primitive.segmentIndex}`;
    const group = groups.get(key) ?? [];
    group.push(primitive);
    groups.set(key, group);
  }
  return [...groups.values()].sort((left, right) => {
    const leftHead = left[0];
    const rightHead = right[0];
    return leftHead.start - rightHead.start || rightHead.strength - leftHead.strength;
  });
}

function pickRepresentativePrimitive(primitives: MusicPrimitive[]): MusicPrimitive | undefined {
  return [...primitives].sort((left, right) => {
    const priorityDelta = primitivePriority(right.kind) - primitivePriority(left.kind);
    if (priorityDelta !== 0) return priorityDelta;
    return right.strength - left.strength || left.kind.localeCompare(right.kind);
  })[0];
}

function primitivePriority(kind: MusicPrimitiveKind): number {
  if (kind === 'climax') return 6;
  if (kind === 'flux-break') return 5;
  if (kind === 'dense-pressure') return 4;
  if (kind === 'bright-beam') return 3;
  if (kind === 'bass-impact') return 2;
  return 1;
}

export function validatePrimitivePlan(plan: unknown, input: BehaviorGenerationInput): {
  valid: boolean;
  warnings: string[];
} {
  const warnings: string[] = [];
  if (!isRecord(plan)) {
    return { valid: false, warnings: ['Invalid primitive plan: expected object'] };
  }
  if (plan.source !== 'primitive-plan') {
    warnings.push(`Invalid primitive plan source: ${String(plan.source)}`);
  }
  if (!Array.isArray(plan.steps)) {
    warnings.push('Invalid primitive plan: steps must be an array');
    return { valid: false, warnings };
  }

  const primitiveIds = new Set(resolvePrimitiveCatalog(input).map((primitive) => primitive.id));
  for (const step of plan.steps) {
    validatePrimitiveStep(step, primitiveIds, warnings);
  }

  const sorted = [...plan.steps].sort((left, right) => {
    const leftStart = isRecord(left) && typeof left.start === 'number' ? left.start : Number.POSITIVE_INFINITY;
    const rightStart = isRecord(right) && typeof right.start === 'number' ? right.start : Number.POSITIVE_INFINITY;
    return leftStart - rightStart;
  });
  validatePrimitivePlanCoverage(sorted, input, warnings);
  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1] as Partial<PrimitiveStep>;
    const current = sorted[index] as Partial<PrimitiveStep>;
    if (typeof previous.end === 'number' && typeof current.start === 'number' && current.start < previous.end - 0.001) {
      warnings.push(`Overlapping primitive steps: ${String(previous.id)} -> ${String(current.id)}`);
    }
  }

  return { valid: warnings.length === 0, warnings };
}

function validatePrimitivePlanCoverage(
  steps: unknown[],
  input: BehaviorGenerationInput,
  warnings: string[]
): void {
  if (steps.length === 0) {
    warnings.push('Primitive plan must contain at least one step');
    return;
  }

  const range = resolveExpectedPlanRange(input);
  if (!range) return;
  const first = steps[0] as Partial<PrimitiveStep>;
  const last = steps[steps.length - 1] as Partial<PrimitiveStep>;
  if (typeof first.start === 'number' && first.start - range.start > 0.001) {
    warnings.push(`Primitive plan must start at ${range.start}`);
  }
  if (typeof last.end === 'number' && range.end - last.end > 0.001) {
    warnings.push(`Primitive plan must end at ${range.end}`);
  }

  for (let index = 1; index < steps.length; index += 1) {
    const previous = steps[index - 1] as Partial<PrimitiveStep>;
    const current = steps[index] as Partial<PrimitiveStep>;
    if (typeof previous.end !== 'number' || typeof current.start !== 'number') continue;
    if (current.start - previous.end > 0.001) {
      warnings.push(`Gap between primitive steps: ${String(previous.id)} -> ${String(current.id)}`);
    }
  }
}

function resolveExpectedPlanRange(input: BehaviorGenerationInput): { start: number; end: number } | null {
  if (input.segments.length > 0) {
    const starts = input.segments.map((segment) => segment.start).filter(Number.isFinite);
    const ends = input.segments.map((segment) => segment.end).filter(Number.isFinite);
    if (starts.length > 0 && ends.length > 0) {
      return {
        start: Math.min(...starts),
        end: Math.max(...ends)
      };
    }
  }
  const primitives = resolvePrimitiveCatalog(input);
  if (primitives.length === 0) return null;
  return {
    start: Math.min(...primitives.map((primitive) => primitive.start)),
    end: Math.max(...primitives.map((primitive) => primitive.end))
  };
}

export function compilePrimitivePlan(
  plan: PrimitivePlan,
  input: BehaviorGenerationInput,
  options: {
    source: BehaviorTimeline['source'];
    fallbackUsed: boolean;
    warnings: string[];
  }
): BehaviorTimeline {
  const primitives = resolvePrimitiveCatalog(input);
  const modules = plan.steps
    .map((step, index) => compilePrimitiveStep(step, primitives, input, index))
    .sort((left, right) => left.start - right.start);

  return {
    source: options.source,
    modules,
    generatedAt: plan.generatedAt,
    metadata: {
      modelName: plan.metadata?.modelName,
      fallbackUsed: options.fallbackUsed,
      validationWarnings: [...options.warnings, ...(plan.metadata?.validationWarnings ?? [])],
      styleApplied: input.styleProfile?.primaryStyle ?? 'unknown',
      strategyNotes: [
        ...(plan.metadata?.strategyNotes ?? []),
        'behavior compiled from primitive plan'
      ]
    }
  };
}

export function resolvePrimitiveCatalog(input: BehaviorGenerationInput): MusicPrimitive[] {
  if (input.primitives && input.primitives.length > 0) {
    return input.primitives;
  }
  return extractMusicPrimitives(input.segments);
}

function compilePrimitiveStep(
  step: PrimitiveStep,
  primitives: MusicPrimitive[],
  input: BehaviorGenerationInput,
  index: number
): BehaviorModule {
  const selected = step.primitiveIds
    .map((id) => primitives.find((primitive) => primitive.id === id))
    .filter((primitive): primitive is MusicPrimitive => Boolean(primitive));
  const strongest = selected.sort((left, right) => right.strength - left.strength)[0];
  const kinds = new Set(selected.map((primitive) => primitive.kind));
  const segment = input.segments.find((candidate) => midpoint(step) >= candidate.start - 0.001 && midpoint(step) <= candidate.end + 0.001)
    ?? input.segments[strongest?.segmentIndex ?? 0]
    ?? input.segments[0];
  const attack = choosePrimitiveAttack(kinds, step, input.difficulty, index);
  const movement = choosePrimitiveMovement(kinds, step, attack, index);
  const pressureLevel = attack === 'none'
    ? 10
    : Math.round(clamp(28 + step.intensity * 54 + input.difficulty * 8 + (step.coupling === 'climax' ? 10 : 0), 0, 100));
  const bulletCount = attack === 'none'
    ? 0
    : Math.round(clamp(4 + step.intensity * 12 + input.difficulty * 2 + (step.coupling === 'climax' ? 4 : 0), 1, 24));
  const bulletSpeed = attack === 'none'
    ? 0
    : clamp(135 + step.intensity * 85 + (input.bpm > 138 ? 20 : 0), 80, 280);

  return {
    id: `${segment?.label ?? 'verse'}-${step.start.toFixed(2)}-${step.phaseRole}-${index}`,
    presetId: `primitive-${step.coupling}-${[...kinds].join('+') || 'fallback'}`,
    start: step.start,
    end: step.end,
    segmentLabel: segment?.label ?? 'verse',
    intent: step.intent,
    phaseRole: step.phaseRole,
    movement,
    attack,
    bulletCount,
    bulletSpeed,
    fireWindowBeats: step.phaseRole === 'burst' || step.coupling === 'climax' ? 1 : step.phaseRole === 'pressure' ? 2 : 4,
    warningIntensity: clamp(0.22 + step.intensity * 0.58 + (step.coupling === 'climax' ? 0.12 : 0), 0, 0.96),
    pressureLevel,
    transitionIn: kinds.has('flux-break') || step.coupling === 'climax' ? 'snap' : 'blend',
    transitionOut: step.phaseRole === 'recovery' ? 'blend' : step.coupling === 'climax' ? 'snap' : 'blend'
  };
}

function validatePrimitiveStep(step: unknown, primitiveIds: Set<string>, warnings: string[]): void {
  if (!isRecord(step)) {
    warnings.push('Invalid primitive step: expected object');
    return;
  }
  const id = String(step.id ?? 'unknown');
  if (typeof step.id !== 'string' || step.id.length === 0) warnings.push('Missing primitive step id');
  if (!Number.isFinite(step.start) || !Number.isFinite(step.end) || !(Number(step.end) > Number(step.start))) {
    warnings.push(`Invalid primitive step duration: ${id}`);
  }
  if (!Array.isArray(step.primitiveIds) || step.primitiveIds.length === 0) {
    warnings.push(`Primitive step must reference primitives: ${id}`);
  } else {
    for (const primitiveId of step.primitiveIds) {
      if (typeof primitiveId !== 'string' || !primitiveIds.has(primitiveId)) {
        warnings.push(`Unknown primitive id: ${String(primitiveId)}`);
      }
    }
  }
  if (!['warmup', 'pressure', 'chase', 'lockdown', 'burst', 'release'].includes(String(step.intent))) {
    warnings.push(`Invalid primitive step intent: ${id}`);
  }
  if (!['setup', 'pressure', 'burst', 'reposition', 'recovery'].includes(String(step.phaseRole))) {
    warnings.push(`Invalid primitive step phaseRole: ${id}`);
  }
  if (!['single', 'layered', 'climax'].includes(String(step.coupling))) {
    warnings.push(`Invalid primitive step coupling: ${id}`);
  }
  if (!Number.isFinite(step.intensity) || Number(step.intensity) < 0 || Number(step.intensity) > 1) {
    warnings.push(`Invalid primitive step intensity: ${id}`);
  }
}

function buildStepPrimitiveIds(primitive: MusicPrimitive, sameSpan: MusicPrimitive[]): string[] {
  if (primitive.kind === 'climax') {
    return sameSpan
      .filter((candidate) => candidate.kind === 'climax' || candidate.kind === 'dense-pressure' || candidate.kind === 'bright-beam' || candidate.kind === 'bass-impact')
      .map((candidate) => candidate.id);
  }
  if (primitive.kind === 'dense-pressure') {
    return sameSpan
      .filter((candidate) => candidate.kind === 'dense-pressure' || candidate.kind === 'bright-beam' || candidate.kind === 'bass-impact')
      .map((candidate) => candidate.id);
  }
  return [primitive.id];
}

function couplingForPrimitives(ids: string[], primitives: MusicPrimitive[]): PrimitiveCoupling {
  const kinds = ids
    .map((id) => primitives.find((primitive) => primitive.id === id)?.kind)
    .filter((kind): kind is MusicPrimitiveKind => Boolean(kind));
  if (kinds.includes('climax')) return 'climax';
  return ids.length > 1 ? 'layered' : 'single';
}

function choosePrimitiveAttack(kinds: Set<MusicPrimitiveKind>, step: PrimitiveStep, difficulty: number, moduleIndex: number): AttackMode {
  if (step.coupling === 'climax' || kinds.has('climax')) {
    if (kinds.has('bright-beam')) return moduleIndex % 2 === 0 ? 'laser-barrage' : 'cone-cleave';
    if (kinds.has('bass-impact')) return pickByIndex(['charge-sweep', 'ground-slam', 'charge-strike'], moduleIndex);
    return difficulty > 1.2 ? 'laser-barrage' : 'explosive-burst';
  }
  if (kinds.has('bright-beam')) return step.phaseRole === 'burst' || step.intensity > 0.82 ? 'laser-barrage' : 'laser-ray';
  if (kinds.has('bass-impact')) {
    if (step.phaseRole === 'burst' || step.intensity > 0.84) {
      return moduleIndex % 2 === 0 ? 'ground-slam' : 'charge-sweep';
    }
    return pickByIndex(['charge-strike', 'ground-slam', 'explosive-burst'], moduleIndex);
  }
  if (kinds.has('flux-break')) return 'explosive-burst';
  if (kinds.has('dense-pressure')) return difficulty > 1.2 ? 'charge-sweep' : 'screen-ring';
  if (kinds.has('stable-groove')) return 'aimed-burst';
  return step.intent === 'warmup' ? 'sparse-ring' : 'melee-sweep';
}

function choosePrimitiveMovement(kinds: Set<MusicPrimitiveKind>, step: PrimitiveStep, attack: AttackMode, moduleIndex: number): MovementMode {
  if (step.coupling === 'climax') {
    return pickByIndex(['shake', 'dash', 'chase'], moduleIndex);
  }
  if (kinds.has('bass-impact')) {
    if (attack === 'ground-slam') return moduleIndex % 2 === 0 ? 'shake' : 'dash';
    if (attack === 'charge-sweep') return 'chase';
    return pickByIndex(['chase', 'dash', 'outer-orbit'], moduleIndex);
  }
  if (attack === 'laser-ray' || attack === 'laser-barrage' || kinds.has('bright-beam')) return 'keep-distance';
  if (kinds.has('flux-break')) return 'dash';
  if (step.phaseRole === 'reposition') return 'outer-orbit';
  return step.intent === 'warmup' ? 'wander' : 'chase';
}

function intentForPrimitive(kind: MusicPrimitiveKind): CombatIntent {
  if (kind === 'bass-impact') return 'chase';
  if (kind === 'bright-beam') return 'lockdown';
  if (kind === 'flux-break') return 'burst';
  if (kind === 'climax') return 'burst';
  if (kind === 'stable-groove') return 'pressure';
  return 'pressure';
}

function intentForSegment(label: BehaviorGenerationInput['segments'][number]['label'], energy: number): CombatIntent {
  if (label === 'intro') return 'warmup';
  if (label === 'outro') return 'release';
  if (energy > 0.72) return 'burst';
  return 'pressure';
}

function roleForPrimitive(kind: MusicPrimitiveKind, strength: number): PhaseRole {
  if (kind === 'climax' || strength > 0.86) return 'burst';
  if (kind === 'flux-break') return 'reposition';
  if (kind === 'bass-impact' && strength > 0.62) return 'pressure';
  if (kind === 'stable-groove') return 'pressure';
  return strength > 0.72 ? 'pressure' : 'setup';
}

function roleForSegment(energy: number): PhaseRole {
  if (energy < 0.24) return 'setup';
  if (energy > 0.72) return 'burst';
  return 'pressure';
}

function midpoint(step: PrimitiveStep): number {
  return (step.start + step.end) / 2;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function pickByIndex<T>(values: T[], index: number): T {
  return values[index % values.length];
}

function roundTime(value: number): number {
  return Math.round(value * 1000) / 1000;
}
