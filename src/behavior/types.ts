import type { MusicPrimitive, MusicSegment, MusicStyle, SegmentFeature, SegmentAttackHint, TrackStyleProfile } from '../audio/types.js';

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
  primitives?: MusicPrimitive[];
  styleProfile?: TrackStyleProfile;
  segmentFeatures?: SegmentFeature[];
  confidence: {
    overall: number;
    segmentation: number;
    tempo: number;
  };
}

export type PrimitiveCoupling = 'single' | 'layered' | 'climax';

export interface PrimitiveStep {
  id: string;
  start: number;
  end: number;
  primitiveIds: string[];
  intent: CombatIntent;
  phaseRole: PhaseRole;
  coupling: PrimitiveCoupling;
  intensity: number;
  rationale?: string;
}

export interface PrimitivePlan {
  source: 'primitive-plan';
  generatedAt: number;
  steps: PrimitiveStep[];
  metadata: {
    modelName?: string;
    validationWarnings?: string[];
    strategyNotes?: string[];
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
    styleApplied?: MusicStyle;
    strategyNotes?: string[];
    segmentRationale?: Record<string, string>;
  };
}

export interface BehaviorPromptSegment {
  start: number;
  end: number;
  label: SegmentLabel;
  energy: number;
  beatDensity: number;
  lowFreqWeight: number;
  highFreqWeight: number;
  stability: number;
  intensityRole: SegmentFeature['intensityRole'];
  recommendedAttack: SegmentAttackHint;
}

export interface BehaviorPromptPrimitive {
  id: string;
  kind: MusicPrimitive['kind'];
  start: number;
  end: number;
  segmentIndex: number;
  strength: number;
  confidence: number;
}

export interface BehaviorPromptInput {
  trackSummary: {
    bpm: number;
    downbeat: number;
    duration: number;
    primaryStyle: MusicStyle;
    styleConfidence: number;
    energyMean: number;
    lowFreqWeight: number;
    highFreqWeight: number;
    dynamicRange: number;
    beatDensity: number;
    segmentContrast: number;
    descriptors: string[];
    confidence: BehaviorGenerationInput['confidence'];
  };
  segments: BehaviorPromptSegment[];
  primitiveCatalog: BehaviorPromptPrimitive[];
  availableMoves: MovementMode[];
  availableAttacks: AttackMode[];
  designRules: string[];
  outputContract: {
    format: 'json';
    requiredTopLevelFields: string[];
    requiredStepFields?: string[];
    requiredModuleFields?: string[];
  };
}
