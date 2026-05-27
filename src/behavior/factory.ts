import { createRuleTimeline } from './rules.js';
import { buildBehaviorPromptInput } from './prompt.js';
import { compilePrimitivePlan, createDefaultPrimitivePlan, validatePrimitivePlan } from './primitives.js';
import { validateBehaviorTimeline } from './validate.js';
import type { BehaviorGenerationInput, BehaviorPromptInput, BehaviorTimeline, PrimitivePlan } from './types.js';

export { buildBehaviorPromptInput } from './prompt.js';
export type { BehaviorGenerationInput, BehaviorTimeline, BehaviorModule, BehaviorPromptInput, PrimitivePlan } from './types.js';

export interface LlmBehaviorProvider {
  generate(input: BehaviorGenerationInput, prompt?: BehaviorPromptInput): Promise<BehaviorTimeline | PrimitivePlan>;
}

export interface BehaviorStrategyOptions {
  strategy: 'rules' | 'llm-preferred';
  llmProvider?: LlmBehaviorProvider;
}

export function createRuleBehaviorTimeline(input: BehaviorGenerationInput): BehaviorTimeline {
  return createRuleFallback(input, []);
}

export async function createBehaviorTimeline(
  input: BehaviorGenerationInput,
  options: BehaviorStrategyOptions
): Promise<BehaviorTimeline> {
  const behaviorInput = createFlexibleBehaviorInput(input);
  if (options.strategy === 'llm-preferred' && options.llmProvider) {
    try {
      const prompt = buildBehaviorPromptInput(behaviorInput);
      const providerResult = normalizeProviderResult(await options.llmProvider.generate(behaviorInput, prompt), behaviorInput);
      const candidate = providerResult.timeline;
      const warnings = [
        ...providerResult.warnings,
        ...validateStyleAlignment(candidate, behaviorInput)
      ];
      const candidateWithSections = {
        ...candidate,
        modules: splitModulesAtFlexibleSectionBoundaries(
          Array.isArray(candidate.modules) ? candidate.modules : [],
          behaviorInput
        )
      };
      const validation = validateBehaviorTimeline(candidateWithSections);
      const mergedWarnings = [...validation.warnings, ...warnings];
      if (mergedWarnings.length === 0) {
        const modules = applyMusicContextToModules(candidateWithSections.modules, behaviorInput);
        return {
          ...candidateWithSections,
          modules,
          metadata: {
            ...candidate.metadata,
            fallbackUsed: false,
            validationWarnings: []
          }
        };
      }
      return createRuleFallback(behaviorInput, mergedWarnings);
    } catch (error) {
      return createRuleFallback(behaviorInput, [error instanceof Error ? error.message : String(error)]);
    }
  }
  return createRuleBehaviorTimeline(behaviorInput);
}

function createFlexibleBehaviorInput(input: BehaviorGenerationInput): BehaviorGenerationInput {
  return {
    ...input,
    segments: combineWeakAdjacentSegments(input.segments)
  };
}

function combineWeakAdjacentSegments(
  segments: BehaviorGenerationInput['segments']
): BehaviorGenerationInput['segments'] {
  if (segments.length <= 1 || !segments.some(hasExplicitFft)) return segments;
  const sorted = [...segments].sort((left, right) => left.start - right.start);
  const groups: BehaviorGenerationInput['segments'] = [];

  for (const segment of sorted) {
    const previous = groups[groups.length - 1];
    if (previous && !isStrongSegmentBoundary(previous, segment) && previous.end - previous.start < 24) {
      groups[groups.length - 1] = mergeSegments(previous, segment);
    } else {
      groups.push({ ...segment });
    }
  }

  return groups;
}

function mergeSegments(
  left: BehaviorGenerationInput['segments'][number],
  right: BehaviorGenerationInput['segments'][number]
): BehaviorGenerationInput['segments'][number] {
  const leftDuration = Math.max(0.001, left.end - left.start);
  const rightDuration = Math.max(0.001, right.end - right.start);
  const duration = leftDuration + rightDuration;
  const weighted = (leftValue: number | undefined, rightValue: number | undefined): number | undefined => {
    if (!Number.isFinite(leftValue) || !Number.isFinite(rightValue)) return undefined;
    return ((leftValue as number) * leftDuration + (rightValue as number) * rightDuration) / duration;
  };
  const energy = weighted(left.energy, right.energy) ?? Math.max(left.energy, right.energy);
  return {
    start: left.start,
    end: right.end,
    label: pickDominantLabel(left, right),
    energy,
    lowFreqWeight: weighted(left.lowFreqWeight, right.lowFreqWeight),
    highFreqWeight: weighted(left.highFreqWeight, right.highFreqWeight),
    stability: weighted(left.stability, right.stability),
    spectralCentroid: weighted(left.spectralCentroid, right.spectralCentroid),
    spectralFlux: weighted(left.spectralFlux, right.spectralFlux),
    beatDensity: weighted(left.beatDensity, right.beatDensity),
    intensity: weighted(left.intensity, right.intensity)
  };
}

function pickDominantLabel(
  left: BehaviorGenerationInput['segments'][number],
  right: BehaviorGenerationInput['segments'][number]
): BehaviorGenerationInput['segments'][number]['label'] {
  if (right.energy > left.energy + 0.12) return right.label;
  if (left.energy > right.energy + 0.12) return left.label;
  if (left.label === 'intro' || left.label === 'outro') return right.label;
  return left.label;
}

function normalizeProviderResult(
  result: BehaviorTimeline | PrimitivePlan | string,
  input: BehaviorGenerationInput
): { timeline: BehaviorTimeline; warnings: string[] } {
  const parsed = typeof result === 'string'
    ? JSON.parse(extractJsonPayload(result)) as BehaviorTimeline | PrimitivePlan
    : result;
  if (isPrimitivePlan(parsed)) {
    const validation = validatePrimitivePlan(parsed, input);
    if (!validation.valid) {
      throw new Error(validation.warnings.join('; '));
    }
    return {
      timeline: compilePrimitivePlan(parsed, input, {
        source: 'llm',
        fallbackUsed: false,
        warnings: []
      }),
      warnings: []
    };
  }
  return { timeline: parsed as BehaviorTimeline, warnings: [] };
}

function extractJsonPayload(text: string): string {
  const trimmed = text.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return fenced ? fenced[1] : trimmed;
}

function validateStyleAlignment(candidate: BehaviorTimeline, input: BehaviorGenerationInput): string[] {
  const expected = input.styleProfile?.primaryStyle;
  const actual = candidate.metadata?.styleApplied;
  if (!expected || !actual || candidate.source !== 'llm') return [];
  return actual === expected ? [] : [`Style mismatch: expected ${expected}, got ${actual}`];
}

function createRuleFallback(input: BehaviorGenerationInput, warnings: string[]): BehaviorTimeline {
  if (input.primitives && input.primitives.length > 0) {
    const plan = createDefaultPrimitivePlan(input);
    return compilePrimitivePlan(plan, input, {
      source: 'rules',
      fallbackUsed: warnings.length > 0,
      warnings
    });
  }

  const modules = applyMusicContextToModules(
    alignModulesToBeatGrid(
      normalizeRuleModules(createRuleTimeline(input), input),
      input.beatGrid,
      resolveStrongSegmentBoundaries(input)
    ),
    input
  );
  return {
    source: 'rules',
    modules,
    generatedAt: Date.now(),
    metadata: {
      fallbackUsed: warnings.length > 0,
      validationWarnings: warnings,
      styleApplied: input.styleProfile?.primaryStyle ?? 'unknown',
      strategyNotes: [
        warnings.length > 0
          ? 'rule fallback used after llm validation failed'
          : 'rule fallback used by selected strategy'
      ]
    }
  };
}

function applyMusicContextToModules(
  modules: BehaviorTimeline['modules'],
  input: BehaviorGenerationInput
): BehaviorTimeline['modules'] {
  return modules.map((module, index) => {
    const segment = findSegmentForModule(module, input);
    if (!segment) return module;
    const previous = input.segments
      .filter((candidate) => candidate.end <= segment.start)
      .sort((left, right) => right.end - left.end)[0];
    const adapted = adaptModuleToSegmentFft(module, segment, previous?.energy ?? segment.energy, input.bpm, index);
    return {
      ...adapted,
      id: `${adapted.segmentLabel}-${adapted.start.toFixed(2)}-${adapted.phaseRole}-${index}`,
      presetId: hasExplicitFft(segment)
        ? (adapted.presetId.includes('-fft') ? adapted.presetId : `${adapted.presetId}-fft`)
        : adapted.presetId
    };
  });
}

function splitModulesAtFlexibleSectionBoundaries(
  modules: BehaviorTimeline['modules'],
  input: BehaviorGenerationInput
): BehaviorTimeline['modules'] {
  if (input.segments.length === 0) return modules;
  const boundaries = resolveStrongSegmentBoundaries(input);

  const split: BehaviorTimeline['modules'] = [];
  for (const module of modules) {
    const cuts = boundaries.filter((time) => time > module.start + 0.001 && time < module.end - 0.001);
    const points = [module.start, ...cuts, module.end];
    for (let index = 0; index < points.length - 1; index += 1) {
      const start = points[index];
      const end = points[index + 1];
      const segment = findSegmentAtTime((start + end) / 2, input);
      split.push({
        ...module,
        id: `${module.id}-seg${split.length}`,
        start,
        end,
        segmentLabel: segment?.label ?? module.segmentLabel
      });
    }
  }

  return split.sort((left, right) => left.start - right.start);
}

function findSegmentForModule(
  module: BehaviorTimeline['modules'][number],
  input: BehaviorGenerationInput
): BehaviorGenerationInput['segments'][number] | null {
  return findSegmentAtTime((module.start + module.end) / 2, input)
    ?? input.segments.find((segment) => segment.label === module.segmentLabel)
    ?? null;
}

function findSegmentAtTime(
  time: number,
  input: BehaviorGenerationInput
): BehaviorGenerationInput['segments'][number] | null {
  return input.segments.find((segment) => time >= segment.start - 0.001 && time <= segment.end + 0.001) ?? null;
}

function adaptModuleToSegmentFft(
  module: BehaviorTimeline['modules'][number],
  segment: BehaviorGenerationInput['segments'][number],
  previousEnergy: number,
  bpm: number,
  moduleIndex: number
): BehaviorTimeline['modules'][number] {
  const hasFft = hasExplicitFft(segment);
  const low = clamp01(segment.lowFreqWeight ?? segment.energy * 0.55);
  const high = clamp01(segment.highFreqWeight ?? segment.energy * 0.35);
  const stability = clamp01(segment.stability ?? 0.65);
  const energyDelta = segment.energy - previousEnergy;
  const spectralCentroid = clamp01(segment.spectralCentroid ?? estimateSpectralCentroid(low, high));
  const spectralFlux = clamp01(segment.spectralFlux ?? Math.max(0, energyDelta));
  const beatDensity = clamp01(segment.beatDensity ?? segment.energy * 0.65 + stability * 0.25);
  const intensity = clamp01(segment.intensity ?? (
    segment.energy * 0.45
    + beatDensity * 0.18
    + low * 0.12
    + high * 0.1
    + spectralFlux * 0.15
  ));
  if (!hasFft) {
    return {
      ...module,
      segmentLabel: segment.label
    };
  }

  if (module.presetId.startsWith('primitive-')) {
    const pressureLevel = module.attack === 'none'
      ? module.pressureLevel
      : Math.max(module.pressureLevel, Math.round(28 + intensity * 62 + spectralFlux * 10));
    return {
      ...module,
      segmentLabel: segment.label,
      pressureLevel,
      warningIntensity: clamp(module.warningIntensity + spectralFlux * 0.06, 0.18, segment.label === 'intro' ? 0.72 : 0.96)
    };
  }

  const canStayPassive = (segment.label === 'intro' || segment.label === 'outro')
    && (module.phaseRole === 'setup' || module.phaseRole === 'recovery')
    && segment.energy < 0.28;
  const attack = canStayPassive
    ? module.attack
    : chooseFftAttack(module.attack, segment.label, module.phaseRole, segment.energy, low, high, stability, spectralCentroid, spectralFlux, intensity, energyDelta, bpm, moduleIndex);
  const movement = reinforceThreatMovement(
    attack,
    chooseFftMovement(module.movement, module.phaseRole, segment.energy, low, high, stability, spectralFlux, intensity, moduleIndex),
    module.phaseRole,
    segment.energy,
    intensity
  );
  const intensityBoost = clamp(
    segment.energy * 0.14
    + intensity * 0.12
    + spectralFlux * 0.12
    + Math.max(0, energyDelta) * 0.22
    + Math.abs(high - low) * 0.1,
    0,
    0.28
  );
  const pressureLevel = attack === 'none'
    ? Math.min(module.pressureLevel, 18)
    : Math.max(module.pressureLevel, Math.round(28 + intensity * 62 + spectralFlux * 12 + intensityBoost * 36));

  return {
    ...module,
    segmentLabel: segment.label,
    attack,
    movement,
    bulletCount: attack === 'none' ? 0 : Math.max(1, module.bulletCount),
    bulletSpeed: attack === 'none' ? 0 : Math.max(module.bulletSpeed, bpm > 140 ? 180 : 145),
    fireWindowBeats: normalizeFireWindow(module.fireWindowBeats, segment.energy, stability),
    warningIntensity: clamp(module.warningIntensity + intensityBoost, 0.18, segment.label === 'intro' ? 0.72 : 0.96),
    pressureLevel,
    transitionIn: energyDelta > 0.16 || spectralFlux > 0.6 || Math.abs(high - low) > 0.22 ? 'snap' : module.transitionIn
  };
}

function chooseFftAttack(
  current: BehaviorTimeline['modules'][number]['attack'],
  label: BehaviorGenerationInput['segments'][number]['label'],
  phaseRole: BehaviorTimeline['modules'][number]['phaseRole'],
  energy: number,
  low: number,
  high: number,
  stability: number,
  spectralCentroid: number,
  spectralFlux: number,
  intensity: number,
  energyDelta: number,
  bpm: number,
  moduleIndex: number
): BehaviorTimeline['modules'][number]['attack'] {
  if (label === 'intro' && energy < 0.32 && current !== 'none') return 'sparse-ring';
  if (phaseRole === 'setup') {
    if (intensity >= 0.8 && energy >= 0.78 && (label === 'chorus' || label === 'drop')) {
      return high >= low ? 'laser-barrage' : 'ground-slam';
    }
    if (energy > 0.68 || intensity > 0.72) return high > low ? 'laser-ray' : 'charge-strike';
    return current === 'none' ? 'melee-sweep' : current;
  }
  if (phaseRole === 'reposition') {
    if (high > low + 0.08) return 'laser-ray';
    if (low > high + 0.08) return 'charge-strike';
    return 'melee-sweep';
  }
  if (phaseRole === 'recovery') return energy > 0.74 || intensity > 0.78 ? 'melee-sweep' : current;
  if (intensity >= 0.8 && energy >= 0.78 && (label === 'chorus' || label === 'drop')) {
    if (phaseRole === 'burst') {
      return high >= low ? 'cone-cleave' : 'ground-slam';
    }
    return high >= low ? 'laser-barrage' : 'charge-sweep';
  }
  if (intensity > 0.9 && energy > 0.82) {
    return high >= low ? 'laser-barrage' : 'charge-sweep';
  }
  if (spectralFlux > 0.62 && intensity > 0.58) {
    return spectralCentroid > 0.55 || high > low + 0.08
      ? 'laser-ray'
      : 'explosive-burst';
  }
  if (high > low + 0.1 || (bpm >= 140 && high > 0.24)) {
    return pickByIndex(
      energy >= 0.68 || high > 0.55 || label === 'drop'
        ? ['laser-ray', 'melee-sweep', 'charge-strike']
        : ['laser-ray', 'melee-sweep', 'charge-strike'],
      moduleIndex
    );
  }
  if (low > high + 0.1) {
    return pickByIndex(
      energy > 0.7 || label === 'drop'
        ? ['explosive-burst', 'charge-strike', 'screen-ring']
        : ['charge-strike', 'melee-sweep', 'explosive-burst'],
      moduleIndex
    );
  }
  if (energyDelta > 0.16) return energy > 0.72 ? 'explosive-burst' : 'charge-strike';
  if (stability < 0.44) return energy > 0.64 ? 'explosive-burst' : 'melee-sweep';
  if (label === 'bridge' && energy < 0.68) return 'melee-sweep';
  if (energy > 0.78 || label === 'chorus') return moduleIndex % 2 === 0 ? 'explosive-burst' : 'laser-ray';
  if (current === 'none') return 'melee-sweep';
  return current;
}

function reinforceThreatMovement(
  attack: BehaviorTimeline['modules'][number]['attack'],
  movement: BehaviorTimeline['modules'][number]['movement'],
  phaseRole: BehaviorTimeline['modules'][number]['phaseRole'],
  energy: number,
  intensity: number
): BehaviorTimeline['modules'][number]['movement'] {
  if (attack === 'melee-sweep') {
    if (movement === 'chase' || movement === 'dash' || movement === 'shake') return movement;
    if (energy > 0.56 || intensity > 0.62 || phaseRole === 'pressure' || phaseRole === 'burst') return 'chase';
    return 'dash';
  }

  if (attack === 'charge-sweep' && movement !== 'shake') {
    return 'chase';
  }

  return movement;
}

function chooseFftMovement(
  current: BehaviorTimeline['modules'][number]['movement'],
  phaseRole: BehaviorTimeline['modules'][number]['phaseRole'],
  energy: number,
  low: number,
  high: number,
  stability: number,
  spectralFlux: number,
  intensity: number,
  moduleIndex: number
): BehaviorTimeline['modules'][number]['movement'] {
  if (phaseRole === 'setup') return energy > 0.64 ? 'keep-distance' : current === 'idle' ? 'wander' : current;
  if (phaseRole === 'reposition') return moduleIndex % 2 === 0 ? 'outer-orbit' : 'keep-distance';
  if (phaseRole === 'recovery') return energy > 0.72 ? 'keep-distance' : 'wander';
  if (energy > 0.82 || intensity > 0.82 || spectralFlux > 0.66 || stability < 0.4) return 'shake';
  if (high > low + 0.1) return 'outer-orbit';
  if (low > high + 0.1) return 'chase';
  return current === 'idle' && energy > 0.38 ? 'wander' : current;
}

function normalizeFireWindow(current: number, energy: number, stability: number): number {
  if (energy > 0.78 || stability < 0.44) return 1;
  if (energy > 0.55) return Math.min(2, Math.max(1, current));
  return [1, 2, 4, 8].includes(current) ? current : 4;
}

function hasExplicitFft(segment: BehaviorGenerationInput['segments'][number]): boolean {
  return Number.isFinite(segment.lowFreqWeight) && Number.isFinite(segment.highFreqWeight);
}

function isPrimitivePlan(value: unknown): value is PrimitivePlan {
  return typeof value === 'object'
    && value !== null
    && (value as { source?: unknown }).source === 'primitive-plan'
    && Array.isArray((value as { steps?: unknown }).steps);
}

function resolveStrongSegmentBoundaries(input: BehaviorGenerationInput): number[] {
  if (input.segments.length === 0) return [];
  const boundaries = new Set<number>([
    input.segments[0].start,
    input.segments[input.segments.length - 1].end
  ]);
  for (let index = 1; index < input.segments.length; index += 1) {
    const previous = input.segments[index - 1];
    const current = input.segments[index];
    if (isStrongSegmentBoundary(previous, current)) {
      boundaries.add(current.start);
    }
  }
  return [...boundaries].filter(Number.isFinite).sort((left, right) => left - right);
}

function isStrongSegmentBoundary(
  previous: BehaviorGenerationInput['segments'][number],
  current: BehaviorGenerationInput['segments'][number]
): boolean {
  const previousDuration = previous.end - previous.start;
  const currentDuration = current.end - current.start;
  if (previous.label !== current.label && Math.max(previousDuration, currentDuration) >= 7) return true;
  const energyDelta = Math.abs(current.energy - previous.energy);
  if (energyDelta >= 0.18) return true;
  if (hasExplicitFft(previous) && hasExplicitFft(current)) {
    const previousTilt = spectralTilt(previous);
    const currentTilt = spectralTilt(current);
    if (previousTilt !== currentTilt && energyDelta >= 0.08) return true;
  }
  return previousDuration >= 14 && currentDuration >= 14 && previous.label !== current.label;
}

function spectralTilt(segment: BehaviorGenerationInput['segments'][number]): 'low' | 'high' | 'balanced' {
  const low = segment.lowFreqWeight ?? 0;
  const high = segment.highFreqWeight ?? 0;
  if (low > high + 0.1) return 'low';
  if (high > low + 0.1) return 'high';
  return 'balanced';
}

function estimateSpectralCentroid(low: number, high: number): number {
  const total = Math.max(0.0001, low + high);
  return clamp01((high * 0.72 + low * 0.18) / total);
}

function pickByIndex<T>(values: T[], index: number): T {
  return values[index % values.length];
}

function alignModulesToBeatGrid(
  modules: BehaviorTimeline['modules'],
  beatGrid: number[],
  preservedBoundaries: number[] = []
): BehaviorTimeline['modules'] {
  if (modules.length <= 1 || beatGrid.length < 2) {
    return modules;
  }

  const sortedBeats = [...new Set(beatGrid.filter(Number.isFinite))]
    .sort((left, right) => left - right);
  if (sortedBeats.length < 2) return modules;

  const minDuration = Math.min(0.18, Math.max(0.08, (sortedBeats[1] - sortedBeats[0]) * 0.35));
  const boundaries = modules.map((module) => module.start);
  boundaries.push(modules[modules.length - 1].end);
  const preserved = new Set(preservedBoundaries.map((time) => Math.round(time * 1000) / 1000));

  for (let index = 1; index < boundaries.length - 1; index += 1) {
    if (preserved.has(Math.round(boundaries[index] * 1000) / 1000)) {
      continue;
    }
    const snapped = nearestBeat(sortedBeats, boundaries[index]);
    if (snapped - boundaries[index - 1] >= minDuration && boundaries[index + 1] - snapped >= minDuration) {
      boundaries[index] = snapped;
    }
  }

  return modules.map((module, index) => ({
    ...module,
    id: `${module.segmentLabel}-${boundaries[index].toFixed(2)}-${module.phaseRole}`,
    start: boundaries[index],
    end: boundaries[index + 1]
  }));
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function nearestBeat(beatGrid: number[], time: number): number {
  let low = 0;
  let high = beatGrid.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (beatGrid[middle] < time) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }

  const next = beatGrid[low];
  const previous = beatGrid[low - 1];
  if (next === undefined) return previous ?? time;
  if (previous === undefined) return next;
  return Math.abs(time - previous) <= Math.abs(time - next) ? previous : next;
}

function normalizeRuleModules(modules: BehaviorTimeline['modules'], input: BehaviorGenerationInput): BehaviorTimeline['modules'] {
  if (modules.length > 0) {
    return modules;
  }

  const duration = Math.max(
    1,
    input.segments[input.segments.length - 1]?.end ?? 0,
    input.beatGrid[input.beatGrid.length - 1] ?? 0
  );

  return [{
    id: 'fallback-idle-0',
    presetId: 'fallback-idle',
    start: 0,
    end: duration,
    segmentLabel: 'intro',
    intent: 'warmup',
    phaseRole: 'recovery',
    movement: 'idle',
    attack: 'none',
    bulletCount: 0,
    bulletSpeed: 0,
    fireWindowBeats: 4,
    warningIntensity: 0.1,
    pressureLevel: 5,
    transitionIn: 'blend',
    transitionOut: 'blend'
  }];
}
