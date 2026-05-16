import { createRuleBehaviorTimeline, type BehaviorGenerationInput } from '../behavior/factory.js';
import type { MusicSegment } from '../audio/types.js';

export type SegmentLabel = MusicSegment['label'];
export type BossMovement = 'idle' | 'wander' | 'dash' | 'orbit' | 'shake';
export type BossAttack =
  | 'none'
  | 'sparse-ring'
  | 'aimed-burst'
  | 'screen-ring'
  | 'lane-burst'
  | 'melee-sweep'
  | 'laser-ray'
  | 'explosive-burst'
  | 'charge-strike';

export interface MusicSegmentInput {
  start: number;
  end: number;
  label: SegmentLabel;
  energy: number;
}

export interface BehaviorModule {
  id?: string;
  presetId?: string;
  start: number;
  end: number;
  label: SegmentLabel;
  intent?: 'warmup' | 'pressure' | 'chase' | 'lockdown' | 'burst' | 'release';
  phaseRole?: 'setup' | 'pressure' | 'burst' | 'reposition' | 'recovery';
  movement: BossMovement;
  attack: BossAttack;
  bulletCount: number;
  bulletSpeed: number;
  fireWindowBeats?: number;
  pressureLevel?: number;
  transitionIn?: 'snap' | 'blend';
  transitionOut?: 'snap' | 'blend';
  warningIntensity: number;
}

export function createBehaviorPlan(
  segments: MusicSegmentInput[],
  bpm: number,
  difficulty: number
): BehaviorModule[] {
  const beatDuration = 60 / bpm;
  const lastSegment = segments.length > 0 ? segments[segments.length - 1] : null;
  const beatGrid = Array.from({ length: Math.max(16, Math.ceil((lastSegment?.end ?? 0) / beatDuration)) }, (_, index) => index * beatDuration);
  const input: BehaviorGenerationInput = {
    bpm,
    difficulty,
    beatGrid,
    downbeat: 0,
    segments,
    confidence: {
      overall: Math.min(1, 0.65 + difficulty * 0.1),
      segmentation: 0.8,
      tempo: 0.85
    }
  };

  const timeline = createRuleBehaviorTimeline(input);
  return timeline.modules.map((module) => ({
    ...module,
    label: module.segmentLabel
  }));
}

export function getBehaviorAtTime(plan: BehaviorModule[], time: number): BehaviorModule {
  const active = plan.find((module) => time >= module.start && time < module.end);
  if (active) return active;
  if (plan.length === 0) {
    return createIdleFallbackBehavior();
  }

  if (time < plan[0].start) {
    return {
      ...createIdleFallbackBehavior(),
      end: plan[0].start
    };
  }

  for (let index = 0; index < plan.length; index += 1) {
    const module = plan[index];
    if (time < module.start) {
      return plan[Math.max(0, index - 1)];
    }
  }

  return plan[plan.length - 1] ?? createIdleFallbackBehavior();
}

function createIdleFallbackBehavior(): BehaviorModule {
  return {
    id: 'fallback-idle-preview',
    presetId: 'fallback-idle',
    start: 0,
    end: Infinity,
    label: 'intro',
    intent: 'warmup',
    phaseRole: 'recovery',
    movement: 'idle',
    attack: 'none',
    bulletCount: 0,
    bulletSpeed: 0,
    warningIntensity: 0.1
  };
}
