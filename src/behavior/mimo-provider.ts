import type { LlmBehaviorProvider } from './factory.js';
import type { BehaviorGenerationInput, BehaviorModule, BehaviorTimeline } from './types.js';

const DEFAULT_BASE_URL = 'https://token-plan-cn.xiaomimimo.com/v1';
const DEFAULT_MODEL = 'mimo-v2.5';
const DEFAULT_TIMEOUT_MS = 45000;
const MOVEMENT_OPTIONS = ['idle', 'wander', 'dash', 'orbit', 'shake', 'chase', 'keep-distance', 'outer-orbit'] as const;

type FetchImpl = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface MimoBehaviorProviderOptions {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  timeoutMs?: number;
  fetchImpl?: FetchImpl;
  now?: () => number;
}

interface MimoChatResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
}

export function createMimoBehaviorProvider(options: MimoBehaviorProviderOptions): LlmBehaviorProvider {
  const apiKey = options.apiKey.trim();
  const baseUrl = normalizeBaseUrl(options.baseUrl ?? DEFAULT_BASE_URL);
  const model = options.model?.trim() || DEFAULT_MODEL;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;

  if (!apiKey) {
    throw new Error('MiMo API Key 为空。');
  }

  return {
    async generate(input) {
      const response = await requestMimoTimeline({
        input,
        apiKey,
        baseUrl,
        model,
        timeoutMs,
        fetchImpl
      });
      return normalizeTimeline(response, model, now());
    }
  };
}

export function createMimoBehaviorProviderFromEnv(
  env: Record<string, string | undefined>,
  fetchImpl?: FetchImpl
): LlmBehaviorProvider | null {
  const apiKey = env.MIMO_API_KEY?.trim();
  if (!apiKey) return null;

  return createMimoBehaviorProvider({
    apiKey,
    model: env.MIMO_MODEL,
    baseUrl: env.MIMO_BASE_URL,
    timeoutMs: Number(env.MIMO_TIMEOUT_MS) || undefined,
    fetchImpl
  });
}

async function requestMimoTimeline(config: {
  input: BehaviorGenerationInput;
  apiKey: string;
  baseUrl: string;
  model: string;
  timeoutMs: number;
  fetchImpl: FetchImpl;
}): Promise<MimoChatResponse> {
  const controller = new AbortController();
  const timeout = config.timeoutMs > 0
    ? setTimeout(() => controller.abort(), config.timeoutMs)
    : undefined;

  try {
    const response = await config.fetchImpl(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: config.model,
        messages: createMessages(config.input),
        temperature: 0.35,
        max_tokens: 4200,
        response_format: { type: 'json_object' }
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`MiMo API 请求失败：${response.status} ${response.statusText}${detail ? ` - ${detail}` : ''}`);
    }

    return await response.json() as MimoChatResponse;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error(`MiMo API 请求超时：超过 ${Math.round(config.timeoutMs / 1000)} 秒未返回`);
    }
    throw error;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function createMessages(input: BehaviorGenerationInput): Array<{ role: 'system' | 'user'; content: string }> {
  const decisionContext = createDecisionContext(input);
  return [
    {
      role: 'system',
      content: [
        '你是 AUDIOgenic 的战斗导演，只输出合法 JSON，不要输出解释。',
        '目标：把音乐分析结果转换为可玩的 Boss 行为时间轴。',
        '硬性规则：时间轴必须覆盖整首歌，不要有重叠或空隙；相邻模块的 end 必须等于下一个 start。',
        '模块边界优先使用输入的 segment start/end；长段可以拆成 2-4 个微阶段，但微阶段边界必须贴近 beatGrid。',
        '每段至少有一个可感知行动：attack 不能整段都是 none，除非 intro/outro 的 setup/recovery。',
        '根据 FFT 特征选行动：低频强用 explosive-burst、charge-strike 或 ground-slam；高频强用 laser-ray、laser-barrage 或 lane-burst；能量高且不稳定用 screen-ring/explosive-burst；稳定中能量用 sparse-ring/aimed-burst；慢速低能量用 melee-sweep/稀疏弹幕。',
        '普通段落用 warningIntensity 0.25-0.6，高能 chorus/drop 用 0.6-0.95；fireWindowBeats 必须是 1/2/4/8。',
        '避免连续两个模块完全相同的 attack+movement 组合。',
        'movement 按音乐结构、玩家压力和可读性自由选择，不要为了满足固定偏好强行选择某个移动模式。',
        '只使用允许枚举：',
        'intent=warmup|pressure|chase|lockdown|burst|release',
        'phaseRole=setup|pressure|burst|reposition|recovery',
        'movement=idle|wander|dash|orbit|shake|chase|keep-distance|outer-orbit',
        'attack=none|sparse-ring|aimed-burst|screen-ring|lane-burst|melee-sweep|laser-ray|explosive-burst|charge-strike|ground-slam|cone-cleave|laser-barrage|charge-sweep',
        'transitionIn/transitionOut=snap|blend'
      ].join('\n')
    },
    {
      role: 'user',
      content: JSON.stringify({
        task: 'Return a BehaviorTimeline JSON object for this music analysis.',
        schema: {
          source: 'llm',
          generatedAt: 'number',
          metadata: {
            modelName: 'string',
            fallbackUsed: false,
            validationWarnings: []
          },
          modules: [{
            id: 'string',
            presetId: 'string',
            start: 'number',
            end: 'number',
            segmentLabel: 'intro|verse|bridge|chorus|drop|outro',
            intent: 'warmup|pressure|chase|lockdown|burst|release',
            phaseRole: 'setup|pressure|burst|reposition|recovery',
            movement: 'idle|wander|dash|orbit|shake|chase|keep-distance|outer-orbit',
            attack: 'none|sparse-ring|aimed-burst|screen-ring|lane-burst|melee-sweep|laser-ray|explosive-burst|charge-strike|ground-slam|cone-cleave|laser-barrage|charge-sweep',
            bulletCount: 'number >= 0',
            bulletSpeed: 'number >= 0',
            fireWindowBeats: 'integer >= 1',
            warningIntensity: 'number 0..1',
            pressureLevel: 'number >= 0',
            transitionIn: 'snap|blend',
            transitionOut: 'snap|blend'
          }]
        },
        music: {
          bpm: input.bpm,
          difficulty: input.difficulty,
          downbeat: input.downbeat,
          confidence: input.confidence,
          duration: decisionContext.duration,
          beatGridSample: decisionContext.beatGridSample,
          segments: decisionContext.segments
        },
        decisionGuide: decisionContext.decisionGuide
      })
    }
  ];
}

interface SegmentDecisionBrief {
  index: number;
  start: number;
  end: number;
  duration: number;
  label: BehaviorGenerationInput['segments'][number]['label'];
  energy: number;
  lowFreqWeight: number;
  highFreqWeight: number;
  stability: number;
  spectralCentroid: number;
  spectralFlux: number;
  beatDensity: number;
  intensity: number;
  energyDelta: number;
  spectralTilt: 'low-heavy' | 'bright' | 'balanced';
  recommendedAttacks: BehaviorModule['attack'][];
  movementOptions: BehaviorModule['movement'][];
  phaseHint: BehaviorModule['phaseRole'][];
}

function createDecisionContext(input: BehaviorGenerationInput): {
  duration: number;
  beatGridSample: number[];
  segments: SegmentDecisionBrief[];
  decisionGuide: string[];
} {
  const duration = Math.max(
    input.segments[input.segments.length - 1]?.end ?? 0,
    input.beatGrid[input.beatGrid.length - 1] ?? 0
  );
  const segments = input.segments.map((segment, index) => {
    const previous = input.segments[index - 1];
    const low = clamp01(segment.lowFreqWeight ?? segment.energy * 0.55);
    const high = clamp01(segment.highFreqWeight ?? segment.energy * 0.35);
    const stability = clamp01(segment.stability ?? 0.65);
    const spectralCentroid = clamp01(segment.spectralCentroid ?? estimateSpectralCentroid(low, high));
    const spectralFlux = clamp01(segment.spectralFlux ?? Math.max(0, segment.energy - (previous?.energy ?? segment.energy)));
    const beatDensity = clamp01(segment.beatDensity ?? segment.energy * 0.65 + stability * 0.25);
    const intensity = clamp01(segment.intensity ?? (
      segment.energy * 0.45
      + beatDensity * 0.18
      + low * 0.12
      + high * 0.1
      + spectralFlux * 0.15
    ));
    const energyDelta = segment.energy - (previous?.energy ?? segment.energy);
    const spectralTilt = low > high + 0.12 ? 'low-heavy' : high > low + 0.12 ? 'bright' : 'balanced';
    return {
      index,
      start: roundTime(segment.start),
      end: roundTime(segment.end),
      duration: roundTime(segment.end - segment.start),
      label: segment.label,
      energy: roundMetric(segment.energy),
      lowFreqWeight: roundMetric(low),
      highFreqWeight: roundMetric(high),
      stability: roundMetric(stability),
      spectralCentroid: roundMetric(spectralCentroid),
      spectralFlux: roundMetric(spectralFlux),
      beatDensity: roundMetric(beatDensity),
      intensity: roundMetric(intensity),
      energyDelta: roundMetric(energyDelta),
      spectralTilt,
      recommendedAttacks: recommendAttacks(segment.label, segment.energy, low, high, stability, spectralCentroid, spectralFlux, intensity, input.bpm),
      movementOptions: [...MOVEMENT_OPTIONS],
      phaseHint: recommendPhasePattern(segment.label, intensity, segment.end - segment.start)
    } satisfies SegmentDecisionBrief;
  });

  return {
    duration: roundTime(duration),
    beatGridSample: sampleBeatGrid(input.beatGrid, 220),
    segments,
    decisionGuide: [
      'Use segment boundaries as macro phases; split only when duration >= 10 seconds.',
      'Place burst/reposition phases on strong beatGrid values, not arbitrary decimals.',
      'Prefer laser-ray/lane-burst when highFreqWeight is high or spectralTilt is bright; use laser-barrage for high-intensity chorus/drop peaks.',
      'Prefer explosive-burst/charge-strike when lowFreqWeight is high or energyDelta jumps upward; use ground-slam or charge-sweep for high-intensity low-heavy peaks.',
      'Use spectralFlux as the main signal for section transitions, sudden fills, screen-ring bursts, and snap transitions.',
      'Use spectralCentroid to distinguish bright high-frequency texture from low-frequency impact even when energy is similar.',
      'Use intensity and beatDensity to decide how many micro-phases and how much pressure a segment deserves.',
      'Movement modes are not pre-ranked; choose any listed movementOptions that best fits the segment.',
      'Use melee-sweep only for close-pressure verse/bridge moments, not every segment.',
      'Keep intro readable and outro easing down, but do not leave rules-mode-like passive combat for the whole song.'
    ]
  };
}

function recommendAttacks(
  label: BehaviorGenerationInput['segments'][number]['label'],
  energy: number,
  low: number,
  high: number,
  stability: number,
  spectralCentroid: number,
  spectralFlux: number,
  intensity: number,
  bpm: number
): BehaviorModule['attack'][] {
  if (label === 'intro') return energy > 0.42 ? ['sparse-ring', 'aimed-burst', 'none'] : ['none', 'sparse-ring'];
  if (label === 'outro') return ['sparse-ring', 'aimed-burst', 'none'];
  if (spectralFlux > 0.62 && intensity > 0.62) {
    return high > low || spectralCentroid > 0.52
      ? ['laser-barrage', 'laser-ray', 'lane-burst']
      : ['ground-slam', 'explosive-burst', 'charge-sweep'];
  }
  if (label === 'drop' || energy > 0.78 || intensity > 0.82) {
    return low >= high
      ? ['charge-sweep', 'ground-slam', 'explosive-burst']
      : ['laser-barrage', 'laser-ray', 'cone-cleave'];
  }
  if (high > low + 0.12 || spectralCentroid > 0.52 || bpm >= 140) return ['laser-ray', 'lane-burst', 'aimed-burst'];
  if (low > high + 0.12) return ['charge-strike', 'explosive-burst', 'melee-sweep'];
  if (stability < 0.45) return ['screen-ring', 'explosive-burst', 'aimed-burst'];
  if (label === 'bridge') return ['melee-sweep', 'aimed-burst', 'sparse-ring'];
  return ['sparse-ring', 'aimed-burst', 'melee-sweep'];
}

function recommendPhasePattern(
  label: BehaviorGenerationInput['segments'][number]['label'],
  energy: number,
  duration: number
): BehaviorModule['phaseRole'][] {
  if (duration < 8) return energy > 0.65 ? ['pressure', 'burst'] : ['pressure'];
  if (label === 'intro') return ['setup', 'pressure', 'recovery'];
  if (label === 'outro') return ['pressure', 'recovery'];
  if (energy > 0.75 || label === 'drop') return ['setup', 'pressure', 'burst', 'reposition', 'burst', 'recovery'];
  return ['setup', 'pressure', 'reposition', 'burst', 'recovery'];
}

function sampleBeatGrid(beatGrid: number[], maxCount: number): number[] {
  if (beatGrid.length <= maxCount) return beatGrid.map(roundTime);
  const step = Math.ceil(beatGrid.length / maxCount);
  return beatGrid.filter((_, index) => index % step === 0).map(roundTime);
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function estimateSpectralCentroid(low: number, high: number): number {
  const total = Math.max(0.0001, low + high);
  return clamp01((high * 0.72 + low * 0.18) / total);
}

function roundTime(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function roundMetric(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function normalizeTimeline(response: MimoChatResponse, model: string, generatedAt: number): BehaviorTimeline {
  const content = response.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error('MiMo API 响应缺少 message.content。');
  }

  const parsed = JSON.parse(extractJson(content)) as Partial<BehaviorTimeline>;
  if (!Array.isArray(parsed.modules)) {
    throw new Error('MiMo API 响应不是有效的行为时间轴。');
  }

  return {
    source: 'llm',
    modules: parsed.modules as BehaviorModule[],
    generatedAt,
    metadata: {
      ...parsed.metadata,
      modelName: model,
      fallbackUsed: false,
      validationWarnings: []
    }
  };
}

function extractJson(content: string): string {
  const trimmed = content.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced) return fenced[1].trim();

  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) {
    return trimmed.slice(start, end + 1);
  }

  return trimmed;
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '');
}
