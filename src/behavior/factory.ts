import { createRuleTimeline } from './rules.js';
import { buildBehaviorPromptInput } from './prompt.js';
import { validateBehaviorTimeline } from './validate.js';
import type { BehaviorGenerationInput, BehaviorPromptInput, BehaviorTimeline } from './types.js';

export { buildBehaviorPromptInput } from './prompt.js';
export type { BehaviorGenerationInput, BehaviorTimeline, BehaviorModule, BehaviorPromptInput } from './types.js';

export interface LlmBehaviorProvider {
  generate(input: BehaviorGenerationInput, prompt: BehaviorPromptInput): Promise<BehaviorTimeline | string | unknown>;
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
      const prompt = buildBehaviorPromptInput(input);
      const candidate = normalizeProviderResult(await options.llmProvider.generate(input, prompt));
      const validation = validateBehaviorTimeline(candidate);
      const warnings = [
        ...validation.warnings,
        ...validateStyleAlignment(candidate, input)
      ];
      if (warnings.length === 0) {
        return {
          ...candidate,
          metadata: {
            ...candidate.metadata,
            fallbackUsed: false,
            validationWarnings: []
          }
        };
      }
      return createRuleFallback(input, warnings);
    } catch (error) {
      return createRuleFallback(input, [error instanceof Error ? error.message : String(error)]);
    }
  }
  return createRuleBehaviorTimeline(input);
}

function normalizeProviderResult(result: BehaviorTimeline | string | unknown): BehaviorTimeline {
  if (typeof result === 'string') {
    return JSON.parse(extractJsonPayload(result)) as BehaviorTimeline;
  }
  return result as BehaviorTimeline;
}

function extractJsonPayload(text: string): string {
  const trimmed = text.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return fenced ? fenced[1] : trimmed;
}

function validateStyleAlignment(candidate: BehaviorTimeline, input: BehaviorGenerationInput): string[] {
  const expected = input.styleProfile?.primaryStyle;
  const actual = candidate.metadata?.styleApplied;
  if (!expected || !actual || candidate.source !== 'llm') return [];
  return actual === expected ? [] : [`Style mismatch: expected ${expected}, got ${actual}`];
}

function createRuleFallback(input: BehaviorGenerationInput, warnings: string[]): BehaviorTimeline {
  return {
    source: 'rules',
    modules: createRuleTimeline(input),
    generatedAt: Date.now(),
    metadata: {
      fallbackUsed: warnings.length > 0,
      validationWarnings: warnings,
      styleApplied: input.styleProfile?.primaryStyle ?? 'unknown',
      strategyNotes: [
        warnings.length > 0
          ? 'rule fallback used after llm validation failed'
          : 'rule fallback used by selected strategy'
      ]
    }
  };
}
