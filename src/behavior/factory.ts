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
  return {
    source: 'rules',
    modules: createRuleTimeline(input),
    generatedAt: Date.now(),
    metadata: {
      fallbackUsed: warnings.length > 0,
      validationWarnings: warnings
    }
  };
}
