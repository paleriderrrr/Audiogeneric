import type { MusicSegment } from '../audio/types.js';

export type SegmentLabel = MusicSegment['label'];
export type CombatIntent = 'warmup' | 'pressure' | 'chase' | 'lockdown' | 'burst' | 'release';
export type MovementMode =
  | 'idle'
  | 'wander'
  | 'dash'
  | 'orbit'
  | 'shake'
  | 'chase'
  | 'keep-distance'
  | 'outer-orbit';
export type AttackMode =
  | 'none'
  | 'sparse-ring'
  | 'aimed-burst'
  | 'screen-ring'
  | 'lane-burst'
  | 'melee-sweep'
  | 'laser-ray'
  | 'explosive-burst'
  | 'charge-strike'
  | 'ground-slam'
  | 'cone-cleave'
  | 'laser-barrage'
  | 'charge-sweep';
export type TransitionMode = 'snap' | 'blend';
export type PhaseRole = 'setup' | 'pressure' | 'burst' | 'reposition' | 'recovery';

export interface BehaviorGenerationInput {
  bpm: number;
  difficulty: number;
  beatGrid: number[];
  downbeat: number;
  segments: MusicSegment[];
  confidence: {
    overall: number;
    segmentation: number;
    tempo: number;
  };
}

export interface BehaviorModule {
  id: string;
  presetId: string;
  start: number;
  end: number;
  segmentLabel: SegmentLabel;
  intent: CombatIntent;
  phaseRole: PhaseRole;
  movement: MovementMode;
  attack: AttackMode;
  bulletCount: number;
  bulletSpeed: number;
  fireWindowBeats: number;
  warningIntensity: number;
  pressureLevel: number;
  transitionIn: TransitionMode;
  transitionOut: TransitionMode;
}

export interface BehaviorTimeline {
  source: 'rules' | 'llm';
  modules: BehaviorModule[];
  generatedAt: number;
  metadata: {
    modelName?: string;
    fallbackUsed: boolean;
    validationWarnings: string[];
  };
}
