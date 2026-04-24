import type { AttackMode, CombatIntent, MovementMode, SegmentLabel, TransitionMode } from './types.js';

export interface NumericRange {
  min: number;
  max: number;
}

export interface SegmentProfile {
  label: SegmentLabel;
  defaultIntent: CombatIntent;
  movementPool: MovementMode[];
  attackPool: AttackMode[];
  pressureRange: NumericRange;
  bulletCountRange: NumericRange;
  bulletSpeedRange: NumericRange;
  warningRange: NumericRange;
  preferredTransitionIn: TransitionMode;
  preferredTransitionOut: TransitionMode;
  forbiddenAttacks?: AttackMode[];
}

export const SEGMENT_PROFILES: Record<SegmentLabel, SegmentProfile> = {
  intro: {
    label: 'intro',
    defaultIntent: 'warmup',
    movementPool: ['idle', 'wander'],
    attackPool: ['none', 'sparse-ring'],
    pressureRange: { min: 5, max: 20 },
    bulletCountRange: { min: 0, max: 5 },
    bulletSpeedRange: { min: 90, max: 140 },
    warningRange: { min: 0.1, max: 0.3 },
    preferredTransitionIn: 'blend',
    preferredTransitionOut: 'blend',
    forbiddenAttacks: ['screen-ring', 'lane-burst', 'aimed-burst']
  },
  verse: {
    label: 'verse',
    defaultIntent: 'pressure',
    movementPool: ['wander', 'orbit', 'dash'],
    attackPool: ['sparse-ring', 'aimed-burst'],
    pressureRange: { min: 20, max: 50 },
    bulletCountRange: { min: 4, max: 10 },
    bulletSpeedRange: { min: 120, max: 185 },
    warningRange: { min: 0.2, max: 0.45 },
    preferredTransitionIn: 'blend',
    preferredTransitionOut: 'blend',
    forbiddenAttacks: ['screen-ring']
  },
  bridge: {
    label: 'bridge',
    defaultIntent: 'chase',
    movementPool: ['orbit', 'dash'],
    attackPool: ['sparse-ring', 'aimed-burst'],
    pressureRange: { min: 35, max: 65 },
    bulletCountRange: { min: 6, max: 12 },
    bulletSpeedRange: { min: 140, max: 210 },
    warningRange: { min: 0.35, max: 0.6 },
    preferredTransitionIn: 'blend',
    preferredTransitionOut: 'snap'
  },
  chorus: {
    label: 'chorus',
    defaultIntent: 'burst',
    movementPool: ['dash', 'wander', 'shake'],
    attackPool: ['aimed-burst', 'screen-ring'],
    pressureRange: { min: 55, max: 85 },
    bulletCountRange: { min: 8, max: 18 },
    bulletSpeedRange: { min: 160, max: 240 },
    warningRange: { min: 0.55, max: 0.85 },
    preferredTransitionIn: 'snap',
    preferredTransitionOut: 'blend'
  },
  drop: {
    label: 'drop',
    defaultIntent: 'lockdown',
    movementPool: ['dash', 'shake'],
    attackPool: ['screen-ring', 'lane-burst', 'aimed-burst'],
    pressureRange: { min: 70, max: 100 },
    bulletCountRange: { min: 10, max: 24 },
    bulletSpeedRange: { min: 170, max: 250 },
    warningRange: { min: 0.7, max: 1 },
    preferredTransitionIn: 'snap',
    preferredTransitionOut: 'blend'
  },
  outro: {
    label: 'outro',
    defaultIntent: 'release',
    movementPool: ['idle', 'wander'],
    attackPool: ['none', 'sparse-ring'],
    pressureRange: { min: 5, max: 25 },
    bulletCountRange: { min: 0, max: 6 },
    bulletSpeedRange: { min: 90, max: 150 },
    warningRange: { min: 0.1, max: 0.3 },
    preferredTransitionIn: 'blend',
    preferredTransitionOut: 'blend',
    forbiddenAttacks: ['screen-ring', 'lane-burst']
  }
};
