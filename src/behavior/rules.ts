import { SEGMENT_PROFILES } from './profiles.js';
import type { BehaviorGenerationInput, BehaviorModule } from './types.js';

interface BehaviorDraft {
  intent: BehaviorModule['intent'];
  movement: BehaviorModule['movement'];
  attack: BehaviorModule['attack'];
  pressureLevel: number;
  bulletCount: number;
  bulletSpeed: number;
  warningIntensity: number;
  transitionIn: BehaviorModule['transitionIn'];
  transitionOut: BehaviorModule['transitionOut'];
}

export function createRuleTimeline(input: BehaviorGenerationInput): BehaviorModule[] {
  const modules = input.segments.flatMap((segment, index) => {
    const profile = SEGMENT_PROFILES[segment.label];
    const previous = input.segments[index - 1];
    let draft = createBaseDraft(profile);
    draft = applyEnergyModifier(draft, segment.energy);
    draft = applyDurationModifier(draft, segment.end - segment.start);
    draft = applyTransitionModifier(draft, segment.energy - (previous?.energy ?? segment.energy), profile.preferredTransitionIn);
    draft = applyBpmModifier(draft, input.bpm);
    draft = resolveModes(draft, profile);
    draft = clampDraft(draft, profile);
    draft = enforceForbidden(draft, profile);
    const module: BehaviorModule = {
      id: `${segment.label}-${segment.start.toFixed(2)}`,
      start: segment.start,
      end: segment.end,
      segmentLabel: segment.label,
      intent: draft.intent,
      movement: draft.movement,
      attack: draft.attack,
      bulletCount: draft.bulletCount,
      bulletSpeed: draft.bulletSpeed,
      fireWindowBeats: draft.pressureLevel >= 70 ? 1 : draft.pressureLevel >= 40 ? 2 : 4,
      warningIntensity: draft.warningIntensity,
      pressureLevel: draft.pressureLevel,
      transitionIn: draft.transitionIn,
      transitionOut: draft.transitionOut
    };

    return expandLongSegment(module);
  });

  return modules;
}

function createBaseDraft(profile: typeof SEGMENT_PROFILES[keyof typeof SEGMENT_PROFILES]): BehaviorDraft {
  return {
    intent: profile.defaultIntent,
    movement: profile.movementPool[0],
    attack: profile.attackPool[0],
    pressureLevel: profile.pressureRange.min,
    bulletCount: profile.bulletCountRange.min,
    bulletSpeed: profile.bulletSpeedRange.min,
    warningIntensity: profile.warningRange.min,
    transitionIn: profile.preferredTransitionIn,
    transitionOut: profile.preferredTransitionOut
  };
}

function applyEnergyModifier(draft: BehaviorDraft, energy: number): BehaviorDraft {
  const next = { ...draft };
  if (energy < 0.25) {
    next.pressureLevel -= 8;
    next.bulletCount -= 2;
    next.warningIntensity -= 0.08;
  } else if (energy < 0.55) {
    next.pressureLevel += 4;
    next.bulletCount += 1;
  } else if (energy < 0.8) {
    next.pressureLevel += 10;
    next.bulletCount += 2;
    next.warningIntensity += 0.08;
  } else {
    next.pressureLevel += 18;
    next.bulletCount += 4;
    next.warningIntensity += 0.15;
  }
  return next;
}

function applyDurationModifier(draft: BehaviorDraft, duration: number): BehaviorDraft {
  const next = { ...draft };
  if (duration < 8) {
    next.bulletCount = Math.round(next.bulletCount * 0.85);
  } else if (duration > 20) {
    next.warningIntensity += 0.05;
  }
  return next;
}

function applyTransitionModifier(
  draft: BehaviorDraft,
  energyDeltaPrev: number,
  preferredTransition: BehaviorModule['transitionIn']
): BehaviorDraft {
  const next = { ...draft, transitionIn: preferredTransition };
  if (energyDeltaPrev > 0.2) {
    next.transitionIn = 'snap';
    next.warningIntensity += 0.12;
  } else if (energyDeltaPrev < -0.2) {
    next.transitionIn = 'blend';
    next.pressureLevel -= 5;
  }
  return next;
}

function applyBpmModifier(draft: BehaviorDraft, bpm: number): BehaviorDraft {
  const next = { ...draft };
  if (bpm < 90) {
    next.bulletSpeed *= 0.9;
    next.bulletCount = Math.max(0, Math.round(next.bulletCount * 0.9));
    next.warningIntensity += 0.05;
  } else if (bpm > 140) {
    next.bulletSpeed *= 1.08;
    next.bulletCount = Math.max(0, Math.round(next.bulletCount * 0.95));
  }
  return next;
}

function resolveModes(draft: BehaviorDraft, profile: typeof SEGMENT_PROFILES[keyof typeof SEGMENT_PROFILES]): BehaviorDraft {
  const next = { ...draft };
  if (next.pressureLevel < 20) {
    next.movement = profile.movementPool.includes('idle') ? 'idle' : profile.movementPool[0];
    next.attack = profile.attackPool.includes('none') ? 'none' : profile.attackPool[0];
  } else if (next.pressureLevel < 45) {
    next.movement = profile.movementPool.includes('wander') ? 'wander' : profile.movementPool[0];
    next.attack = profile.attackPool.includes('sparse-ring') ? 'sparse-ring' : profile.attackPool[0];
  } else if (next.pressureLevel < 70) {
    next.movement = profile.movementPool.includes('dash')
      ? 'dash'
      : profile.movementPool.includes('orbit')
        ? 'orbit'
        : profile.movementPool[0];
    next.attack = profile.attackPool.includes('aimed-burst') ? 'aimed-burst' : profile.attackPool[0];
    if (profile.label === 'bridge') next.intent = 'chase';
  } else {
    if (profile.label === 'drop') {
      next.movement = profile.movementPool.includes('shake') ? 'shake' : profile.movementPool[0];
      next.attack = profile.attackPool.includes('screen-ring')
        ? 'screen-ring'
        : profile.attackPool.includes('lane-burst')
          ? 'lane-burst'
          : profile.attackPool[profile.attackPool.length - 1];
      next.intent = 'lockdown';
    } else {
      next.movement = profile.movementPool.includes('dash') ? 'dash' : profile.movementPool[0];
      next.attack = profile.attackPool.includes('aimed-burst')
        ? 'aimed-burst'
        : profile.attackPool.includes('screen-ring')
          ? 'screen-ring'
          : profile.attackPool[profile.attackPool.length - 1];
      next.intent = 'burst';
    }
  }
  return next;
}

function clampDraft(draft: BehaviorDraft, profile: typeof SEGMENT_PROFILES[keyof typeof SEGMENT_PROFILES]): BehaviorDraft {
  return {
    ...draft,
    pressureLevel: clamp(draft.pressureLevel, profile.pressureRange.min, profile.pressureRange.max),
    bulletCount: Math.round(clamp(draft.bulletCount, profile.bulletCountRange.min, profile.bulletCountRange.max)),
    bulletSpeed: clamp(draft.bulletSpeed, profile.bulletSpeedRange.min, profile.bulletSpeedRange.max),
    warningIntensity: clamp(draft.warningIntensity, profile.warningRange.min, profile.warningRange.max)
  };
}

function enforceForbidden(draft: BehaviorDraft, profile: typeof SEGMENT_PROFILES[keyof typeof SEGMENT_PROFILES]): BehaviorDraft {
  if (profile.forbiddenAttacks?.includes(draft.attack)) {
    return { ...draft, attack: profile.attackPool[0] };
  }
  return draft;
}

function expandLongSegment(module: BehaviorModule): BehaviorModule[] {
  const duration = module.end - module.start;
  if (duration <= 20 || module.pressureLevel < 65) return [module];
  const mid = module.start + duration / 2;
  return [
    {
      ...module,
      id: `${module.id}-a`,
      end: mid,
      pressureLevel: Math.max(module.pressureLevel - 8, 0),
      warningIntensity: Math.max(module.warningIntensity - 0.05, 0.1)
    },
    {
      ...module,
      id: `${module.id}-b`,
      start: mid,
      pressureLevel: module.pressureLevel,
      warningIntensity: Math.min(module.warningIntensity + 0.05, 1)
    }
  ];
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
