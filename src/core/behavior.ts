import { createRuleBehaviorTimeline, type BehaviorGenerationInput } from '../behavior/factory.js';
import type { MusicSegment } from '../audio/types.js';

export type SegmentLabel = MusicSegment['label'];
export type BossMovement = 'idle' | 'wander' | 'dash' | 'orbit' | 'shake';
export type BossAttack = 'none' | 'sparse-ring' | 'aimed-burst' | 'screen-ring' | 'lane-burst';

export interface MusicSegmentInput {
  start: number;
  end: number;
  label: SegmentLabel;
  energy: number;
}

export interface BehaviorModule {
  id?: string;
  start: number;
  end: number;
  label: SegmentLabel;
  intent?: 'warmup' | 'pressure' | 'chase' | 'lockdown' | 'burst' | 'release';
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
    label: module.segmentLabel,
    bulletCount: Math.max(0, Math.round(module.bulletCount * difficulty)),
    bulletSpeed: module.bulletSpeed * (0.85 + difficulty * 0.15),
    warningIntensity: Math.min(1, module.warningIntensity * (0.8 + difficulty * 0.2))
  }));
}

export function getBehaviorAtTime(plan: BehaviorModule[], time: number): BehaviorModule {
  const active = plan.find((module) => time >= module.start && time < module.end);
  if (active) return active;
  const first = plan[0];
  if (first && time < first.start) return first;
  const previous = [...plan].reverse().find((module) => module.start <= time);
  return previous ?? first ?? {
    start: 0,
    end: Infinity,
    label: 'verse',
    movement: 'idle',
    attack: 'sparse-ring',
    bulletCount: 6,
    bulletSpeed: 150,
    warningIntensity: 0.3
  };
}
