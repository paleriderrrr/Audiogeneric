import { SEGMENT_PROFILES, type SegmentPreset } from './profiles.js';
import type {
  BehaviorGenerationInput,
  BehaviorModule,
  CombatIntent,
  PhaseRole,
  SegmentLabel,
  TransitionMode
} from './types.js';

interface PhaseAssignment {
  preset: SegmentPreset;
  role: PhaseRole;
}

const PHASE_WEIGHTS: Record<PhaseRole, number> = {
  setup: 0.9,
  pressure: 1,
  burst: 1.2,
  reposition: 0.9,
  recovery: 0.8
};

const ROLE_PRESSURE_DELTA: Record<PhaseRole, number> = {
  setup: -10,
  pressure: 0,
  burst: 10,
  reposition: -4,
  recovery: -12
};

const ROLE_BULLET_DELTA: Record<PhaseRole, number> = {
  setup: -2,
  pressure: 0,
  burst: 2,
  reposition: -1,
  recovery: -3
};

const ROLE_SPEED_DELTA: Record<PhaseRole, number> = {
  setup: -10,
  pressure: 0,
  burst: 14,
  reposition: -4,
  recovery: -12
};

const ROLE_WARNING_DELTA: Record<PhaseRole, number> = {
  setup: -0.04,
  pressure: 0,
  burst: 0.08,
  reposition: -0.02,
  recovery: -0.08
};

export function createRuleTimeline(input: BehaviorGenerationInput): BehaviorModule[] {
  const orderedSegments = [...input.segments].sort((left, right) => left.start - right.start);
  const recentPresetIds: string[] = [];
  const modules: BehaviorModule[] = [];

  for (let index = 0; index < orderedSegments.length; index += 1) {
    const segment = orderedSegments[index];
    const previous = orderedSegments[index - 1];
    const profile = SEGMENT_PROFILES[segment.label];
    const primaryPreset = selectPreset(profile.presets, {
      bpm: input.bpm,
      segmentEnergy: segment.energy,
      segmentDuration: segment.end - segment.start,
      previousEnergy: previous?.energy ?? segment.energy,
      recentPresetIds
    });
    const secondaryPreset = shouldBlendSecondaryPreset(segment, input.bpm)
      ? selectPreset(profile.presets, {
        bpm: input.bpm,
        segmentEnergy: Math.max(0, Math.min(1, segment.energy + 0.08)),
        segmentDuration: segment.end - segment.start,
        previousEnergy: previous?.energy ?? segment.energy,
        recentPresetIds: [primaryPreset.id, ...recentPresetIds]
      }, primaryPreset.id)
      : null;
    const assignments = buildPhaseAssignments(primaryPreset, secondaryPreset, segment.end - segment.start);
    const spans = sliceSegment(segment.start, segment.end, assignments.map((assignment) => PHASE_WEIGHTS[assignment.role]));
    const transitionIn = resolveTransitionIn(previous?.energy ?? segment.energy, segment.energy, profile.preferredTransitionIn);

    for (let phaseIndex = 0; phaseIndex < assignments.length; phaseIndex += 1) {
      const assignment = assignments[phaseIndex];
      const span = spans[phaseIndex];
      const module = createPhaseModule({
        input,
        segmentLabel: segment.label,
        segmentEnergy: segment.energy,
        segmentDuration: segment.end - segment.start,
        assignment,
        start: span.start,
        end: span.end,
        transitionIn: phaseIndex === 0 ? transitionIn : assignment.role === 'burst' ? 'snap' : 'blend',
        transitionOut: phaseIndex === assignments.length - 1 ? profile.preferredTransitionOut : 'blend'
      });
      modules.push(module);
      rememberPreset(recentPresetIds, assignment.preset.id);
    }
  }

  return ensurePlayableTimeline(modules);
}

function selectPreset(
  presets: SegmentPreset[],
  context: {
    bpm: number;
    segmentEnergy: number;
    segmentDuration: number;
    previousEnergy: number;
    recentPresetIds: string[];
  },
  excludedPresetId?: string
): SegmentPreset {
  const candidates = presets.filter((preset) => preset.id !== excludedPresetId);
  const ranked = candidates
    .map((preset) => ({
      preset,
      score: scorePreset(preset, context)
    }))
    .sort((left, right) => right.score - left.score);

  return ranked[0]?.preset ?? presets[0];
}

function scorePreset(
  preset: SegmentPreset,
  context: {
    bpm: number;
    segmentEnergy: number;
    segmentDuration: number;
    previousEnergy: number;
    recentPresetIds: string[];
  }
): number {
  const bpmBand = classifyBpmBand(context.bpm);
  const energyMidpoint = (preset.energyRange.min + preset.energyRange.max) / 2;
  const energyDistance = Math.abs(context.segmentEnergy - energyMidpoint);
  const risingEnergy = context.segmentEnergy - context.previousEnergy;
  const repeatedPenalty = context.recentPresetIds.includes(preset.id) ? 0.35 : 0;
  const longSegmentBoost = context.segmentDuration >= 20 && preset.phasePattern.length >= 5 ? 0.16 : 0;
  const burstBoost = risingEnergy > 0.12 && preset.phasePattern.includes('burst') ? 0.08 : 0;
  const bpmScore = preset.bpmBand === 'any' || preset.bpmBand === bpmBand ? 0.12 : -0.04;
  const insideEnergyBand = context.segmentEnergy >= preset.energyRange.min && context.segmentEnergy <= preset.energyRange.max ? 0.16 : 0;

  return insideEnergyBand + bpmScore + longSegmentBoost + burstBoost - energyDistance - repeatedPenalty;
}

function buildPhaseAssignments(
  primaryPreset: SegmentPreset,
  secondaryPreset: SegmentPreset | null,
  duration: number
): PhaseAssignment[] {
  const primaryAssignments = primaryPreset.phasePattern.map((role) => ({ preset: primaryPreset, role }));
  if (duration <= 10 || !secondaryPreset) {
    return duration <= 10
      ? [{ preset: primaryPreset, role: findRole(primaryPreset.phasePattern, ['pressure', 'burst', 'setup']) }]
      : dedupeNeighboringAssignments(trimAssignments(withActionableLead(primaryAssignments), primaryAssignments.length));
  }

  if (duration <= 18) {
    return dedupeNeighboringAssignments(trimAssignments(withActionableLead(primaryAssignments), Math.min(4, primaryAssignments.length)));
  }

  const bridgeAssignments: PhaseAssignment[] = [
    { preset: primaryPreset, role: primaryPreset.phasePattern[0] ?? 'setup' },
    { preset: primaryPreset, role: findRole(primaryPreset.phasePattern, ['pressure', 'setup']) },
    { preset: secondaryPreset, role: findRole(secondaryPreset.phasePattern, ['reposition', 'pressure']) },
    { preset: primaryPreset, role: findRole(primaryPreset.phasePattern, ['burst', 'pressure']) },
    { preset: secondaryPreset, role: findRole(secondaryPreset.phasePattern, ['pressure', 'burst']) },
    { preset: primaryPreset, role: findRole(primaryPreset.phasePattern, ['recovery', 'reposition']) }
  ];

  return dedupeNeighboringAssignments(withActionableLead(bridgeAssignments));
}

function trimAssignments(assignments: PhaseAssignment[], maxCount: number): PhaseAssignment[] {
  return assignments.slice(0, Math.max(1, maxCount));
}

function withActionableLead(assignments: PhaseAssignment[]): PhaseAssignment[] {
  const actionableIndex = assignments.findIndex((assignment) => assignment.role === 'pressure' || assignment.role === 'burst');
  if (actionableIndex <= 0) {
    return assignments;
  }
  return [
    assignments[actionableIndex],
    ...assignments.slice(0, actionableIndex),
    ...assignments.slice(actionableIndex + 1)
  ];
}

function dedupeNeighboringAssignments(assignments: PhaseAssignment[]): PhaseAssignment[] {
  const deduped: PhaseAssignment[] = [];
  for (const assignment of assignments) {
    const previous = deduped[deduped.length - 1];
    if (previous && previous.preset.id === assignment.preset.id && previous.role === assignment.role) {
      continue;
    }
    deduped.push(assignment);
  }
  return deduped;
}

function findRole(pattern: PhaseRole[], fallbacks: PhaseRole[]): PhaseRole {
  for (const role of fallbacks) {
    if (pattern.includes(role)) return role;
  }
  return pattern[0] ?? 'pressure';
}

function createPhaseModule(config: {
  input: BehaviorGenerationInput;
  segmentLabel: SegmentLabel;
  segmentEnergy: number;
  segmentDuration: number;
  assignment: PhaseAssignment;
  start: number;
  end: number;
  transitionIn: TransitionMode;
  transitionOut: TransitionMode;
}): BehaviorModule {
  const profile = SEGMENT_PROFILES[config.segmentLabel];
  const energyFactor = config.segmentEnergy;
  const difficulty = clamp(config.input.difficulty, 0.3, 2);
  const role = config.assignment.role;
  const preset = config.assignment.preset;
  const pressureBase = profile.pressureRange.min + (profile.pressureRange.max - profile.pressureRange.min) * energyFactor;
  const bulletBase = profile.bulletCountRange.min + (profile.bulletCountRange.max - profile.bulletCountRange.min) * energyFactor;
  const speedBase = profile.bulletSpeedRange.min + (profile.bulletSpeedRange.max - profile.bulletSpeedRange.min) * energyFactor;
  const warningBase = profile.warningRange.min + (profile.warningRange.max - profile.warningRange.min) * energyFactor;
  const bulletFactor = difficulty < 1 ? 0.82 + difficulty * 0.18 : 1 + (difficulty - 1) * 0.4;
  const speedFactor = difficulty < 1 ? 0.9 + difficulty * 0.1 : 1 + (difficulty - 1) * 0.18;
  let pressureLevel = clamp(
    Math.round(pressureBase + preset.pressureBias + ROLE_PRESSURE_DELTA[role] + (difficulty - 1) * 16),
    profile.pressureRange.min,
    profile.pressureRange.max
  );
  const bulletCount = Math.round(clamp(
    (bulletBase + preset.bulletCountBias + ROLE_BULLET_DELTA[role]) * bulletFactor,
    profile.bulletCountRange.min,
    profile.bulletCountRange.max
  ));
  const bulletSpeed = clamp(
    (speedBase + preset.bulletSpeedBias + ROLE_SPEED_DELTA[role] + (config.input.bpm > 140 ? 8 : config.input.bpm < 90 ? -8 : 0)) * speedFactor,
    profile.bulletSpeedRange.min,
    profile.bulletSpeedRange.max
  );
  const warningIntensity = clamp(
    warningBase
      + preset.warningBias
      + ROLE_WARNING_DELTA[role]
      + (difficulty - 1) * 0.08
      + (config.input.bpm < 90 ? 0.05 : config.input.bpm > 140 ? -0.03 : 0),
    profile.warningRange.min,
    profile.warningRange.max
  );
  const attack = sanitizeAttack(profile.forbiddenAttacks, preset.attackByRole[role]);
  const movement = preset.movementByRole[role];
  if (attack !== 'none') {
    pressureLevel = Math.max(24, pressureLevel);
  }

  return {
    id: `${config.segmentLabel}-${config.start.toFixed(2)}-${role}`,
    presetId: preset.id,
    start: config.start,
    end: config.end,
    segmentLabel: config.segmentLabel,
    intent: resolveIntent(config.segmentLabel, preset.intent, role),
    phaseRole: role,
    movement,
    attack,
    bulletCount: attack === 'none' ? 0 : Math.max(1, bulletCount),
    bulletSpeed: attack === 'none' ? 0 : bulletSpeed,
    fireWindowBeats: resolveFireWindowBeats(role, preset.preferredBeats, pressureLevel),
    warningIntensity,
    pressureLevel,
    transitionIn: config.transitionIn,
    transitionOut: config.transitionOut
  };
}

function resolveIntent(segmentLabel: SegmentLabel, presetIntent: CombatIntent, role: PhaseRole): CombatIntent {
  if (segmentLabel === 'intro' && role === 'setup') return 'warmup';
  if (role === 'recovery' && presetIntent === 'release') return 'release';
  if (role === 'recovery' && presetIntent !== 'release') return 'pressure';
  if (role === 'reposition') return presetIntent === 'release' ? 'release' : 'chase';
  if (role === 'burst') return presetIntent === 'warmup' ? 'pressure' : 'burst';
  return presetIntent;
}

function resolveFireWindowBeats(role: PhaseRole, preferredBeats: 2 | 4 | 8, pressureLevel: number): number {
  if (role === 'burst') return 1;
  if (role === 'pressure') return Math.min(3, Math.max(1, preferredBeats / 2));
  if (pressureLevel < 24) return 4;
  return Math.max(2, preferredBeats);
}

function shouldBlendSecondaryPreset(segment: { start: number; end: number; energy: number }, bpm: number): boolean {
  return segment.end - segment.start >= 18 || (segment.energy >= 0.72 && bpm >= 120);
}

function resolveTransitionIn(previousEnergy: number, nextEnergy: number, preferredTransition: TransitionMode): TransitionMode {
  const delta = nextEnergy - previousEnergy;
  if (delta > 0.18) return 'snap';
  if (delta < -0.18) return 'blend';
  return preferredTransition;
}

function classifyBpmBand(bpm: number): 'slow' | 'mid' | 'fast' {
  if (bpm < 96) return 'slow';
  if (bpm > 138) return 'fast';
  return 'mid';
}

function sliceSegment(start: number, end: number, weights: number[]): Array<{ start: number; end: number }> {
  const duration = Math.max(0.001, end - start);
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0) || weights.length;
  let cursor = start;

  return weights.map((weight, index) => {
    const remaining = end - cursor;
    const phaseDuration = index === weights.length - 1
      ? remaining
      : duration * (weight / totalWeight);
    const phaseEnd = index === weights.length - 1 ? end : Math.min(end, cursor + phaseDuration);
    const span = { start: cursor, end: phaseEnd };
    cursor = phaseEnd;
    return span;
  });
}

function rememberPreset(recentPresetIds: string[], presetId: string): void {
  recentPresetIds.unshift(presetId);
  if (recentPresetIds.length > 4) {
    recentPresetIds.length = 4;
  }
}

function sanitizeAttack(forbiddenAttacks: string[] | undefined, attack: string): BehaviorModule['attack'] {
  if (forbiddenAttacks?.includes(attack)) {
    return 'sparse-ring';
  }
  return attack as BehaviorModule['attack'];
}

function ensurePlayableTimeline(modules: BehaviorModule[]): BehaviorModule[] {
  if (modules.some((module) => module.attack !== 'none' && module.bulletCount > 0)) {
    return modules;
  }

  if (modules.length === 0) {
    return modules;
  }

  const targetIndex = modules
    .map((module, index) => ({ module, index, duration: module.end - module.start }))
    .filter(({ module }) => module.segmentLabel !== 'outro')
    .sort((left, right) => right.duration - left.duration)[0]?.index ?? 0;

  return modules.map((module, index) => {
    if (index !== targetIndex) return module;
    return {
      ...module,
      presetId: `${module.presetId}-playable`,
      phaseRole: module.phaseRole === 'recovery' ? 'pressure' : module.phaseRole,
      movement: module.movement === 'idle' ? 'wander' : module.movement,
      attack: 'sparse-ring',
      bulletCount: Math.max(4, module.bulletCount, Math.round((module.pressureLevel + 10) / 10)),
      bulletSpeed: Math.max(120, module.bulletSpeed),
      fireWindowBeats: Math.min(3, Math.max(1, module.fireWindowBeats)),
      pressureLevel: Math.max(24, module.pressureLevel),
      warningIntensity: Math.max(0.24, module.warningIntensity)
    };
  });
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
