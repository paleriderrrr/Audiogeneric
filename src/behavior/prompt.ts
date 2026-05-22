import type { BehaviorGenerationInput, BehaviorPromptInput, BehaviorPromptSegment } from './types.js';

const AVAILABLE_MOVES: BehaviorPromptInput['availableMoves'] = [
  'idle',
  'wander',
  'dash',
  'orbit',
  'shake',
  'chase',
  'keep-distance',
  'outer-orbit'
];
const AVAILABLE_ATTACKS: BehaviorPromptInput['availableAttacks'] = [
  'none',
  'sparse-ring',
  'aimed-burst',
  'screen-ring',
  'lane-burst',
  'melee-sweep',
  'laser-ray',
  'explosive-burst',
  'charge-strike',
  'ground-slam',
  'cone-cleave',
  'laser-barrage',
  'charge-sweep'
];

export function buildBehaviorPromptInput(input: BehaviorGenerationInput): BehaviorPromptInput {
  const duration = input.segments[input.segments.length - 1]?.end ?? 0;
  const style = input.styleProfile ?? {
    primaryStyle: 'unknown' as const,
    confidence: 0,
    energyMean: average(input.segments.map((segment) => segment.energy)),
    lowFreqWeight: 0,
    highFreqWeight: 0,
    dynamicRange: 0,
    beatDensity: input.beatGrid.length / Math.max(1, duration),
    segmentContrast: contrast(input.segments.map((segment) => segment.energy)),
    descriptors: []
  };

  return {
    trackSummary: {
      bpm: input.bpm,
      downbeat: input.downbeat,
      duration,
      primaryStyle: style.primaryStyle,
      styleConfidence: style.confidence,
      energyMean: style.energyMean,
      lowFreqWeight: style.lowFreqWeight,
      highFreqWeight: style.highFreqWeight,
      dynamicRange: style.dynamicRange,
      beatDensity: style.beatDensity,
      segmentContrast: style.segmentContrast,
      descriptors: style.descriptors,
      confidence: input.confidence
    },
    segments: buildPromptSegments(input),
    availableMoves: AVAILABLE_MOVES,
    availableAttacks: AVAILABLE_ATTACKS,
    designRules: buildDesignRules(style.primaryStyle),
    outputContract: {
      format: 'json',
      requiredTopLevelFields: ['source', 'modules', 'generatedAt', 'metadata'],
      requiredModuleFields: [
        'id',
        'presetId',
        'start',
        'end',
        'segmentLabel',
        'intent',
        'phaseRole',
        'movement',
        'attack',
        'bulletCount',
        'bulletSpeed',
        'fireWindowBeats',
        'warningIntensity',
        'pressureLevel',
        'transitionIn',
        'transitionOut'
      ]
    }
  };
}

function buildPromptSegments(input: BehaviorGenerationInput): BehaviorPromptSegment[] {
  return input.segments.map((segment) => {
    const feature = input.segmentFeatures?.find((item) => item.start === segment.start && item.end === segment.end);
    return {
      start: segment.start,
      end: segment.end,
      label: segment.label,
      energy: segment.energy,
      beatDensity: feature?.beatDensity ?? (segment.energy > 0.7 ? 0.9 : segment.energy > 0.4 ? 0.6 : 0.3),
      lowFreqWeight: feature?.lowFreqWeight ?? 0,
      highFreqWeight: feature?.highFreqWeight ?? 0,
      stability: feature?.stability ?? 0.5,
      intensityRole: feature?.intensityRole ?? (segment.energy > 0.8 ? 'climax' : segment.energy > 0.55 ? 'peak' : segment.energy > 0.3 ? 'groove' : 'setup'),
      recommendedAttack: feature?.recommendedAttack ?? (segment.energy > 0.75 ? 'screen-ring' : segment.energy > 0.35 ? 'aimed-burst' : 'sparse-ring')
    };
  });
}

function buildDesignRules(style: BehaviorPromptInput['trackSummary']['primaryStyle']): string[] {
  const common = [
    'Return only JSON that matches the output contract.',
    'Cover every input segment without gaps or overlaps.',
    'Use only availableMoves and availableAttacks.',
    'Use higher warningIntensity before dense or wide attacks.'
  ];
  if (style === 'rock') {
    return [
      ...common,
      'For rock, emphasize wide impact: screen-ring, sparse-ring, higher warningIntensity, and larger pressure peaks on chorus/drop sections.'
    ];
  }
  if (style === 'electronic') {
    return [
      ...common,
      'For electronic, emphasize short-fast-pulses: low fireWindowBeats, lane-burst or aimed-burst, fast bulletSpeed, and quick snap transitions.'
    ];
  }
  if (style === 'hiphop') {
    return [
      ...common,
      'For hiphop, map heavy low-end sections to aimed-burst pressure and syncopated lane-burst patterns.'
    ];
  }
  if (style === 'ambient') {
    return [
      ...common,
      'For ambient, use sparse-ring pressure, long warning windows, lower bullet counts, and slower movement.'
    ];
  }
  return [
    ...common,
    'Match attack density to segment energy, beatDensity, and recommendedAttack hints.'
  ];
}

function average(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function contrast(values: number[]): number {
  return Math.max(...values, 0) - Math.min(...values, 0);
}
