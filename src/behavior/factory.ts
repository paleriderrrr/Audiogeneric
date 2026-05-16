import { createRuleTimeline } from './rules.js';
import { validateBehaviorTimeline } from './validate.js';
import type { BehaviorGenerationInput, BehaviorTimeline } from './types.js';

export type { BehaviorGenerationInput, BehaviorTimeline, BehaviorModule } from './types.js';

export interface LlmBehaviorProvider {
  generate(input: BehaviorGenerationInput): Promise<BehaviorTimeline>;
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
  if (options.strategy === 'llm-preferred' && options.llmProvider) {
    try {
      const candidate = await options.llmProvider.generate(input);
      const validation = validateBehaviorTimeline(candidate);
      if (validation.valid) {
        return {
          ...candidate,
          metadata: {
            ...candidate.metadata,
            fallbackUsed: false,
            validationWarnings: []
          }
        };
      }
      return createRuleFallback(input, validation.warnings);
    } catch (error) {
      return createRuleFallback(input, [error instanceof Error ? error.message : String(error)]);
    }
  }
  return createRuleBehaviorTimeline(input);
}

function createRuleFallback(input: BehaviorGenerationInput, warnings: string[]): BehaviorTimeline {
  const modules = normalizeRuleModules(createRuleTimeline(input), input);
  return {
    source: 'rules',
    modules,
    generatedAt: Date.now(),
    metadata: {
      fallbackUsed: warnings.length > 0,
      validationWarnings: warnings
    }
  };
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
