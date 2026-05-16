import test from 'node:test';
import assert from 'node:assert/strict';
import { GameRuntime } from '../src/game/runtime.js';
import type { AudioAnalysis } from '../src/audio/types.js';

interface FakeRect {
  width: number;
  height: number;
  left: number;
  top: number;
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
