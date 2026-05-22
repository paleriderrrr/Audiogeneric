import type {
  AttackMode,
  CombatIntent,
  MovementMode,
  PhaseRole,
  SegmentLabel,
  TransitionMode
} from './types.js';

export interface NumericRange {
  min: number;
  max: number;
}

export interface SegmentPreset {
  id: string;
  intent: CombatIntent;
  preferredBeats: 2 | 4 | 8;
  energyRange: NumericRange;
  bpmBand: 'any' | 'slow' | 'mid' | 'fast';
  phasePattern: PhaseRole[];
  movementByRole: Record<PhaseRole, MovementMode>;
  attackByRole: Record<PhaseRole, AttackMode>;
  pressureBias: number;
  bulletCountBias: number;
  bulletSpeedBias: number;
  warningBias: number;
}

export interface SegmentProfile {
  label: SegmentLabel;
  defaultIntent: CombatIntent;
  pressureRange: NumericRange;
  bulletCountRange: NumericRange;
  bulletSpeedRange: NumericRange;
  warningRange: NumericRange;
  preferredTransitionIn: TransitionMode;
  preferredTransitionOut: TransitionMode;
  forbiddenAttacks?: AttackMode[];
  presets: SegmentPreset[];
}

const STATIC_PROBE: Record<PhaseRole, MovementMode> = {
  setup: 'idle',
  pressure: 'wander',
  burst: 'wander',
  reposition: 'idle',
  recovery: 'idle'
};

const PURSUIT_SWEEP: Record<PhaseRole, MovementMode> = {
  setup: 'keep-distance',
  pressure: 'chase',
  burst: 'chase',
  reposition: 'outer-orbit',
  recovery: 'keep-distance'
};

const SPACING_PRESSURE: Record<PhaseRole, MovementMode> = {
  setup: 'keep-distance',
  pressure: 'keep-distance',
  burst: 'chase',
  reposition: 'outer-orbit',
  recovery: 'wander'
};

const LIGHT_RING: Record<PhaseRole, AttackMode> = {
  setup: 'none',
  pressure: 'sparse-ring',
  burst: 'sparse-ring',
  reposition: 'none',
  recovery: 'none'
};

export const SEGMENT_PROFILES: Record<SegmentLabel, SegmentProfile> = {
  intro: {
    label: 'intro',
    defaultIntent: 'warmup',
    pressureRange: { min: 5, max: 22 },
    bulletCountRange: { min: 0, max: 6 },
    bulletSpeedRange: { min: 90, max: 145 },
    warningRange: { min: 0.1, max: 0.32 },
    preferredTransitionIn: 'blend',
    preferredTransitionOut: 'blend',
    forbiddenAttacks: ['screen-ring', 'lane-burst', 'aimed-burst'],
    presets: [
      {
        id: 'intro-static-probe',
        intent: 'warmup',
        preferredBeats: 8,
        energyRange: { min: 0, max: 0.35 },
        bpmBand: 'any',
        phasePattern: ['setup', 'pressure', 'recovery'],
        movementByRole: STATIC_PROBE,
        attackByRole: LIGHT_RING,
        pressureBias: -4,
        bulletCountBias: -2,
        bulletSpeedBias: -10,
        warningBias: -0.04
      },
      {
        id: 'intro-light-pursuit',
        intent: 'warmup',
        preferredBeats: 4,
        energyRange: { min: 0.18, max: 0.55 },
        bpmBand: 'mid',
        phasePattern: ['setup', 'pressure', 'reposition', 'recovery'],
        movementByRole: {
          setup: 'wander',
          pressure: 'keep-distance',
          burst: 'wander',
          reposition: 'outer-orbit',
          recovery: 'idle'
        },
        attackByRole: {
          setup: 'none',
          pressure: 'sparse-ring',
          burst: 'sparse-ring',
          reposition: 'none',
          recovery: 'none'
        },
        pressureBias: 2,
        bulletCountBias: 0,
        bulletSpeedBias: 0,
        warningBias: 0.02
      }
    ]
  },
  verse: {
    label: 'verse',
    defaultIntent: 'pressure',
    pressureRange: { min: 20, max: 58 },
    bulletCountRange: { min: 4, max: 12 },
    bulletSpeedRange: { min: 120, max: 195 },
    warningRange: { min: 0.2, max: 0.48 },
    preferredTransitionIn: 'blend',
    preferredTransitionOut: 'blend',
    forbiddenAttacks: ['screen-ring'],
    presets: [
      {
        id: 'verse-close-sweep',
        intent: 'pressure',
        preferredBeats: 4,
        energyRange: { min: 0.1, max: 0.5 },
        bpmBand: 'slow',
        phasePattern: ['pressure', 'reposition', 'pressure', 'recovery'],
        movementByRole: {
          ...PURSUIT_SWEEP
        },
        attackByRole: {
          setup: 'none',
          pressure: 'melee-sweep',
          burst: 'charge-strike',
          reposition: 'none',
          recovery: 'none'
        },
        pressureBias: 3,
        bulletCountBias: -1,
        bulletSpeedBias: -12,
        warningBias: 0.04
      },
      {
        id: 'verse-lateral-pressure',
        intent: 'pressure',
        preferredBeats: 4,
        energyRange: { min: 0.15, max: 0.55 },
        bpmBand: 'any',
        phasePattern: ['setup', 'pressure', 'reposition', 'recovery'],
        movementByRole: {
          ...SPACING_PRESSURE
        },
        attackByRole: {
          setup: 'none',
          pressure: 'melee-sweep',
          burst: 'charge-strike',
          reposition: 'none',
          recovery: 'none'
        },
        pressureBias: 0,
        bulletCountBias: 0,
        bulletSpeedBias: 0,
        warningBias: 0
      },
      {
        id: 'verse-tracking-poke',
        intent: 'chase',
        preferredBeats: 4,
        energyRange: { min: 0.35, max: 0.72 },
        bpmBand: 'fast',
        phasePattern: ['setup', 'pressure', 'burst', 'recovery'],
        movementByRole: {
          setup: 'keep-distance',
          pressure: 'outer-orbit',
          burst: 'chase',
          reposition: 'outer-orbit',
          recovery: 'wander'
        },
        attackByRole: {
          setup: 'none',
          pressure: 'laser-ray',
          burst: 'melee-sweep',
          reposition: 'none',
          recovery: 'none'
        },
        pressureBias: 6,
        bulletCountBias: 1,
        bulletSpeedBias: 10,
        warningBias: 0.05
      },
      {
        id: 'verse-cutthrough',
        intent: 'pressure',
        preferredBeats: 2,
        energyRange: { min: 0.28, max: 0.8 },
        bpmBand: 'mid',
        phasePattern: ['setup', 'pressure', 'reposition', 'burst', 'recovery'],
        movementByRole: {
          setup: 'wander',
          pressure: 'chase',
          burst: 'chase',
          reposition: 'keep-distance',
          recovery: 'idle'
        },
        attackByRole: {
          setup: 'none',
          pressure: 'melee-sweep',
          burst: 'charge-strike',
          reposition: 'none',
          recovery: 'none'
        },
        pressureBias: 4,
        bulletCountBias: 1,
        bulletSpeedBias: 8,
        warningBias: 0.04
      }
    ]
  },
  bridge: {
    label: 'bridge',
    defaultIntent: 'chase',
    pressureRange: { min: 34, max: 68 },
    bulletCountRange: { min: 6, max: 13 },
    bulletSpeedRange: { min: 140, max: 215 },
    warningRange: { min: 0.35, max: 0.62 },
    preferredTransitionIn: 'blend',
    preferredTransitionOut: 'snap',
    presets: [
      {
        id: 'bridge-orbit-windup',
        intent: 'chase',
        preferredBeats: 4,
        energyRange: { min: 0.35, max: 0.75 },
        bpmBand: 'any',
        phasePattern: ['setup', 'pressure', 'burst', 'reposition', 'recovery'],
        movementByRole: {
          setup: 'outer-orbit',
          pressure: 'keep-distance',
          burst: 'chase',
          reposition: 'outer-orbit',
          recovery: 'wander'
        },
        attackByRole: {
          setup: 'none',
          pressure: 'melee-sweep',
          burst: 'charge-strike',
          reposition: 'none',
          recovery: 'none'
        },
        pressureBias: 2,
        bulletCountBias: 1,
        bulletSpeedBias: 6,
        warningBias: 0.04
      },
      {
        id: 'bridge-feint-pressure',
        intent: 'chase',
        preferredBeats: 2,
        energyRange: { min: 0.45, max: 0.9 },
        bpmBand: 'fast',
        phasePattern: ['setup', 'reposition', 'pressure', 'burst', 'recovery'],
        movementByRole: {
          setup: 'keep-distance',
          pressure: 'chase',
          burst: 'chase',
          reposition: 'outer-orbit',
          recovery: 'wander'
        },
        attackByRole: {
          setup: 'none',
          pressure: 'laser-ray',
          burst: 'melee-sweep',
          reposition: 'none',
          recovery: 'none'
        },
        pressureBias: 8,
        bulletCountBias: 2,
        bulletSpeedBias: 12,
        warningBias: 0.08
      }
    ]
  },
  chorus: {
    label: 'chorus',
    defaultIntent: 'burst',
    pressureRange: { min: 55, max: 88 },
    bulletCountRange: { min: 8, max: 18 },
    bulletSpeedRange: { min: 160, max: 242 },
    warningRange: { min: 0.55, max: 0.88 },
    preferredTransitionIn: 'snap',
    preferredTransitionOut: 'blend',
    presets: [
      {
        id: 'chorus-spread-drive',
        intent: 'burst',
        preferredBeats: 4,
        energyRange: { min: 0.55, max: 1 },
        bpmBand: 'any',
        phasePattern: ['setup', 'pressure', 'burst', 'reposition', 'recovery'],
        movementByRole: {
          setup: 'keep-distance',
          pressure: 'chase',
          burst: 'chase',
          reposition: 'outer-orbit',
          recovery: 'idle'
        },
        attackByRole: {
          setup: 'none',
          pressure: 'melee-sweep',
          burst: 'explosive-burst',
          reposition: 'none',
          recovery: 'none'
        },
        pressureBias: 4,
        bulletCountBias: 2,
        bulletSpeedBias: 10,
        warningBias: 0.06
      },
      {
        id: 'chorus-lane-pressure',
        intent: 'burst',
        preferredBeats: 2,
        energyRange: { min: 0.72, max: 1 },
        bpmBand: 'fast',
        phasePattern: ['setup', 'pressure', 'reposition', 'burst', 'recovery'],
        movementByRole: {
          setup: 'keep-distance',
          pressure: 'chase',
          burst: 'shake',
          reposition: 'outer-orbit',
          recovery: 'keep-distance'
        },
        attackByRole: {
          setup: 'none',
          pressure: 'laser-ray',
          burst: 'laser-barrage',
          reposition: 'none',
          recovery: 'none'
        },
        pressureBias: 8,
        bulletCountBias: 3,
        bulletSpeedBias: 14,
        warningBias: 0.1
      },
      {
        id: 'chorus-center-compress',
        intent: 'lockdown',
        preferredBeats: 4,
        energyRange: { min: 0.9, max: 1 },
        bpmBand: 'mid',
        phasePattern: ['setup', 'pressure', 'burst', 'reposition', 'burst', 'recovery'],
        movementByRole: {
          setup: 'outer-orbit',
          pressure: 'chase',
          burst: 'shake',
          reposition: 'outer-orbit',
          recovery: 'keep-distance'
        },
        attackByRole: {
          setup: 'none',
          pressure: 'cone-cleave',
          burst: 'explosive-burst',
          reposition: 'none',
          recovery: 'none'
        },
        pressureBias: 10,
        bulletCountBias: 4,
        bulletSpeedBias: 8,
        warningBias: 0.08
      }
    ]
  },
  drop: {
    label: 'drop',
    defaultIntent: 'lockdown',
    pressureRange: { min: 70, max: 100 },
    bulletCountRange: { min: 10, max: 24 },
    bulletSpeedRange: { min: 170, max: 252 },
    warningRange: { min: 0.7, max: 1 },
    preferredTransitionIn: 'snap',
    preferredTransitionOut: 'blend',
    presets: [
      {
        id: 'drop-burst-wave',
        intent: 'lockdown',
        preferredBeats: 2,
        energyRange: { min: 0.8, max: 1 },
        bpmBand: 'any',
        phasePattern: ['setup', 'pressure', 'burst', 'reposition', 'burst', 'recovery'],
        movementByRole: {
          setup: 'outer-orbit',
          pressure: 'shake',
          burst: 'shake',
          reposition: 'chase',
          recovery: 'keep-distance'
        },
        attackByRole: {
          setup: 'none',
          pressure: 'charge-sweep',
          burst: 'ground-slam',
          reposition: 'none',
          recovery: 'none'
        },
        pressureBias: 10,
        bulletCountBias: 4,
        bulletSpeedBias: 10,
        warningBias: 0.1
      },
      {
        id: 'drop-lane-lock',
        intent: 'lockdown',
        preferredBeats: 2,
        energyRange: { min: 0.9, max: 1 },
        bpmBand: 'fast',
        phasePattern: ['setup', 'pressure', 'reposition', 'burst', 'recovery'],
        movementByRole: {
          setup: 'keep-distance',
          pressure: 'chase',
          burst: 'shake',
          reposition: 'outer-orbit',
          recovery: 'wander'
        },
        attackByRole: {
          setup: 'none',
          pressure: 'charge-strike',
          burst: 'charge-sweep',
          reposition: 'none',
          recovery: 'none'
        },
        pressureBias: 14,
        bulletCountBias: 5,
        bulletSpeedBias: 16,
        warningBias: 0.12
      },
      {
        id: 'drop-spiral-break',
        intent: 'burst',
        preferredBeats: 4,
        energyRange: { min: 0.78, max: 1 },
        bpmBand: 'mid',
        phasePattern: ['setup', 'pressure', 'burst', 'reposition', 'recovery'],
        movementByRole: {
          setup: 'outer-orbit',
          pressure: 'shake',
          burst: 'chase',
          reposition: 'outer-orbit',
          recovery: 'keep-distance'
        },
        attackByRole: {
          setup: 'none',
          pressure: 'screen-ring',
          burst: 'laser-ray',
          reposition: 'none',
          recovery: 'none'
        },
        pressureBias: 12,
        bulletCountBias: 4,
        bulletSpeedBias: 10,
        warningBias: 0.1
      }
    ]
  },
  outro: {
    label: 'outro',
    defaultIntent: 'release',
    pressureRange: { min: 5, max: 26 },
    bulletCountRange: { min: 0, max: 6 },
    bulletSpeedRange: { min: 90, max: 152 },
    warningRange: { min: 0.1, max: 0.32 },
    preferredTransitionIn: 'blend',
    preferredTransitionOut: 'blend',
    forbiddenAttacks: ['screen-ring', 'lane-burst'],
    presets: [
      {
        id: 'outro-fadeout',
        intent: 'release',
        preferredBeats: 8,
        energyRange: { min: 0, max: 0.45 },
        bpmBand: 'any',
        phasePattern: ['setup', 'pressure', 'recovery'],
        movementByRole: STATIC_PROBE,
        attackByRole: LIGHT_RING,
        pressureBias: -2,
        bulletCountBias: -1,
        bulletSpeedBias: -6,
        warningBias: -0.02
      },
      {
        id: 'outro-cleanup',
        intent: 'release',
        preferredBeats: 4,
        energyRange: { min: 0.18, max: 0.55 },
        bpmBand: 'mid',
        phasePattern: ['setup', 'pressure', 'reposition', 'recovery'],
        movementByRole: {
          setup: 'wander',
          pressure: 'keep-distance',
          burst: 'wander',
          reposition: 'outer-orbit',
          recovery: 'idle'
        },
        attackByRole: {
          setup: 'none',
          pressure: 'sparse-ring',
          burst: 'sparse-ring',
          reposition: 'none',
          recovery: 'none'
        },
        pressureBias: 1,
        bulletCountBias: 0,
        bulletSpeedBias: 0,
        warningBias: 0.02
      }
    ]
  }
};
