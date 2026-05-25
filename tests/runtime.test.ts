import test from 'node:test';
import assert from 'node:assert/strict';
import { GameRuntime } from '../src/game/runtime.js';
import { createInitialWorld } from '../src/core/combat.js';
import { createRhythmTracker } from '../src/core/rhythm.js';
import type { AudioAnalysis } from '../src/audio/types.js';

interface FakeRect {
  width: number;
  height: number;
  left: number;
  top: number;
}

interface RecordedCanvasOperation {
  type: 'arc' | 'lineTo' | 'moveTo' | 'fillText';
  x?: number;
  y?: number;
  radius?: number;
  startAngle?: number;
  endAngle?: number;
  text?: string;
  strokeStyle: string;
}

class FakeAudioBufferSourceNode {
  buffer: AudioBuffer | null = null;
  onended: (() => void) | null = null;
  connect(): void {}
  start(): void {}
  stop(): void {
    this.onended?.();
  }
}

class FakeAnalyserNode {
  fftSize = 0;
  frequencyBinCount = 32;
  connect(): void {}
  getByteFrequencyData(array: Uint8Array): void {
    array.fill(0);
  }
}

class FakeAudioContext {
  currentTime = 0;
  readonly analyser = new FakeAnalyserNode();
  readonly source = new FakeAudioBufferSourceNode();

  createAnalyser(): FakeAnalyserNode {
    return this.analyser;
  }

  createBufferSource(): FakeAudioBufferSourceNode {
    return this.source;
  }

  close(): Promise<void> {
    return Promise.resolve();
  }
}

function createCanvas(rect: FakeRect): HTMLCanvasElement {
  const listeners = new Map<string, EventListener[]>();
  const context = {
    clearRect() {},
    fillRect() {},
    strokeRect() {},
    createRadialGradient() {
      return { addColorStop() {} };
    },
    beginPath() {},
    moveTo() {},
    lineTo() {},
    stroke() {},
    arc() {},
    fill() {},
    save() {},
    restore() {},
    translate() {},
    rotate() {},
    fillText() {},
    set fillStyle(_: string) {},
    set strokeStyle(_: string) {},
    set lineWidth(_: number) {},
    set font(_: string) {}
  };

  return {
    width: rect.width,
    height: rect.height,
    getContext: () => context as unknown as CanvasRenderingContext2D,
    getBoundingClientRect: () => rect as DOMRect,
    addEventListener(type: string, listener: EventListener) {
      listeners.set(type, [...(listeners.get(type) ?? []), listener]);
    }
  } as unknown as HTMLCanvasElement;
}

function createRecordingCanvas(rect: FakeRect): { canvas: HTMLCanvasElement; operations: RecordedCanvasOperation[] } {
  const listeners = new Map<string, EventListener[]>();
  const operations: RecordedCanvasOperation[] = [];
  const state = {
    strokeStyle: ''
  };
  const context = {
    clearRect() {},
    fillRect() {},
    strokeRect() {},
    createRadialGradient() {
      return { addColorStop() {} };
    },
    beginPath() {},
    closePath() {},
    moveTo(x: number, y: number) {
      operations.push({ type: 'moveTo', x, y, strokeStyle: state.strokeStyle });
    },
    lineTo(x: number, y: number) {
      operations.push({ type: 'lineTo', x, y, strokeStyle: state.strokeStyle });
    },
    stroke() {},
    arc(x: number, y: number, radius: number, startAngle: number, endAngle: number) {
      operations.push({ type: 'arc', x, y, radius, startAngle, endAngle, strokeStyle: state.strokeStyle });
    },
    fill() {},
    save() {},
    restore() {},
    translate() {},
    rotate() {},
    fillText(text: string, x: number, y: number) {
      operations.push({ type: 'fillText', text, x, y, strokeStyle: state.strokeStyle });
    },
    drawImage() {},
    set fillStyle(_: string) {},
    set strokeStyle(value: string) {
      state.strokeStyle = value;
    },
    set lineWidth(_: number) {},
    set font(_: string) {},
    set globalAlpha(_: number) {},
    set shadowColor(_: string) {},
    set shadowBlur(_: number) {},
    set letterSpacing(_: string) {}
  };

  const canvas = {
    width: rect.width,
    height: rect.height,
    getContext: () => context as unknown as CanvasRenderingContext2D,
    getBoundingClientRect: () => rect as DOMRect,
    addEventListener(type: string, listener: EventListener) {
      listeners.set(type, [...(listeners.get(type) ?? []), listener]);
    }
  } as unknown as HTMLCanvasElement;

  return { canvas, operations };
}

function createAnalysis(duration = 12): AudioAnalysis {
  return {
    buffer: {} as AudioBuffer,
    bpm: 120,
    firstBeat: 0,
    duration,
    beats: Array.from({ length: duration * 2 }, (_, index) => ({ time: index * 0.5, strength: 1 })),
    segments: [
      { start: 0, end: duration / 2, label: 'verse', energy: 0.4 },
      { start: duration / 2, end: duration, label: 'chorus', energy: 0.8 }
    ],
    tempoCandidates: [{ bpm: 120, score: 1, source: 'autocorrelation' }],
    warmupWindow: { start: 0, end: Math.min(duration, 8), reason: 'high-clarity-beat' },
    calibration: null
  };
}

test('draws melee sweep warning as a full circular area', () => {
  const originalWindow = globalThis.window;
  const rect = { width: 800, height: 600, left: 0, top: 0 };
  const { canvas, operations } = createRecordingCanvas(rect);

  globalThis.window = { devicePixelRatio: 1, addEventListener() {}, removeEventListener() {} } as unknown as Window & typeof globalThis;

  try {
    const runtime = new GameRuntime(canvas, {
      onStatus() {},
      onResult() {}
    });
    const rhythm = createRhythmTracker({ bpm: 120, firstBeat: 0, duration: 12 });
    const world = createInitialWorld({
      width: 800,
      height: 600,
      difficulty: 1,
      rhythm,
      behaviorPlan: [
        {
          start: 0,
          end: 12,
          label: 'bridge',
          movement: 'idle',
          attack: 'melee-sweep',
          bulletCount: 8,
          bulletSpeed: 170,
          warningIntensity: 0.75,
          fireWindowBeats: 1
        }
      ]
    });
    world.activeBehavior = world.behaviorPlan[0];
    (runtime as unknown as { world: typeof world }).world = world;

    operations.length = 0;
    (runtime as unknown as { drawAttackTelegraph(time: number): void }).drawAttackTelegraph(0.49);

    assert.equal(operations.some((operation) => (
      operation.type === 'arc'
      && Math.abs((operation.startAngle ?? 0) - 0) < 0.001
      && Math.abs((operation.endAngle ?? 0) - Math.PI * 2) < 0.001
      && operation.strokeStyle === '#ff8b8b'
    )), true);
  } finally {
    globalThis.window = originalWindow;
  }
});

test('draws laser barrage with one real laser warning plus projectile lanes', () => {
  const originalWindow = globalThis.window;
  const rect = { width: 800, height: 600, left: 0, top: 0 };
  const { canvas, operations } = createRecordingCanvas(rect);

  globalThis.window = { devicePixelRatio: 1, addEventListener() {}, removeEventListener() {} } as unknown as Window & typeof globalThis;

  try {
    const runtime = new GameRuntime(canvas, {
      onStatus() {},
      onResult() {}
    });
    const rhythm = createRhythmTracker({ bpm: 120, firstBeat: 0, duration: 12 });
    const world = createInitialWorld({
      width: 800,
      height: 600,
      difficulty: 1,
      rhythm,
      behaviorPlan: [
        {
          start: 0,
          end: 12,
          label: 'drop',
          movement: 'shake',
          attack: 'laser-barrage',
          bulletCount: 10,
          bulletSpeed: 230,
          warningIntensity: 0.9,
          fireWindowBeats: 1
        }
      ]
    });
    world.activeBehavior = world.behaviorPlan[0];
    (runtime as unknown as { world: typeof world }).world = world;

    operations.length = 0;
    (runtime as unknown as { drawAttackTelegraph(time: number): void }).drawAttackTelegraph(0.49);

    const greenLaserRays = operations.filter((operation) => (
      operation.type === 'lineTo' && operation.strokeStyle === '#8bf2cf'
    ));
    const redProjectileLanes = operations.filter((operation) => (
      operation.type === 'lineTo' && operation.strokeStyle === '#ff8b8b'
    ));

    assert.equal(greenLaserRays.length, 1);
    assert.equal(redProjectileLanes.length >= 4, true);
  } finally {
    globalThis.window = originalWindow;
  }
});

test('draws locked laser telegraph from outside the boss core', () => {
  const originalWindow = globalThis.window;
  const rect = { width: 800, height: 600, left: 0, top: 0 };
  const { canvas, operations } = createRecordingCanvas(rect);

  globalThis.window = { devicePixelRatio: 1, addEventListener() {}, removeEventListener() {} } as unknown as Window & typeof globalThis;

  try {
    const runtime = new GameRuntime(canvas, {
      onStatus() {},
      onResult() {}
    });
    const rhythm = createRhythmTracker({ bpm: 120, firstBeat: 0, duration: 12 });
    const world = createInitialWorld({
      width: 800,
      height: 600,
      difficulty: 1,
      rhythm,
      behaviorPlan: [
        {
          start: 0,
          end: 12,
          label: 'chorus',
          movement: 'idle',
          attack: 'laser-ray',
          bulletCount: 6,
          bulletSpeed: 220,
          warningIntensity: 0.7,
          fireWindowBeats: 1
        }
      ]
    });
    world.player.x = world.boss.x + 140;
    world.player.y = world.boss.y;
    world.activeBehavior = world.behaviorPlan[0];
    (runtime as unknown as { world: typeof world }).world = world;

    operations.length = 0;
    (runtime as unknown as { drawAttackTelegraph(time: number): void }).drawAttackTelegraph(0.49);

    const firstMove = operations.find((operation) => operation.type === 'moveTo' && operation.strokeStyle === '#8bf2cf');
    assert.notEqual(firstMove, undefined);
    assert.equal((firstMove?.x ?? 0) > world.boss.x + world.boss.radius, true);
  } finally {
    globalThis.window = originalWindow;
  }
});

test('draws projectile telegraphs from outside the boss core', () => {
  const originalWindow = globalThis.window;
  const rect = { width: 800, height: 600, left: 0, top: 0 };
  const { canvas, operations } = createRecordingCanvas(rect);

  globalThis.window = { devicePixelRatio: 1, addEventListener() {}, removeEventListener() {} } as unknown as Window & typeof globalThis;

  try {
    const runtime = new GameRuntime(canvas, {
      onStatus() {},
      onResult() {}
    });
    const rhythm = createRhythmTracker({ bpm: 120, firstBeat: 0, duration: 12 });
    const world = createInitialWorld({
      width: 800,
      height: 600,
      difficulty: 1,
      rhythm,
      behaviorPlan: [
        {
          start: 0,
          end: 12,
          label: 'verse',
          movement: 'idle',
          attack: 'aimed-burst',
          bulletCount: 8,
          bulletSpeed: 180,
          warningIntensity: 0.5,
          fireWindowBeats: 1
        }
      ]
    });
    world.player.x = world.boss.x + 140;
    world.player.y = world.boss.y;
    world.activeBehavior = world.behaviorPlan[0];
    (runtime as unknown as { world: typeof world }).world = world;

    operations.length = 0;
    (runtime as unknown as { drawAttackTelegraph(time: number): void }).drawAttackTelegraph(0.49);

    const firstMove = operations.find((operation) => operation.type === 'moveTo' && operation.strokeStyle === '#ff8b8b');
    assert.notEqual(firstMove, undefined);
    assert.equal((firstMove?.x ?? 0) > world.boss.x + world.boss.radius, true);
  } finally {
    globalThis.window = originalWindow;
  }
});

test('keeps projectile spawn feedback and trails outside the boss core', () => {
  const originalWindow = globalThis.window;
  const rect = { width: 800, height: 600, left: 0, top: 0 };
  const { canvas, operations } = createRecordingCanvas(rect);

  globalThis.window = { devicePixelRatio: 1, addEventListener() {}, removeEventListener() {} } as unknown as Window & typeof globalThis;

  try {
    const runtime = new GameRuntime(canvas, {
      onStatus() {},
      onResult() {}
    });
    const rhythm = createRhythmTracker({ bpm: 120, firstBeat: 0, duration: 12 });
    const world = createInitialWorld({ width: 800, height: 600, difficulty: 1, rhythm });
    world.player.x = world.boss.x + 180;
    world.player.y = world.boss.y;
    world.activeBehavior = {
      start: 0,
      end: 12,
      label: 'verse',
      movement: 'idle',
      attack: 'aimed-burst',
      bulletCount: 6,
      bulletSpeed: 180,
      warningIntensity: 0.5,
      fireWindowBeats: 1
    };
    world.projectiles = [
      {
        x: world.boss.x + 46,
        y: world.boss.y,
        vx: 180,
        vy: 0,
        radius: 6,
        damage: 8,
        grazed: false,
        kind: 'bullet',
        age: 0
      }
    ];
    world.events = [{ type: 'projectiles-fired' }];
    (runtime as unknown as { world: typeof world }).world = world;

    operations.length = 0;
    (runtime as unknown as { drawProjectiles(time: number): void }).drawProjectiles(0.2);
    (runtime as unknown as { consumeWorldEvents(dt: number): void }).consumeWorldEvents(0.016);

    const projectileTrailEnd = operations.find((operation) => operation.type === 'lineTo');
    const sequences = (runtime as unknown as { sequences: Array<{ x: number; y: number }> }).sequences;

    assert.notEqual(projectileTrailEnd, undefined);
    assert.equal((projectileTrailEnd?.x ?? 0) > world.boss.x + world.boss.radius, true);
    assert.equal(sequences.some((sequence) => sequence.x > world.boss.x + world.boss.radius), true);
  } finally {
    globalThis.window = originalWindow;
  }
});

test('renders the boss core beneath telegraphs and projectile visuals', () => {
  const originalWindow = globalThis.window;
  const rect = { width: 800, height: 600, left: 0, top: 0 };

  globalThis.window = { devicePixelRatio: 1, addEventListener() {}, removeEventListener() {} } as unknown as Window & typeof globalThis;

  try {
    const runtime = new GameRuntime(createCanvas(rect), {
      onStatus() {},
      onResult() {}
    });
    const rhythm = createRhythmTracker({ bpm: 120, firstBeat: 0, duration: 12 });
    const world = createInitialWorld({
      width: 800,
      height: 600,
      difficulty: 1,
      rhythm,
      behaviorPlan: [
        {
          start: 0,
          end: 12,
          label: 'chorus',
          movement: 'idle',
          attack: 'laser-ray',
          bulletCount: 6,
          bulletSpeed: 220,
          warningIntensity: 0.7,
          fireWindowBeats: 1
        }
      ]
    });
    world.activeBehavior = world.behaviorPlan[0];
    (runtime as unknown as { world: typeof world }).world = world;

    const order: string[] = [];
    (runtime as unknown as { drawAudioGlow: (energy: number) => void }).drawAudioGlow = () => {};
    (runtime as unknown as { drawArena: (energy: number, time: number) => void }).drawArena = () => {};
    (runtime as unknown as { drawBeatPulse: () => void }).drawBeatPulse = () => {};
    (runtime as unknown as { drawCore: (time: number) => void }).drawCore = () => { order.push('core'); };
    (runtime as unknown as { drawAttackTelegraph: (time: number) => void }).drawAttackTelegraph = () => { order.push('telegraph'); };
    (runtime as unknown as { drawHazards: (time: number) => void }).drawHazards = () => { order.push('hazards'); };
    (runtime as unknown as { drawProjectiles: (time: number) => void }).drawProjectiles = () => { order.push('projectiles'); };
    (runtime as unknown as { drawBossHealthBar: () => void }).drawBossHealthBar = () => {};
    (runtime as unknown as { drawActor: (...args: unknown[]) => void }).drawActor = () => {};
    (runtime as unknown as { drawPlayerHitbox: () => void }).drawPlayerHitbox = () => {};
    (runtime as unknown as { drawAttackArc: () => void }).drawAttackArc = () => {};
    (runtime as unknown as { drawParticles: () => void }).drawParticles = () => {};
    (runtime as unknown as { drawSequences: () => void }).drawSequences = () => {};
    (runtime as unknown as { drawRhythmGuide: (time: number) => void }).drawRhythmGuide = () => {};
    (runtime as unknown as { drawHud: (time: number, energy: number) => void }).drawHud = () => {};
    (runtime as unknown as { drawFeedbackBanner: () => void }).drawFeedbackBanner = () => {};
    (runtime as unknown as { readEnergy: () => number }).readEnergy = () => 0;
    (runtime as unknown as { updateBeatPulse: (time: number, dt: number) => void }).updateBeatPulse = () => {};
    (runtime as unknown as { updateParticles: (dt: number) => void }).updateParticles = () => {};
    (runtime as unknown as { updateSequences: (dt: number) => void }).updateSequences = () => {};

    (runtime as unknown as { draw(time: number, dt: number): void }).draw(0.49, 0.016);

    assert.deepEqual(order, ['core', 'telegraph', 'hazards', 'projectiles']);
  } finally {
    globalThis.window = originalWindow;
  }
});

test('draws the active boss attack label in the hud', () => {
  const originalWindow = globalThis.window;
  const rect = { width: 1000, height: 700, left: 0, top: 0 };
  const { canvas, operations } = createRecordingCanvas(rect);

  globalThis.window = { devicePixelRatio: 1, addEventListener() {}, removeEventListener() {} } as unknown as Window & typeof globalThis;

  try {
    const runtime = new GameRuntime(canvas, {
      onStatus() {},
      onResult() {}
    });
    const rhythm = createRhythmTracker({ bpm: 120, firstBeat: 0, duration: 12 });
    const world = createInitialWorld({
      width: 1000,
      height: 700,
      difficulty: 1,
      rhythm,
      behaviorPlan: [
        {
          start: 0,
          end: 12,
          label: 'chorus',
          movement: 'shake',
          attack: 'laser-barrage',
          bulletCount: 10,
          bulletSpeed: 230,
          warningIntensity: 0.9,
          fireWindowBeats: 1
        }
      ]
    });
    world.activeBehavior = world.behaviorPlan[0];
    (runtime as unknown as { world: typeof world; duration: number }).world = world;
    (runtime as unknown as { duration: number }).duration = 12;

    operations.length = 0;
    (runtime as unknown as { drawHud(time: number, energy: number): void }).drawHud(1.5, 0.82);

    const texts = operations
      .filter((operation) => operation.type === 'fillText')
      .map((operation) => operation.text);

    assert.equal(texts.includes('招式'), true);
    assert.equal(texts.includes('光束连携'), true);
  } finally {
    globalThis.window = originalWindow;
  }
});

test('ignores stale audio onended callbacks after a restart', async () => {
  const originalAudioContext = globalThis.AudioContext;
  const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
  const originalCancelAnimationFrame = globalThis.cancelAnimationFrame;
  const originalDevicePixelRatio = globalThis.window?.devicePixelRatio;
  const originalPerformance = globalThis.performance;
  const contexts: FakeAudioContext[] = [];
  const results: string[] = [];
  const rect = { width: 800, height: 600, left: 0, top: 0 };

  globalThis.window = { devicePixelRatio: 1, addEventListener() {}, removeEventListener() {} } as unknown as Window & typeof globalThis;
  globalThis.performance = { now: () => 0 } as Performance;
  globalThis.requestAnimationFrame = (() => 1) as typeof requestAnimationFrame;
  globalThis.cancelAnimationFrame = (() => {}) as typeof cancelAnimationFrame;
  globalThis.AudioContext = class {
    constructor() {
      const context = new FakeAudioContext();
      contexts.push(context);
      return context;
    }
  } as unknown as typeof AudioContext;

  try {
    const runtime = new GameRuntime(createCanvas(rect), {
      onStatus() {},
      onResult(message) {
        results.push(message);
      }
    });

    await runtime.start(createAnalysis(12), 1);
    const firstSource = contexts[0].source;
    await runtime.start(createAnalysis(16), 1.2);

    results.length = 0;
    firstSource.onended?.();

    assert.equal(results.length, 0);
  } finally {
    globalThis.AudioContext = originalAudioContext;
    globalThis.requestAnimationFrame = originalRequestAnimationFrame;
    globalThis.cancelAnimationFrame = originalCancelAnimationFrame;
    globalThis.performance = originalPerformance;
    if (originalDevicePixelRatio !== undefined && globalThis.window) {
      globalThis.window.devicePixelRatio = originalDevicePixelRatio;
    }
  }
});

test('emits a single result when the active audio source ends naturally', async () => {
  const originalAudioContext = globalThis.AudioContext;
  const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
  const originalCancelAnimationFrame = globalThis.cancelAnimationFrame;
  const originalDevicePixelRatio = globalThis.window?.devicePixelRatio;
  const originalPerformance = globalThis.performance;
  const results: string[] = [];
  const rect = { width: 800, height: 600, left: 0, top: 0 };

  globalThis.window = { devicePixelRatio: 1, addEventListener() {}, removeEventListener() {} } as unknown as Window & typeof globalThis;
  globalThis.performance = { now: () => 0 } as Performance;
  globalThis.requestAnimationFrame = (() => 1) as typeof requestAnimationFrame;
  globalThis.cancelAnimationFrame = (() => {}) as typeof cancelAnimationFrame;
  globalThis.AudioContext = class {
    constructor() {
      return new FakeAudioContext();
    }
  } as unknown as typeof AudioContext;

  try {
    const runtime = new GameRuntime(createCanvas(rect), {
      onStatus() {},
      onResult(message) {
        results.push(message);
      }
    });

    await runtime.start(createAnalysis(12), 1);
    const source = (runtime as unknown as { source: FakeAudioBufferSourceNode }).source;
    source?.onended?.();

    assert.equal(results.length, 1);
    assert.equal((runtime as unknown as { source: FakeAudioBufferSourceNode | null }).source, null);
    assert.equal((runtime as unknown as { audioContext: FakeAudioContext | null }).audioContext, null);
  } finally {
    globalThis.AudioContext = originalAudioContext;
    globalThis.requestAnimationFrame = originalRequestAnimationFrame;
    globalThis.cancelAnimationFrame = originalCancelAnimationFrame;
    globalThis.performance = originalPerformance;
    if (originalDevicePixelRatio !== undefined && globalThis.window) {
      globalThis.window.devicePixelRatio = originalDevicePixelRatio;
    }
  }
});

test('rebuilds arena bounds when resizing during an active run', async () => {
  const originalAudioContext = globalThis.AudioContext;
  const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
  const originalCancelAnimationFrame = globalThis.cancelAnimationFrame;
  const originalDevicePixelRatio = globalThis.window?.devicePixelRatio;
  const originalPerformance = globalThis.performance;
  const rect = { width: 800, height: 600, left: 0, top: 0 };

  globalThis.window = { devicePixelRatio: 1, addEventListener() {}, removeEventListener() {} } as unknown as Window & typeof globalThis;
  globalThis.performance = { now: () => 0 } as Performance;
  globalThis.requestAnimationFrame = (() => 1) as typeof requestAnimationFrame;
  globalThis.cancelAnimationFrame = (() => {}) as typeof cancelAnimationFrame;
  globalThis.AudioContext = class {
    constructor() {
      return new FakeAudioContext();
    }
  } as unknown as typeof AudioContext;

  try {
    const runtime = new GameRuntime(createCanvas(rect), {
      onStatus() {},
      onResult() {}
    });

    await runtime.start(createAnalysis(12), 1);
    const worldBeforeResize = (runtime as unknown as { world: { arena: { maxX: number } } }).world;
    const maxXBefore = worldBeforeResize.arena.maxX;

    rect.width = 1200;
    rect.height = 900;
    runtime.resize();

    const worldAfterResize = (runtime as unknown as { world: { arena: { maxX: number } } }).world;
    assert.notEqual(worldAfterResize.arena.maxX, maxXBefore);
  } finally {
    globalThis.AudioContext = originalAudioContext;
    globalThis.requestAnimationFrame = originalRequestAnimationFrame;
    globalThis.cancelAnimationFrame = originalCancelAnimationFrame;
    globalThis.performance = originalPerformance;
    if (originalDevicePixelRatio !== undefined && globalThis.window) {
      globalThis.window.devicePixelRatio = originalDevicePixelRatio;
    }
  }
});

test('reports MiMo request and result status while starting llm mode', async () => {
  const originalAudioContext = globalThis.AudioContext;
  const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
  const originalCancelAnimationFrame = globalThis.cancelAnimationFrame;
  const originalDevicePixelRatio = globalThis.window?.devicePixelRatio;
  const originalPerformance = globalThis.performance;
  const statuses: string[] = [];
  const rect = { width: 800, height: 600, left: 0, top: 0 };

  globalThis.window = { devicePixelRatio: 1, addEventListener() {}, removeEventListener() {} } as unknown as Window & typeof globalThis;
  globalThis.performance = { now: () => 0 } as Performance;
  globalThis.requestAnimationFrame = (() => 1) as typeof requestAnimationFrame;
  globalThis.cancelAnimationFrame = (() => {}) as typeof cancelAnimationFrame;
  globalThis.AudioContext = class {
    constructor() {
      return new FakeAudioContext();
    }
  } as unknown as typeof AudioContext;

  try {
    const runtime = new GameRuntime(createCanvas(rect), {
      onStatus(message) {
        statuses.push(message);
      },
      onResult() {}
    });

    await runtime.start(createAnalysis(12), 1, {
      behaviorMode: 'llm-preferred',
      llmProvider: {
        async generate() {
          return {
            source: 'llm',
            generatedAt: Date.now(),
            metadata: {
              fallbackUsed: false,
              validationWarnings: [],
              modelName: 'status-test-model'
            },
            modules: [
              {
                id: 'status-llm-0',
                presetId: 'status-llm',
                start: 0,
                end: 12,
                segmentLabel: 'verse',
                intent: 'pressure',
                phaseRole: 'pressure',
                movement: 'wander',
                attack: 'sparse-ring',
                bulletCount: 4,
                bulletSpeed: 150,
                fireWindowBeats: 4,
                warningIntensity: 0.4,
                pressureLevel: 40,
                transitionIn: 'blend',
                transitionOut: 'blend'
              }
            ]
          };
        }
      }
    });

    assert.equal(statuses.some((message) => message.includes('正在调用 MiMo')), true);
    assert.equal(statuses.some((message) => message.includes('大模型') && message.includes('动作')), true);
  } finally {
    globalThis.AudioContext = originalAudioContext;
    globalThis.requestAnimationFrame = originalRequestAnimationFrame;
    globalThis.cancelAnimationFrame = originalCancelAnimationFrame;
    globalThis.performance = originalPerformance;
    if (originalDevicePixelRatio !== undefined && globalThis.window) {
      globalThis.window.devicePixelRatio = originalDevicePixelRatio;
    }
  }
});
