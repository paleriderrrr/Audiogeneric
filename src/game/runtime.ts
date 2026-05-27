import {
  createBehaviorTimeline,
  type BehaviorStrategyOptions,
  type LlmBehaviorProvider
} from '../behavior/factory.js';
import { createInitialWorld, stepWorld, type CombatInput, type GameResult, type WorldState } from '../core/combat.js';
import { createRhythmTracker } from '../core/rhythm.js';
import type { AudioAnalysis } from '../audio/types.js';
import { pickCombatFeedback } from './feedback.js';
import { SoundEffectPlayer } from './sound-feedback.js';

interface VisualParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  radius: number;
  color: string;
  kind: 'spark' | 'ring';
}

interface VisualSequence {
  x: number;
  y: number;
  life: number;
  maxLife: number;
  frameCount: number;
  frameRate: number;
  size: number;
  rotation: number;
  color: string;
  kind: 'impact' | 'guard' | 'graze' | 'dash' | 'burst' | 'charge';
}

const CHARACTER_SEQUENCE_FRAMES = 20;
const GENERATED_VFX_SEQUENCE_FRAMES = 6;
const GENERATED_VFX_SEQUENCE_ROWS = 4;
const ATTACK_ARC_RADIUS = 92;
const ATTACK_ARC_HALF_ANGLE = Math.PI / 5;

export interface RuntimeCallbacks {
  onStatus(message: string): void;
  onResult(result: string): void;
}

export type RuntimeBehaviorMode = BehaviorStrategyOptions['strategy'];

export interface RuntimeStartOptions {
  behaviorMode?: RuntimeBehaviorMode;
  llmProvider?: LlmBehaviorProvider;
}

export class GameRuntime {
  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;
  private readonly callbacks: RuntimeCallbacks;
  private readonly assetAtlas: HTMLImageElement | null = typeof Image === 'undefined' ? null : new Image();
  private readonly vfxAtlas: HTMLImageElement | null = typeof Image === 'undefined' ? null : new Image();
  private readonly projectileAtlas: HTMLImageElement | null = typeof Image === 'undefined' ? null : new Image();
  private readonly feedbackAtlas: HTMLImageElement | null = typeof Image === 'undefined' ? null : new Image();
  private readonly characterAtlas: HTMLImageElement | null = typeof Image === 'undefined' ? null : new Image();
  private readonly soundEffects = new SoundEffectPlayer();
  private world: WorldState | null = null;
  private assetAtlasReady = false;
  private assetTileSize = 0;
  private vfxAtlasReady = false;
  private vfxFrameSize = 0;
  private projectileAtlasReady = false;
  private projectileFrameWidth = 0;
  private projectileFrameHeight = 0;
  private feedbackAtlasReady = false;
  private feedbackFrameWidth = 0;
  private feedbackFrameHeight = 0;
  private characterAtlasReady = false;
  private characterFrameWidth = 0;
  private characterFrameHeight = 0;
  private keys = new Set<string>();
  private pointer = { x: 0, y: 0 };
  private pendingAttack = false;
  private pendingBlock = false;
  private pendingDash = false;
  private audioContext: AudioContext | null = null;
  private source: AudioBufferSourceNode | null = null;
  private analyser: AnalyserNode | null = null;
  private frequencyData: Uint8Array<ArrayBuffer> | null = null;
  private startTime = 0;
  private duration = 0;
  private lowFrequencyEnergy = 0;
  private animationId = 0;
  private lastFrame = 0;
  private running = false;
  private runToken = 0;
  private feedbackText = '';
  private feedbackTone: 'success' | 'warning' | 'danger' = 'warning';
  private feedbackTimer = 0;
  private playerFlashTimer = 0;
  private playerFlashTone: 'guard' | 'hurt' = 'guard';
  private bossFlashTimer = 0;
  private screenShakeTimer = 0;
  private screenShakeStrength = 0;
  private beatPulseTimer = 0;
  private lastBeatPulseAt = -Infinity;
  private particles: VisualParticle[] = [];
  private sequences: VisualSequence[] = [];

  constructor(canvas: HTMLCanvasElement, callbacks: RuntimeCallbacks) {
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas 2D is not available.');
    this.canvas = canvas;
    this.context = context;
    this.callbacks = callbacks;
    this.loadVisualAssets();
    this.installInput();
    this.renderIdleFrame();
  }

  async start(analysis: AudioAnalysis, difficulty: number, options: RuntimeStartOptions = {}): Promise<void> {
    this.stop();
    this.resize();
    const runToken = ++this.runToken;
    const bpm = analysis.calibration?.selectedBpm ?? analysis.bpm;
    const firstBeat = analysis.calibration?.selectedDownbeat ?? analysis.firstBeat;
    const beatGrid = createBattleBeatGrid(analysis, bpm, firstBeat);
    const rhythm = createRhythmTracker({
      bpm,
      firstBeat,
      duration: analysis.duration,
      beatGrid
    });
    const behaviorMode = options.behaviorMode ?? 'rules';
    this.callbacks.onStatus(behaviorMode === 'llm-preferred'
      ? '正在调用 MiMo 大模型生成段落行为...'
      : '正在使用 FFT 段落生成规则行为...');
    const behaviorTimeline = await createBehaviorTimeline({
      bpm,
      difficulty,
      downbeat: firstBeat,
      beatGrid,
      segments: analysis.segments,
      primitives: analysis.primitives,
      confidence: {
        overall: 0.85,
        segmentation: 0.8,
        tempo: 0.9
      }
    }, {
      strategy: behaviorMode,
      llmProvider: options.llmProvider
    });

    this.world = createInitialWorld({
      width: this.canvas.width,
      height: this.canvas.height,
      difficulty,
      rhythm,
      behaviorPlan: behaviorTimeline.modules.map((module) => ({
        ...module,
        label: module.segmentLabel
      }))
    });
    this.duration = analysis.duration;
    this.audioContext = new AudioContext();
    this.soundEffects.connect(this.audioContext);
    this.analyser = this.audioContext.createAnalyser();
    this.analyser.fftSize = 512;
    this.frequencyData = new Uint8Array(this.analyser.frequencyBinCount);
    this.source = this.audioContext.createBufferSource();
    this.source.buffer = analysis.buffer;
    this.source.connect(this.analyser);
    this.analyser.connect(this.audioContext.destination);
    this.startTime = this.audioContext.currentTime;
    const activeSource = this.source;
    activeSource.start();
    activeSource.onended = () => {
      if (runToken !== this.runToken || this.source !== activeSource) return;
      if (this.world?.result === 'playing') {
        this.world.result = 'victory';
        this.finishRun('victory');
      }
    };

    this.running = true;
    this.lastFrame = performance.now();
    this.feedbackText = '锁定节拍';
    this.feedbackTone = 'warning';
    this.feedbackTimer = 1.2;
    const modeLabel = behaviorMode === 'llm-preferred'
      ? (behaviorTimeline.metadata.fallbackUsed ? '大模型优先（规则回退）' : '大模型')
      : '规则';
    const warningText = behaviorTimeline.metadata.validationWarnings.length > 0
      ? ` / ${behaviorTimeline.metadata.validationWarnings[0]}`
      : '';
    this.callbacks.onStatus(
      `BPM ${bpm} / ${analysis.segments.length} 段 / ${behaviorTimeline.modules.length} 动作 / 威胁 ${difficulty.toFixed(1)}x / ${modeLabel}${warningText}`
    );
    this.animationId = requestAnimationFrame((time) => this.loop(time));
  }

  stop(): void {
    this.runToken += 1;
    this.running = false;
    cancelAnimationFrame(this.animationId);
    const activeSource = this.source;
    this.source = null;
    if (activeSource) {
      activeSource.onended = null;
      try {
        activeSource.stop();
      } catch {
        // ignore invalid stop calls on stale sources
      }
    }
    this.analyser = null;
    this.frequencyData = null;
    this.lowFrequencyEnergy = 0;
    this.pendingAttack = false;
    this.pendingBlock = false;
    this.pendingDash = false;
    this.keys.clear();
    this.feedbackTimer = 0;
    this.playerFlashTimer = 0;
    this.bossFlashTimer = 0;
    this.screenShakeTimer = 0;
    this.screenShakeStrength = 0;
    this.beatPulseTimer = 0;
    this.lastBeatPulseAt = -Infinity;
    this.particles = [];
    this.sequences = [];
    this.soundEffects.disconnect();
    void this.audioContext?.close();
    this.audioContext = null;
    this.renderIdleFrame();
  }

  resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    const scale = window.devicePixelRatio || 1;
    this.canvas.width = Math.max(1, Math.floor(rect.width * scale));
    this.canvas.height = Math.max(1, Math.floor(rect.height * scale));
    this.syncWorldToCanvas();
    if (!this.world) {
      this.renderIdleFrame();
    }
  }

  private installInput(): void {
    window.addEventListener('keydown', (event) => {
      this.keys.add(event.key.toLowerCase());
      if (event.key === ' ') {
        event.preventDefault();
        this.pendingDash = true;
      }
      if (event.key.toLowerCase() === 'f') this.pendingBlock = true;
    });
    window.addEventListener('keyup', (event) => {
      this.keys.delete(event.key.toLowerCase());
    });
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.pendingAttack = false;
      this.pendingBlock = false;
      this.pendingDash = false;
    });
    this.canvas.addEventListener('pointermove', (event) => {
      this.updatePointerFromEvent(event);
    });
    this.canvas.addEventListener('pointerdown', (event) => {
      this.updatePointerFromEvent(event);
      if (event.button === 0) {
        this.pendingAttack = true;
        this.canvas.setPointerCapture(event.pointerId);
      }
    });
    this.canvas.addEventListener('contextmenu', (event) => event.preventDefault());
  }

  private updatePointerFromEvent(event: PointerEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    const scaleX = this.canvas.width / rect.width;
    const scaleY = this.canvas.height / rect.height;
    this.pointer.x = (event.clientX - rect.left) * scaleX;
    this.pointer.y = (event.clientY - rect.top) * scaleY;
  }

  private loadVisualAssets(): void {
    const atlas = this.assetAtlas;
    if (atlas) {
      atlas.addEventListener('load', () => {
        this.assetAtlasReady = true;
        this.assetTileSize = Math.floor(Math.min(atlas.naturalWidth, atlas.naturalHeight) / 2);
        if (!this.world) {
          this.renderIdleFrame();
        }
      });
      atlas.src = new URL('../assets/abstract-unit-flat-atlas-alpha.png', import.meta.url).href;
    }

    const vfxAtlas = this.vfxAtlas;
    if (vfxAtlas) {
      vfxAtlas.addEventListener('load', () => {
        this.vfxAtlasReady = true;
        this.vfxFrameSize = Math.min(vfxAtlas.naturalWidth, vfxAtlas.naturalHeight) / 4;
      });
      vfxAtlas.src = new URL('../assets/cyberpunk-vfx-sequence-atlas-alpha.png', import.meta.url).href;
    }

    const projectileAtlas = this.projectileAtlas;
    if (projectileAtlas) {
      projectileAtlas.addEventListener('load', () => {
        this.projectileAtlasReady = true;
        this.projectileFrameWidth = projectileAtlas.naturalWidth / GENERATED_VFX_SEQUENCE_FRAMES;
        this.projectileFrameHeight = projectileAtlas.naturalHeight / GENERATED_VFX_SEQUENCE_ROWS;
      });
      projectileAtlas.src = new URL('../assets/projectile-vfx-atlas-alpha.png', import.meta.url).href;
    }

    const feedbackAtlas = this.feedbackAtlas;
    if (feedbackAtlas) {
      feedbackAtlas.addEventListener('load', () => {
        this.feedbackAtlasReady = true;
        this.feedbackFrameWidth = feedbackAtlas.naturalWidth / GENERATED_VFX_SEQUENCE_FRAMES;
        this.feedbackFrameHeight = feedbackAtlas.naturalHeight / GENERATED_VFX_SEQUENCE_ROWS;
      });
      feedbackAtlas.src = new URL('../assets/feedback-vfx-atlas-alpha.png', import.meta.url).href;
    }

    const characterAtlas = this.characterAtlas;
    if (characterAtlas) {
      characterAtlas.addEventListener('load', () => {
        this.characterAtlasReady = true;
        this.characterFrameWidth = characterAtlas.naturalWidth / CHARACTER_SEQUENCE_FRAMES;
        this.characterFrameHeight = characterAtlas.naturalHeight / 2;
      });
      characterAtlas.src = new URL('../assets/cyberpunk-character-sequence-atlas-20-alpha.png', import.meta.url).href;
    }
  }

  private loop(frameTime: number): void {
    if (!this.running || !this.world || !this.audioContext) return;
    const dt = Math.min(0.033, (frameTime - this.lastFrame) / 1000);
    this.lastFrame = frameTime;
    const time = this.audioContext.currentTime - this.startTime;
    const input = this.readInput(time);
    const previousPlayerX = this.world.player.x;
    const previousPlayerY = this.world.player.y;

    stepWorld(this.world, dt, input);
    if (input.dash && !this.world.events.some((event) => event.type === 'dash-blocked-by-cooldown')) {
      this.spawnDashTrail(previousPlayerX, previousPlayerY, this.world.player.x, this.world.player.y, this.world.player.dodgeEnhanced);
    }
    this.consumeWorldEvents(dt);
    if (time >= this.duration && this.world.result === 'playing') {
      this.world.result = 'victory';
    }
    this.draw(time, dt);

    if (this.world.result !== 'playing') {
      if (this.world.result === 'defeat') {
        this.finishRun(this.world.result, true);
      } else {
        this.finishRun(this.world.result);
      }
      return;
    }

    this.animationId = requestAnimationFrame((nextTime) => this.loop(nextTime));
  }

  private readInput(time: number): CombatInput {
    const moveX = Number(this.keys.has('d') || this.keys.has('arrowright')) - Number(this.keys.has('a') || this.keys.has('arrowleft'));
    const moveY = Number(this.keys.has('s') || this.keys.has('arrowdown')) - Number(this.keys.has('w') || this.keys.has('arrowup'));
    const input: CombatInput = {
      moveX,
      moveY,
      pointerX: this.pointer.x,
      pointerY: this.pointer.y,
      attack: this.pendingAttack,
      block: this.pendingBlock,
      dash: this.pendingDash,
      time
    };
    this.pendingAttack = false;
    this.pendingBlock = false;
    this.pendingDash = false;
    return input;
  }

  private syncWorldToCanvas(): void {
    if (!this.world) return;
    const previousArena = this.world.arena;
    const nextArena = createArena(this.canvas.width, this.canvas.height);
    const player = projectIntoArena(previousArena, nextArena, this.world.player.x, this.world.player.y);
    const boss = projectIntoArena(previousArena, nextArena, this.world.boss.x, this.world.boss.y);
    const home = projectIntoArena(previousArena, nextArena, this.world.boss.homeX, this.world.boss.homeY);

    this.world.arena = nextArena;
    this.world.player.x = player.x;
    this.world.player.y = player.y;
    this.world.boss.x = boss.x;
    this.world.boss.y = boss.y;
    this.world.boss.homeX = home.x;
    this.world.boss.homeY = home.y;
  }

  private draw(time: number, dt: number): void {
    if (!this.world) return;
    const ctx = this.context;
    const shakeX = this.screenShakeTimer > 0 ? (Math.random() - 0.5) * this.screenShakeStrength * 2 : 0;
    const shakeY = this.screenShakeTimer > 0 ? (Math.random() - 0.5) * this.screenShakeStrength * 2 : 0;
    const energy = this.readEnergy();
    this.updateBeatPulse(time, dt);
    this.updateParticles(dt);
    this.updateSequences(dt);

    ctx.save();
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.translate(shakeX, shakeY);
    ctx.fillStyle = '#050505';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    this.drawAudioGlow(energy);
    this.drawArena(energy, time);
    this.drawBeatPulse();
    this.drawCore(time);
    this.drawAttackTelegraph(time);
    this.drawHazards(time);
    this.drawProjectiles(time);
    this.drawBossHealthBar();
    this.drawActor(
      this.world.player.x,
      this.world.player.y,
      this.world.player.radius,
      this.playerFlashTimer > 0
        ? (this.playerFlashTone === 'guard' ? '#8bf2cf' : '#ff8b8b')
        : '#4fb3d8',
      'player',
      time
    );
    this.drawPlayerHitbox();
    this.drawAttackArc();
    this.drawParticles();
    this.drawSequences();
    this.drawRhythmGuide(time);
    this.drawHud(time, energy);
    this.drawFeedbackBanner();
    ctx.restore();
  }

  private renderIdleFrame(): void {
    const ctx = this.context;
    const width = this.canvas.width || 640;
    const height = this.canvas.height || 420;
    ctx.save();
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#050608';
    ctx.fillRect(0, 0, width, height);

    const arena = createArena(width, height);
    const arenaWidth = arena.maxX - arena.minX;
    const arenaHeight = arena.maxY - arena.minY;
    if (this.assetAtlasReady) {
      ctx.save();
      ctx.globalAlpha = 0.42;
      this.drawAtlasSprite('arena', width / 2, height / 2, arenaWidth * 1.04, arenaHeight * 1.04);
      ctx.restore();
    }

    ctx.strokeStyle = 'rgba(112, 216, 209, 0.24)';
    ctx.lineWidth = 1;
    for (let x = arena.minX; x <= arena.maxX; x += 48) {
      ctx.beginPath();
      ctx.moveTo(x, arena.minY);
      ctx.lineTo(x, arena.maxY);
      ctx.stroke();
    }
    for (let y = arena.minY; y <= arena.maxY; y += 48) {
      ctx.beginPath();
      ctx.moveTo(arena.minX, y);
      ctx.lineTo(arena.maxX, y);
      ctx.stroke();
    }

    ctx.strokeStyle = 'rgba(112, 216, 209, 0.78)';
    ctx.lineWidth = 2;
    ctx.strokeRect(arena.minX, arena.minY, arenaWidth, arenaHeight);
    ctx.strokeStyle = 'rgba(214, 180, 95, 0.74)';
    ctx.beginPath();
    ctx.moveTo(arena.minX + 18, arena.minY + 18);
    ctx.lineTo(arena.minX + 70, arena.minY + 18);
    ctx.moveTo(arena.maxX - 18, arena.maxY - 18);
    ctx.lineTo(arena.maxX - 70, arena.maxY - 18);
    ctx.stroke();
    ctx.restore();
  }

  private drawArena(energy: number, time: number): void {
    if (!this.world) return;
    const { minX, minY, maxX, maxY } = this.world.arena;
    const ctx = this.context;
    const width = maxX - minX;
    const height = maxY - minY;
    const pulse = this.getBeatPulse();
    if (this.assetAtlasReady) {
      ctx.save();
      ctx.globalAlpha = 0.34 + energy * 0.28 + pulse * 0.12;
      this.drawAtlasSprite('arena', minX + width / 2, minY + height / 2, width * 1.04, height * 1.04);
      ctx.restore();
    }
    ctx.save();
    ctx.shadowColor = '#70d8d1';
    ctx.shadowBlur = 10 + energy * 26 + pulse * 22;
    ctx.strokeStyle = `rgba(112, 216, 209, ${0.48 + energy * 0.24 + pulse * 0.22})`;
    ctx.lineWidth = 2 + energy * 3 + pulse * 2;
    ctx.strokeRect(minX, minY, width, height);
    ctx.restore();
    ctx.strokeStyle = '#2c2c2c';
    ctx.lineWidth = 1;
    for (let x = minX + 50; x < maxX; x += 50) {
      const phase = (x - minX) / (maxX - minX);
      const offset = Math.sin(time * 6 + phase * Math.PI * 4) * this.lowFrequencyEnergy * 22;
      ctx.beginPath();
      ctx.moveTo(x + offset, minY);
      ctx.lineTo(x - offset, maxY);
      ctx.stroke();
    }
    for (let y = minY + 50; y < maxY; y += 50) {
      const phase = (y - minY) / (maxY - minY);
      const offset = Math.cos(time * 6 + phase * Math.PI * 4) * this.lowFrequencyEnergy * 22;
      ctx.beginPath();
      ctx.moveTo(minX, y + offset);
      ctx.lineTo(maxX, y - offset);
      ctx.stroke();
    }
    this.drawArenaTextureSweep(time, energy);
  }

  private drawArenaTextureSweep(time: number, energy: number): void {
    if (!this.world) return;
    const ctx = this.context;
    const { minX, minY, maxX, maxY } = this.world.arena;
    const width = maxX - minX;
    const height = maxY - minY;
    const sweepY = minY + ((time * 120) % (height + 80)) - 40;
    const pulse = this.getBeatPulse();

    ctx.save();
    ctx.globalAlpha = 0.18 + energy * 0.16 + pulse * 0.1;
    ctx.fillStyle = '#70d8d1';
    ctx.shadowColor = '#70d8d1';
    ctx.shadowBlur = 14;
    ctx.fillRect(minX + width * 0.08, sweepY, width * 0.84, 2);
    ctx.globalAlpha *= 0.35;
    ctx.fillRect(minX + width * 0.18, sweepY + 14, width * 0.64, 1);
    ctx.globalAlpha = 0.14 + pulse * 0.16;
    ctx.fillStyle = '#d6b45f';
    const tick = (Math.floor(time * 8) % 4) * 18;
    ctx.fillRect(minX + 28 + tick, minY + 28, 14, 2);
    ctx.fillRect(maxX - 42 - tick, maxY - 30, 14, 2);
    ctx.restore();
  }

  private drawAudioGlow(energy: number): void {
    if (!this.world) return;
    const ctx = this.context;
    const pulse = this.getBeatPulse();
    const low = this.lowFrequencyEnergy;
    const { minX, minY, maxX, maxY } = this.world.arena;

    ctx.save();
    ctx.globalAlpha = 0.16 + energy * 0.18 + pulse * 0.14;
    ctx.fillStyle = 'rgba(112, 216, 209, 0.22)';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.globalAlpha = 0.14 + low * 0.26;
    ctx.fillStyle = 'rgba(214, 180, 95, 0.18)';
    ctx.fillRect(minX, minY, maxX - minX, maxY - minY);
    ctx.restore();
  }

  private drawBeatPulse(): void {
    if (!this.world) return;
    const pulse = this.getBeatPulse();
    if (pulse <= 0) return;
    const ctx = this.context;
    const boss = this.world.boss;
    const arena = this.world.arena;
    const arenaRadius = Math.min(arena.maxX - arena.minX, arena.maxY - arena.minY) * (0.16 + pulse * 0.32);

    ctx.save();
    ctx.shadowColor = '#d6b45f';
    ctx.shadowBlur = 18 + pulse * 24;
    ctx.strokeStyle = `rgba(214, 180, 95, ${0.08 + pulse * 0.28})`;
    ctx.lineWidth = 1 + pulse * 3;
    ctx.beginPath();
    ctx.arc(boss.x, boss.y, arenaRadius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  private drawBossHealthBar(): void {
    if (!this.world) return;
    const ctx = this.context;
    const width = Math.min(360, Math.max(180, this.canvas.width * 0.34));
    const height = 10;
    const x = (this.canvas.width - width) / 2;
    const y = 22;
    const ratio = clamp(this.world.boss.hp / this.world.boss.maxHp, 0, 1);

    ctx.save();
    ctx.fillStyle = 'rgba(8, 10, 12, 0.82)';
    ctx.fillRect(x - 10, y - 18, width + 20, 34);
    ctx.strokeStyle = 'rgba(86, 96, 108, 0.8)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x - 10, y - 18, width + 20, 34);
    ctx.fillStyle = '#8b949d';
    ctx.font = '800 11px system-ui, sans-serif';
    ctx.fillText('核心耐久', x, y - 6);
    ctx.fillStyle = 'rgba(86, 96, 108, 0.64)';
    ctx.fillRect(x, y, width, height);
    ctx.fillStyle = ratio > 0.28 ? '#d96868' : '#f4d35e';
    ctx.fillRect(x, y, width * ratio, height);
    ctx.fillStyle = '#f1f4f3';
    ctx.font = '700 11px system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(`${Math.round(this.world.boss.hp)}/${this.world.boss.maxHp}`, x + width, y - 6);
    ctx.textAlign = 'start';
    ctx.restore();
  }

  private drawAttackTelegraph(time: number): void {
    if (!this.world || !this.world.activeBehavior || this.world.activeBehavior.attack === 'none') return;
    const behavior = this.world.activeBehavior;
    const beatInterval = this.world.rhythm.getBeatInterval();
    const warningWindow = Math.min(0.26, beatInterval * 0.58);
    const timeToBeat = this.world.rhythm.timeToNextBeat(time);
    const fireWindowBeats = Math.max(1, behavior.fireWindowBeats ?? 1);
    const minimumSpawnGap = Math.max(0.2, beatInterval * fireWindowBeats * 0.95);
    if (timeToBeat > warningWindow || time - this.world.boss.lastBeatSpawnAt + timeToBeat < minimumSpawnGap - 0.02) return;

    const ctx = this.context;
    const boss = this.world.boss;
    const alpha = (1 - timeToBeat / warningWindow) * (0.18 + behavior.warningIntensity * 0.24);
    const count = behavior.attack === 'laser-ray'
      ? 1
      : Math.max(1, Math.round(behavior.bulletCount * clamp(this.world.difficulty, 0.3, 2) * 0.5));
    const aimedAngle = Math.atan2(this.world.player.y - boss.y, this.world.player.x - boss.x);

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.shadowColor = '#ff8b8b';
    ctx.shadowBlur = 16;
    ctx.strokeStyle = '#ff8b8b';
    ctx.lineWidth = 1.5 + behavior.warningIntensity * 2;

    if (behavior.attack === 'charge-strike' || behavior.attack === 'charge-sweep') {
      ctx.strokeStyle = '#ff8b8b';
      ctx.shadowColor = '#ff8b8b';
      ctx.lineWidth = 4 + behavior.warningIntensity * 3;
      this.drawTelegraphRay(boss.x, boss.y, aimedAngle, boss.radius * 0.8, 420);
      ctx.beginPath();
      ctx.arc(this.world.player.x, this.world.player.y, 26 + behavior.warningIntensity * 18, 0, Math.PI * 2);
      ctx.stroke();
      if (behavior.attack === 'charge-sweep') {
        this.drawSweepTelegraph(boss.x, boss.y, boss.radius * (3.4 + behavior.warningIntensity * 2.2));
      }
    } else if (behavior.attack === 'melee-sweep') {
      ctx.strokeStyle = '#ff8b8b';
      ctx.shadowColor = '#ff8b8b';
      ctx.lineWidth = 2 + behavior.warningIntensity * 3;
      this.drawSweepTelegraph(boss.x, boss.y, boss.radius * (3.4 + behavior.warningIntensity * 2.2));
    } else if (behavior.attack === 'cone-cleave') {
      ctx.strokeStyle = '#ff8b8b';
      ctx.shadowColor = '#ff8b8b';
      ctx.lineWidth = 2 + behavior.warningIntensity * 3;
      this.drawMeleeTelegraph(boss.x, boss.y, aimedAngle, boss.radius * 5.6);
    } else if (behavior.attack === 'ground-slam') {
      ctx.strokeStyle = '#f4d35e';
      ctx.shadowColor = '#d6b45f';
      ctx.lineWidth = 2 + behavior.warningIntensity * 3;
      ctx.beginPath();
      ctx.arc(this.world.player.x, this.world.player.y, 52 + behavior.warningIntensity * 58 + this.world.difficulty * 8, 0, Math.PI * 2);
      ctx.stroke();
    } else if (behavior.attack === 'laser-ray' || behavior.attack === 'laser-barrage') {
      ctx.strokeStyle = '#8bf2cf';
      ctx.shadowColor = '#70d8d1';
      ctx.lineWidth = 2 + behavior.warningIntensity * 2;
      const laserWidth = 6 + behavior.warningIntensity * 14;
      const laserStartOffset = boss.radius + laserWidth + 8;
      const laserRayCount = behavior.attack === 'laser-barrage' ? 1 : Math.min(count, 6);
      for (let index = 0; index < laserRayCount; index += 1) {
        const laserAngle = behavior.attack === 'laser-barrage'
          ? aimedAngle
          : this.resolveTelegraphAngle(behavior.attack, aimedAngle, count, index);
        this.drawTelegraphRay(boss.x, boss.y, laserAngle, laserStartOffset, 440);
      }
      if (behavior.attack === 'laser-barrage') {
        ctx.strokeStyle = '#ff8b8b';
        for (let index = 0; index < Math.min(Math.max(4, count), 8); index += 1) {
          this.drawTelegraphRay(boss.x, boss.y, aimedAngle + (index - 3.5) * 0.16, 64, 280);
        }
      }
    } else if (behavior.attack === 'explosive-burst') {
      ctx.strokeStyle = '#f4d35e';
      ctx.shadowColor = '#d6b45f';
      ctx.lineWidth = 2 + behavior.warningIntensity * 2;
      ctx.beginPath();
      ctx.arc(boss.x, boss.y, boss.radius * (2.5 + behavior.warningIntensity * 2.2), 0, Math.PI * 2);
      ctx.stroke();
      const projectileStartOffset = this.resolveProjectileTelegraphStartOffset(behavior.attack, boss.radius, behavior.warningIntensity);
      for (let index = 0; index < Math.min(count, 10); index += 1) {
        this.drawTelegraphRay(boss.x, boss.y, this.resolveTelegraphAngle(behavior.attack, aimedAngle, count, index), projectileStartOffset, 260);
      }
    } else if (behavior.attack === 'screen-ring' || behavior.attack === 'sparse-ring') {
      const radius = boss.radius * (2.1 + behavior.warningIntensity * 1.4);
      ctx.beginPath();
      ctx.arc(boss.x, boss.y, radius, 0, Math.PI * 2);
      ctx.stroke();
      for (let index = 0; index < Math.min(count, 16); index += 1) {
        const angle = (Math.PI * 2 * index) / Math.max(1, count) + Math.sin(this.world.boss.lastBeatSpawnAt) * 0.2;
        this.drawTelegraphRay(boss.x, boss.y, angle, 78, 340);
      }
    } else {
      const projectileStartOffset = this.resolveProjectileTelegraphStartOffset(behavior.attack, boss.radius, behavior.warningIntensity);
      for (let index = 0; index < Math.min(count, 14); index += 1) {
        this.drawTelegraphRay(
          boss.x,
          boss.y,
          this.resolveTelegraphAngle(behavior.attack, aimedAngle, count, index),
          projectileStartOffset,
          360
        );
      }
    }
    ctx.restore();
  }

  private resolveProjectileTelegraphStartOffset(attack: string, bossRadius: number, warningIntensity: number): number {
    if (attack === 'explosive-burst') {
      return bossRadius + 20 + warningIntensity * 6;
    }
    return bossRadius + 16 + warningIntensity * 6;
  }

  private resolveTelegraphAngle(attack: string, aimedAngle: number, count: number, index: number): number {
    if (attack === 'aimed-burst') {
      return aimedAngle + (index - (count - 1) / 2) * 0.12;
    }
    if (attack === 'lane-burst') {
      const laneOffsets = [-0.42, -0.16, 0.16, 0.42];
      return aimedAngle + laneOffsets[index % laneOffsets.length];
    }
    if (attack === 'laser-ray' || attack === 'laser-barrage') {
      return aimedAngle + (index - (count - 1) / 2) * 0.08;
    }
    if (attack === 'explosive-burst') {
      return (Math.PI * 2 * index) / count + (index % 2 === 0 ? 0.16 : -0.16);
    }
    return (Math.PI * 2 * index) / count;
  }

  private drawHazards(time: number): void {
    if (!this.world || this.world.hazards.length === 0) return;
    const ctx = this.context;

    ctx.save();
    for (const hazard of this.world.hazards) {
      const remaining = Math.max(0, hazard.damageAt - time);
      const pulse = 1 - clamp(remaining / 0.28, 0, 1);
      const alpha = 0.18 + pulse * 0.3;
      ctx.globalAlpha = alpha;
      ctx.shadowBlur = 14 + pulse * 22;
      ctx.lineWidth = 2 + pulse * 3;

      if (hazard.kind === 'laser') {
        ctx.strokeStyle = '#8bf2cf';
        ctx.shadowColor = '#70d8d1';
        this.drawTelegraphRay(hazard.x, hazard.y, hazard.angle, 0, hazard.reach);
      } else if (hazard.kind === 'circle') {
        ctx.strokeStyle = '#f4d35e';
        ctx.fillStyle = '#f4d35e';
        ctx.shadowColor = '#d6b45f';
        ctx.beginPath();
        ctx.arc(hazard.x, hazard.y, hazard.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = Math.min(0.9, alpha * 2);
        ctx.stroke();
      } else {
        ctx.strokeStyle = '#ff8b8b';
        ctx.fillStyle = '#ff8b8b';
        ctx.shadowColor = '#ff8b8b';
        ctx.beginPath();
        ctx.moveTo(hazard.x, hazard.y);
        ctx.arc(hazard.x, hazard.y, hazard.radius, hazard.angle - hazard.halfAngle, hazard.angle + hazard.halfAngle);
        ctx.closePath();
        ctx.fill();
        ctx.globalAlpha = Math.min(0.9, alpha * 2);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  private drawTelegraphRay(originX: number, originY: number, angle: number, startOffset: number, maxLength: number): void {
    if (!this.world) return;
    const arenaEnd = projectRayToArena(originX, originY, angle, this.world.arena);
    const startX = originX + Math.cos(angle) * startOffset;
    const startY = originY + Math.sin(angle) * startOffset;
    const fullLength = Math.hypot(arenaEnd.x - startX, arenaEnd.y - startY) || 1;
    const length = Math.min(fullLength, maxLength);
    const endX = startX + Math.cos(angle) * length;
    const endY = startY + Math.sin(angle) * length;
    const ctx = this.context;
    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.lineTo(endX, endY);
    ctx.stroke();
  }

  private drawMeleeTelegraph(originX: number, originY: number, angle: number, radius: number): void {
    const ctx = this.context;
    const halfArc = Math.PI * 0.62;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(originX, originY);
    ctx.arc(originX, originY, radius, angle - halfArc, angle + halfArc);
    ctx.closePath();
    ctx.globalAlpha *= 0.32;
    ctx.fillStyle = '#ff8b8b';
    ctx.fill();
    ctx.globalAlpha *= 2.6;
    ctx.stroke();
    ctx.restore();
  }

  private drawSweepTelegraph(originX: number, originY: number, radius: number): void {
    const ctx = this.context;
    ctx.save();
    ctx.beginPath();
    ctx.arc(originX, originY, radius, 0, Math.PI * 2);
    ctx.globalAlpha *= 0.22;
    ctx.fillStyle = '#ff8b8b';
    ctx.fill();
    ctx.globalAlpha *= 3.1;
    ctx.stroke();
    ctx.restore();
  }

  private drawCore(time: number): void {
    if (!this.world) return;
    const behavior = this.world.activeBehavior;
    const warning = behavior?.warningIntensity ?? 0.35;
    const shake = warning > 0.75 ? Math.sin(time * 70) * 4 : 0;
    const radius = this.world.boss.radius * (1 + warning * 0.18 + this.lowFrequencyEnergy * 0.12);
    const x = this.world.boss.x + shake;
    const y = this.world.boss.y - shake;
    const ctx = this.context;
    const pulse = this.getBeatPulse();

    this.drawLightCircle(x, y, radius * (2.6 + pulse * 1.2), warning > 0.7 ? '#ff5f5f' : '#d84f4f', 0.08 + warning * 0.08 + pulse * 0.06);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(time * (1.5 + warning * 3));
    const bossColor = this.bossFlashTimer > 0
      ? '#fff1a8'
      : warning > 0.7 ? '#ff2f2f' : '#d84f4f';
    if (!this.assetAtlasReady) {
      ctx.fillStyle = bossColor;
      ctx.beginPath();
      ctx.arc(0, 0, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#ff9b9b';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-radius * 0.55, 0);
      ctx.lineTo(radius * 0.55, 0);
      ctx.moveTo(0, -radius * 0.55);
      ctx.lineTo(0, radius * 0.55);
      ctx.stroke();
    }
    if (warning > 0.65) {
      ctx.strokeStyle = `rgba(255, 80, 80, ${warning})`;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(0, 0, radius + 12, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (this.assetAtlasReady) {
      ctx.shadowColor = bossColor;
      ctx.shadowBlur = 12 + warning * 20 + pulse * 18;
      if (this.characterAtlasReady) {
        ctx.save();
        ctx.globalAlpha = 0.22 + pulse * 0.12;
        this.drawCharacterSequenceSprite('boss', 0, 0, radius * (4.7 + pulse * 0.32), time, 0, 1 + pulse * 0.04, 1 - pulse * 0.03);
        ctx.restore();
        this.drawCharacterSequenceSprite('boss', 0, 0, radius * 4.25, time);
      } else {
        ctx.save();
        ctx.globalAlpha = 0.18 + pulse * 0.12;
        this.drawAtlasSprite('boss', 0, 0, radius * (4.15 + pulse * 0.32), radius * (4.15 + pulse * 0.32));
        ctx.restore();
        this.drawAtlasSprite('boss', 0, 0, radius * 3.7, radius * 3.7);
      }
      this.drawBossTextureFlares(radius, time, bossColor);
      this.drawBossInnerReactor(radius, time, bossColor);
    }
    ctx.restore();
  }

  private drawBossTextureFlares(radius: number, time: number, color: string): void {
    const ctx = this.context;
    ctx.save();
    ctx.rotate(-time * 2.4);
    ctx.strokeStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 12;
    ctx.globalAlpha = 0.48 + this.getBeatPulse() * 0.24;
    ctx.lineWidth = 2;
    for (let index = 0; index < 3; index += 1) {
      const angle = index * Math.PI * 2 / 3 + time * 0.6;
      const inner = radius * 1.45;
      const outer = radius * (1.75 + Math.sin(time * 5 + index) * 0.08);
      ctx.beginPath();
      ctx.moveTo(Math.cos(angle) * inner, Math.sin(angle) * inner);
      ctx.lineTo(Math.cos(angle) * outer, Math.sin(angle) * outer);
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawBossInnerReactor(radius: number, time: number, color: string): void {
    const ctx = this.context;
    const pulse = this.getBeatPulse();
    const spin = time * 3.8;
    ctx.save();
    ctx.rotate(spin);
    ctx.strokeStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 10 + pulse * 12;
    ctx.globalAlpha = 0.42 + pulse * 0.28;
    ctx.lineWidth = 2;
    for (let index = 0; index < 3; index += 1) {
      const angle = index * Math.PI * 2 / 3;
      const next = angle + Math.PI * 2 / 3;
      ctx.beginPath();
      ctx.moveTo(Math.cos(angle) * radius * 0.38, Math.sin(angle) * radius * 0.38);
      ctx.lineTo(Math.cos(next) * radius * 0.38, Math.sin(next) * radius * 0.38);
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawProjectiles(time: number): void {
    if (!this.world) return;
    const ctx = this.context;
    for (const projectile of this.world.projectiles) {
      const kind = projectile.kind ?? 'bullet';
      const speed = Math.hypot(projectile.vx, projectile.vy) || 1;
      const angle = speed > 0 ? Math.atan2(projectile.vy, projectile.vx) : 0;
      const renderOrigin = this.resolveProjectileRenderOrigin(projectile, kind);
      const trailLength = kind === 'laser' ? 72 : kind === 'explosion' ? 22 : kind === 'melee' ? 46 : 36;
      const unclampedTrailX = renderOrigin.x - (projectile.vx / speed) * trailLength;
      const unclampedTrailY = renderOrigin.y - (projectile.vy / speed) * trailLength;
      const trailEnd = this.clampProjectileTrailEnd(projectile, kind, unclampedTrailX, unclampedTrailY);
      const trailX = trailEnd.x;
      const trailY = trailEnd.y;
      const coreColor = projectile.grazed
        ? '#8bf2cf'
        : kind === 'laser'
          ? '#70d8d1'
          : kind === 'explosion'
            ? '#ff8b8b'
            : kind === 'melee'
              ? '#d6b45f'
              : '#f1f4f3';
      const trailColor = projectile.grazed
        ? 'rgba(139, 242, 207, 0.34)'
        : kind === 'laser'
          ? 'rgba(112, 216, 209, 0.58)'
          : kind === 'explosion'
            ? 'rgba(255, 107, 107, 0.28)'
            : kind === 'melee'
              ? 'rgba(214, 180, 95, 0.42)'
              : 'rgba(241, 244, 243, 0.42)';
      ctx.save();
      ctx.shadowColor = coreColor;
      ctx.shadowBlur = kind === 'explosion' ? 18 : kind === 'laser' ? 14 : 10;
      ctx.strokeStyle = trailColor;
      ctx.lineWidth = kind === 'laser' ? 2 : Math.max(2, projectile.radius * 0.5);
      ctx.beginPath();
      ctx.moveTo(renderOrigin.x, renderOrigin.y);
      ctx.lineTo(trailX, trailY);
      ctx.stroke();
      if (kind === 'laser') {
        ctx.strokeStyle = 'rgba(241, 244, 243, 0.72)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(renderOrigin.x, renderOrigin.y);
        ctx.lineTo(trailX, trailY);
        ctx.stroke();
      }
      if (kind === 'explosion') {
        this.drawLightCircle(renderOrigin.x, renderOrigin.y, projectile.radius * 3.2, '#f4d35e', 0.08);
        ctx.fillStyle = 'rgba(255, 107, 107, 0.12)';
        ctx.beginPath();
        ctx.arc(renderOrigin.x, renderOrigin.y, projectile.radius + 8, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.strokeStyle = projectile.grazed ? 'rgba(139, 242, 207, 0.28)' : trailColor;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(renderOrigin.x, renderOrigin.y, projectile.radius + (kind === 'explosion' ? 8 : 3), 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
      this.drawProjectileTextureSpark(renderOrigin.x, renderOrigin.y, angle, coreColor, time);
      if (this.projectileAtlasReady) {
        this.drawProjectileVfxFrame(projectile, kind, time, coreColor, renderOrigin.x, renderOrigin.y);
      } else {
        this.drawActor(renderOrigin.x, renderOrigin.y, projectile.radius, coreColor, 'projectile', time, angle);
      }
    }
  }

  private drawProjectileVfxFrame(
    projectile: NonNullable<WorldState['projectiles'][number]>,
    kind: NonNullable<WorldState['projectiles'][number]['kind']>,
    time: number,
    color: string,
    centerX: number,
    centerY: number
  ): void {
    if (!this.projectileAtlas || this.projectileFrameWidth <= 0 || this.projectileFrameHeight <= 0) return;
    const rowByKind = {
      bullet: 0,
      laser: 1,
      explosion: 2,
      melee: 3
    } satisfies Record<typeof kind, number>;
    const row = rowByKind[kind] ?? 0;
    const frameSeed = (projectile.age ?? time) * (kind === 'laser' ? 24 : kind === 'explosion' ? 14 : 18);
    const frame = Math.floor(frameSeed) % GENERATED_VFX_SEQUENCE_FRAMES;
    const speed = Math.hypot(projectile.vx, projectile.vy);
    const angle = speed > 0 ? Math.atan2(projectile.vy, projectile.vx) : 0;
    const sizeMultiplier = kind === 'laser' ? 8.2 : kind === 'explosion' ? 5.3 : kind === 'melee' ? 6.6 : 5.6;
    const size = projectile.radius * sizeMultiplier * (projectile.grazed ? 1.08 : 1);
    const ctx = this.context;

    ctx.save();
    ctx.translate(centerX, centerY);
    ctx.rotate(angle);
    ctx.globalAlpha = projectile.grazed ? 0.72 : 0.95;
    ctx.shadowColor = color;
    ctx.shadowBlur = kind === 'explosion' ? 22 : kind === 'laser' ? 16 : 12;
    ctx.drawImage(
      this.projectileAtlas,
      frame * this.projectileFrameWidth,
      row * this.projectileFrameHeight,
      this.projectileFrameWidth,
      this.projectileFrameHeight,
      -size / 2,
      -size / 2,
      size,
      size
    );
    ctx.restore();
  }

  private drawProjectileTextureSpark(x: number, y: number, angle: number, color: string, time: number): void {
    const ctx = this.context;
    const flicker = 0.45 + Math.sin(time * 24) * 0.18;
    ctx.save();
    ctx.globalAlpha = flicker;
    ctx.strokeStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 8;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x + Math.cos(angle) * 6, y + Math.sin(angle) * 6);
    ctx.lineTo(x + Math.cos(angle) * 16, y + Math.sin(angle) * 16);
    ctx.stroke();
    ctx.restore();
  }

  private drawActor(
    x: number,
    y: number,
    radius: number,
    color: string,
    asset?: 'player' | 'projectile',
    time = 0,
    rotation = 0
  ): void {
    const ctx = this.context;
    const pulse = this.getBeatPulse();
    this.drawLightCircle(x, y, radius * (asset === 'player' ? 4.6 : 3.2), color, asset === 'player' ? 0.08 + pulse * 0.06 : 0.1);
    if (asset === 'player' && this.characterAtlasReady) {
      const hover = Math.sin(time * 4.2) * 2.6;
      const animatedRotation = Math.sin(time * 2.6) * 0.08;
      const scaleX = 1 + pulse * 0.05;
      const scaleY = 1 - pulse * 0.03;
      ctx.save();
      ctx.shadowColor = color;
      ctx.shadowBlur = 10 + pulse * 10;
      this.drawCharacterSequenceSprite('player', x, y + hover, radius * 4.6, time, animatedRotation, scaleX, scaleY);
      this.drawPlayerTextureThruster(x, y, time, color);
      this.drawPlayerCoreAnimation(x, y + hover, time, color);
      ctx.restore();
      return;
    }
    if (asset && this.assetAtlasReady) {
      const scale = asset === 'player' ? 4.4 : 5.2;
      const hover = asset === 'player' ? Math.sin(time * 4.2) * 2.6 : 0;
      const animatedRotation = asset === 'player'
        ? Math.sin(time * 2.6) * 0.08
        : rotation + Math.sin(time * 16) * 0.18;
      const scaleX = asset === 'player' ? 1 + pulse * 0.05 : 1 + Math.sin(time * 14) * 0.06;
      const scaleY = asset === 'player' ? 1 - pulse * 0.03 : 1 - Math.sin(time * 14) * 0.04;
      ctx.save();
      ctx.shadowColor = color;
      ctx.shadowBlur = asset === 'player' ? 10 + pulse * 10 : 8;
      this.drawAtlasSpriteAnimated(asset, x, y + hover, radius * scale, radius * scale, animatedRotation, scaleX, scaleY);
      if (asset === 'player') {
        this.drawPlayerTextureThruster(x, y, time, color);
        this.drawPlayerCoreAnimation(x, y + hover, time, color);
      }
      ctx.restore();
      return;
    }
    ctx.save();
    ctx.shadowColor = color;
    ctx.shadowBlur = 12;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  private drawCharacterSequenceSprite(
    actor: 'player' | 'boss',
    centerX: number,
    centerY: number,
    size: number,
    time: number,
    rotation = 0,
    scaleX = 1,
    scaleY = 1
  ): void {
    if (!this.characterAtlas || !this.characterAtlasReady || this.characterFrameWidth <= 0 || this.characterFrameHeight <= 0) return;
    const frameRate = actor === 'player' ? 18 : 14;
    const frame = Math.floor(time * frameRate + (actor === 'boss' ? 3 : 0)) % CHARACTER_SEQUENCE_FRAMES;
    const row = actor === 'player' ? 0 : 1;
    const aspect = this.characterFrameWidth / this.characterFrameHeight;
    const width = size * aspect;
    const height = size;
    const ctx = this.context;

    ctx.save();
    ctx.translate(centerX, centerY);
    ctx.rotate(rotation);
    ctx.scale(scaleX, scaleY);
    ctx.drawImage(
      this.characterAtlas,
      frame * this.characterFrameWidth,
      row * this.characterFrameHeight,
      this.characterFrameWidth,
      this.characterFrameHeight,
      -width / 2,
      -height / 2,
      width,
      height
    );
    ctx.restore();
  }

  private drawPlayerCoreAnimation(x: number, y: number, time: number, color: string): void {
    const ctx = this.context;
    const pulse = this.getBeatPulse();
    const radius = 10 + Math.sin(time * 6) * 1.5 + pulse * 4;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 12 + pulse * 10;
    ctx.globalAlpha = 0.58 + pulse * 0.26;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, radius, time * 2.8, time * 2.8 + Math.PI * 1.35);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x - radius * 0.55, y);
    ctx.lineTo(x + radius * 0.55, y);
    ctx.moveTo(x, y - radius * 0.55);
    ctx.lineTo(x, y + radius * 0.55);
    ctx.stroke();
    ctx.restore();
  }

  private drawPlayerHitbox(): void {
    if (!this.world) return;
    const ctx = this.context;
    const player = this.world.player;
    ctx.save();
    ctx.shadowColor = '#f1f4f3';
    ctx.shadowBlur = 8;
    ctx.strokeStyle = 'rgba(241, 244, 243, 0.9)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(player.x, player.y, 4, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(player.x - 8, player.y);
    ctx.lineTo(player.x - 5, player.y);
    ctx.moveTo(player.x + 5, player.y);
    ctx.lineTo(player.x + 8, player.y);
    ctx.moveTo(player.x, player.y - 8);
    ctx.lineTo(player.x, player.y - 5);
    ctx.moveTo(player.x, player.y + 5);
    ctx.lineTo(player.x, player.y + 8);
    ctx.stroke();
    ctx.restore();
  }

  private drawAtlasSprite(
    asset: 'player' | 'boss' | 'projectile' | 'arena',
    centerX: number,
    centerY: number,
    width: number,
    height: number
  ): void {
    if (!this.assetAtlas || !this.assetAtlasReady || this.assetTileSize <= 0) return;
    const positions = {
      player: [0, 0],
      boss: [1, 0],
      projectile: [0, 1],
      arena: [1, 1]
    } satisfies Record<typeof asset, [number, number]>;
    const [column, row] = positions[asset];
    const ctx = this.context;
    ctx.drawImage(
      this.assetAtlas,
      column * this.assetTileSize,
      row * this.assetTileSize,
      this.assetTileSize,
      this.assetTileSize,
      centerX - width / 2,
      centerY - height / 2,
      width,
      height
    );
  }

  private drawAtlasSpriteAnimated(
    asset: 'player' | 'boss' | 'projectile' | 'arena',
    centerX: number,
    centerY: number,
    width: number,
    height: number,
    rotation: number,
    scaleX: number,
    scaleY: number
  ): void {
    const ctx = this.context;
    ctx.save();
    ctx.translate(centerX, centerY);
    ctx.rotate(rotation);
    ctx.scale(scaleX, scaleY);
    this.drawAtlasSprite(asset, 0, 0, width, height);
    ctx.restore();
  }

  private drawPlayerTextureThruster(x: number, y: number, time: number, color: string): void {
    const ctx = this.context;
    const flicker = 0.65 + Math.sin(time * 18) * 0.2 + this.getBeatPulse() * 0.25;
    ctx.save();
    ctx.globalAlpha = clamp(flicker, 0.25, 1);
    ctx.shadowColor = color;
    ctx.shadowBlur = 12;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x - 5, y + 23);
    ctx.lineTo(x + 5, y + 23);
    ctx.lineTo(x, y + 42 + Math.sin(time * 22) * 4);
    ctx.fill();
    ctx.restore();
  }

  private drawAttackArc(): void {
    if (!this.world) return;
    const ctx = this.context;
    const player = this.world.player;
    const pulse = this.getBeatPulse();
    const active = player.attackTime > 0;
    const bossInRange = this.isBossInsideAttackCone();
    const fillAlpha = active ? 0.16 + pulse * 0.08 : bossInRange ? 0.08 : 0.035;
    const strokeAlpha = active ? 0.9 : bossInRange ? 0.48 : 0.2;
    const radius = ATTACK_ARC_RADIUS + (active ? pulse * 10 : 0);
    this.drawLightCircle(player.x, player.y, radius + 6, '#d6b45f', fillAlpha * 0.45);
    ctx.fillStyle = `rgba(214, 180, 95, ${fillAlpha})`;
    ctx.beginPath();
    ctx.moveTo(player.x, player.y);
    const aim = player.attackTime > 0 ? player.attackAim : player.facing;
    ctx.arc(player.x, player.y, radius, aim - ATTACK_ARC_HALF_ANGLE, aim + ATTACK_ARC_HALF_ANGLE);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = `rgba(255, 241, 168, ${strokeAlpha})`;
    ctx.shadowColor = '#d6b45f';
    ctx.shadowBlur = active ? 16 : 8;
    ctx.lineWidth = active ? 4 + pulse * 2 : bossInRange ? 2.8 : 1.4;
    ctx.beginPath();
    ctx.arc(player.x, player.y, radius, aim - ATTACK_ARC_HALF_ANGLE, aim + ATTACK_ARC_HALF_ANGLE);
    ctx.stroke();
    ctx.shadowBlur = 0;
    if (bossInRange) {
      this.drawLightCircle(this.world.boss.x, this.world.boss.y, this.world.boss.radius * 1.22, '#d6b45f', active ? 0.16 : 0.08);
    }
  }

  private updateBeatPulse(time: number, dt: number): void {
    if (!this.world) return;
    this.beatPulseTimer = Math.max(0, this.beatPulseTimer - dt);
    const beatInterval = this.world.rhythm.getBeatInterval();
    if (this.world.rhythm.isOnBeat(time) && time - this.lastBeatPulseAt >= beatInterval * 0.65) {
      this.lastBeatPulseAt = time;
      this.beatPulseTimer = 0.2;
    }
  }

  private getBeatPulse(): number {
    return clamp(this.beatPulseTimer / 0.2, 0, 1);
  }

  private updateParticles(dt: number): void {
    for (const particle of this.particles) {
      particle.life -= dt;
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
      particle.vx *= 0.94;
      particle.vy *= 0.94;
      if (particle.kind === 'ring') {
        particle.radius += 160 * dt;
      }
    }
    this.particles = this.particles.filter((particle) => particle.life > 0).slice(-120);
  }

  private updateSequences(dt: number): void {
    for (const sequence of this.sequences) {
      sequence.life -= dt;
      if (sequence.kind === 'dash') {
        sequence.size *= 0.985;
      }
    }
    this.sequences = this.sequences.filter((sequence) => sequence.life > 0).slice(-32);
  }

  private drawParticles(): void {
    const ctx = this.context;
    for (const particle of this.particles) {
      const progress = 1 - particle.life / particle.maxLife;
      const alpha = clamp(particle.life / particle.maxLife, 0, 1);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.shadowColor = particle.color;
      ctx.shadowBlur = particle.kind === 'ring' ? 18 : 10;
      if (particle.kind === 'ring') {
        ctx.strokeStyle = particle.color;
        ctx.lineWidth = 3 * alpha;
        ctx.beginPath();
        ctx.arc(particle.x, particle.y, particle.radius, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        ctx.fillStyle = particle.color;
        ctx.beginPath();
        ctx.arc(particle.x, particle.y, particle.radius * (1 + progress * 0.6), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  private drawSequences(): void {
    for (const sequence of this.sequences) {
      const progress = clamp(1 - sequence.life / sequence.maxLife, 0, 1);
      const frame = Math.min(sequence.frameCount - 1, Math.floor(progress * sequence.frameCount));
      const alpha = clamp(sequence.life / sequence.maxLife, 0, 1);
      if (this.feedbackAtlasReady && sequence.kind !== 'dash' && sequence.kind !== 'charge') {
        this.drawGeneratedFeedbackFrame(sequence, frame, alpha, progress);
      } else if (this.vfxAtlasReady && sequence.kind !== 'dash' && sequence.kind !== 'charge') {
        this.drawAtlasVfxFrame(sequence, frame, alpha);
      } else {
        this.drawProceduralSequenceFrame(sequence, frame, alpha, progress);
      }
    }
  }

  private drawAtlasVfxFrame(sequence: VisualSequence, frame: number, alpha: number): void {
    if (!this.vfxAtlas || this.vfxFrameSize <= 0) return;
    const ctx = this.context;
    const rowByKind = {
      impact: 0,
      guard: 1,
      graze: 2,
      burst: 3
    } satisfies Record<Exclude<VisualSequence['kind'], 'dash' | 'charge'>, number>;
    const row = rowByKind[sequence.kind as Exclude<VisualSequence['kind'], 'dash' | 'charge'>] ?? 0;
    const sourceX = Math.min(3, frame) * this.vfxFrameSize;
    const sourceY = row * this.vfxFrameSize;
    const frameScale = sequence.kind === 'burst' ? 1.35 : 1;
    const size = sequence.size * frameScale * (0.76 + frame * 0.14);

    ctx.save();
    ctx.translate(sequence.x, sequence.y);
    ctx.rotate(sequence.rotation + frame * 0.16);
    ctx.globalAlpha = alpha;
    ctx.shadowColor = sequence.color;
    ctx.shadowBlur = 12 + frame * 2;
    ctx.drawImage(
      this.vfxAtlas,
      sourceX,
      sourceY,
      this.vfxFrameSize,
      this.vfxFrameSize,
      -size / 2,
      -size / 2,
      size,
      size
    );
    ctx.restore();
  }

  private drawGeneratedFeedbackFrame(
    sequence: VisualSequence,
    frame: number,
    alpha: number,
    progress: number
  ): void {
    if (!this.feedbackAtlas || this.feedbackFrameWidth <= 0 || this.feedbackFrameHeight <= 0) return;
    const ctx = this.context;
    const rowByKind = {
      guard: 0,
      impact: 1,
      graze: 1,
      burst: 1
    } satisfies Record<Exclude<VisualSequence['kind'], 'dash' | 'charge'>, number>;
    const row = rowByKind[sequence.kind as Exclude<VisualSequence['kind'], 'dash' | 'charge'>] ?? 0;
    const sourceX = Math.min(GENERATED_VFX_SEQUENCE_FRAMES - 1, frame) * this.feedbackFrameWidth;
    const sourceY = row * this.feedbackFrameHeight;
    const frameScale = sequence.kind === 'charge' || sequence.kind === 'dash'
      ? 1.16 + progress * 0.22
      : sequence.kind === 'burst'
        ? 1.28 + progress * 0.3
        : 0.82 + progress * 0.55;
    const size = sequence.size * frameScale;

    ctx.save();
    ctx.translate(sequence.x, sequence.y);
    ctx.rotate(sequence.rotation + (sequence.kind === 'guard' ? 0 : frame * 0.08));
    ctx.globalAlpha = alpha;
    ctx.shadowColor = sequence.color;
    ctx.shadowBlur = 16 + frame * 2;
    ctx.drawImage(
      this.feedbackAtlas,
      sourceX,
      sourceY,
      this.feedbackFrameWidth,
      this.feedbackFrameHeight,
      -size / 2,
      -size / 2,
      size,
      size
    );
    ctx.restore();
  }

  private drawProceduralSequenceFrame(sequence: VisualSequence, frame: number, alpha: number, progress: number): void {
    const ctx = this.context;
    const size = sequence.size * (0.65 + progress * 0.95);
    ctx.save();
    ctx.translate(sequence.x, sequence.y);
    ctx.rotate(sequence.rotation + frame * 0.24);
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = sequence.color;
    ctx.fillStyle = sequence.color;
    ctx.shadowColor = sequence.color;
    ctx.shadowBlur = 14;
    ctx.lineWidth = 2;
    if (sequence.kind === 'dash') {
      ctx.globalAlpha *= 0.55;
      ctx.fillRect(-size * 0.58, -size * 0.08, size * 1.16, size * 0.16);
    } else {
      ctx.beginPath();
      ctx.arc(0, 0, size * 0.42, 0, Math.PI * 2);
      ctx.stroke();
      for (let index = 0; index < 4; index += 1) {
        const angle = index * Math.PI * 0.5 + frame * 0.22;
        ctx.beginPath();
        ctx.moveTo(Math.cos(angle) * size * 0.2, Math.sin(angle) * size * 0.2);
        ctx.lineTo(Math.cos(angle) * size * 0.56, Math.sin(angle) * size * 0.56);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  private drawRhythmGuide(time: number): void {
    if (!this.world) return;
    const ctx = this.context;
    const player = this.world.player;
    const beatInterval = this.world.rhythm.getBeatInterval();
    const timeToBeat = this.world.rhythm.timeToNextBeat(time);
    const progress = 1 - clamp(timeToBeat / beatInterval, 0, 1);
    const radius = player.radius * 3.2;
    const arcStart = -Math.PI / 2;
    const arcEnd = arcStart + Math.PI * 2 * progress;
    const pulse = this.getBeatPulse();

    ctx.save();
    ctx.strokeStyle = 'rgba(86, 96, 108, 0.72)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(player.x, player.y, radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = pulse > 0 ? '#d6b45f' : '#70d8d1';
    ctx.shadowColor = ctx.strokeStyle;
    ctx.shadowBlur = 8 + pulse * 16;
    ctx.lineWidth = 3 + pulse * 2;
    ctx.beginPath();
    ctx.arc(player.x, player.y, radius, arcStart, arcEnd);
    ctx.stroke();
    for (let index = 0; index < 4; index += 1) {
      const angle = arcStart + index * Math.PI * 0.5;
      const inner = radius - 5;
      const outer = radius + 5;
      ctx.beginPath();
      ctx.moveTo(player.x + Math.cos(angle) * inner, player.y + Math.sin(angle) * inner);
      ctx.lineTo(player.x + Math.cos(angle) * outer, player.y + Math.sin(angle) * outer);
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawLightCircle(x: number, y: number, radius: number, color: string, alpha: number): void {
    const ctx = this.context;
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, color);
    gradient.addColorStop(0.54, color);
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.shadowColor = color;
    ctx.shadowBlur = radius * 0.4;
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  private spawnBurst(x: number, y: number, color: string, count: number, speed: number): void {
    for (let index = 0; index < count; index += 1) {
      const angle = (Math.PI * 2 * index) / count + Math.random() * 0.45;
      const velocity = speed * (0.55 + Math.random() * 0.75);
      const life = 0.28 + Math.random() * 0.28;
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * velocity,
        vy: Math.sin(angle) * velocity,
        life,
        maxLife: life,
        radius: 2 + Math.random() * 3,
        color,
        kind: 'spark'
      });
    }
  }

  private spawnRing(x: number, y: number, color: string, radius: number): void {
    this.particles.push({
      x,
      y,
      vx: 0,
      vy: 0,
      life: 0.42,
      maxLife: 0.42,
      radius,
      color,
      kind: 'ring'
    });
  }

  private spawnDashTrail(fromX: number, fromY: number, toX: number, toY: number, enhanced: boolean): void {
    const distance = Math.hypot(toX - fromX, toY - fromY);
    if (distance < 8) return;
    const steps = Math.max(3, Math.min(10, Math.round(distance / 22)));
    const rotation = Math.atan2(toY - fromY, toX - fromX);
    const trailColor = enhanced ? '#d6b45f' : '#70d8d1';
    const ringColor = enhanced ? '#fff1a8' : '#8bf2cf';
    for (let index = 0; index <= steps; index += 1) {
      const ratio = index / steps;
      const life = 0.18 + ratio * 0.08;
      const x = fromX + (toX - fromX) * ratio;
      const y = fromY + (toY - fromY) * ratio;
      this.particles.push({
        x,
        y,
        vx: 0,
        vy: 0,
        life,
        maxLife: life,
        radius: 5 + ratio * 3 + (enhanced ? 1.5 : 0),
        color: trailColor,
        kind: 'spark'
      });
      if (index % 2 === 0) {
        this.spawnSequence(x, y, 'dash', trailColor, 28 + ratio * 18 + (enhanced ? 8 : 0), rotation, enhanced ? 0.28 : 0.22);
      }
    }
    this.spawnRing(toX, toY, ringColor, enhanced ? 24 : 18);
  }

  private spawnSequence(
    x: number,
    y: number,
    kind: VisualSequence['kind'],
    color: string,
    size: number,
    rotation = Math.random() * Math.PI * 2,
    life = 0.42
  ): void {
    const frameCount = GENERATED_VFX_SEQUENCE_FRAMES;
    this.sequences.push({
      x,
      y,
      life,
      maxLife: life,
      frameCount,
      frameRate: frameCount / life,
      size,
      rotation,
      color,
      kind
    });
  }

  private clampProjectileTrailEnd(
    projectile: NonNullable<WorldState['projectiles'][number]>,
    kind: NonNullable<WorldState['projectiles'][number]['kind']>,
    trailX: number,
    trailY: number
  ): { x: number; y: number } {
    if (!this.world) return { x: trailX, y: trailY };
    const minDistance = this.world.boss.radius + this.resolveProjectileVisualBackRadius(kind, projectile.radius) + 2;
    if (Math.hypot(trailX - this.world.boss.x, trailY - this.world.boss.y) >= minDistance) {
      return { x: trailX, y: trailY };
    }

    const dx = projectile.x - this.world.boss.x;
    const dy = projectile.y - this.world.boss.y;
    const outwardLength = Math.hypot(dx, dy) || 1;
    return {
      x: this.world.boss.x + (dx / outwardLength) * minDistance,
      y: this.world.boss.y + (dy / outwardLength) * minDistance
    };
  }

  private resolveProjectileRenderOrigin(
    projectile: NonNullable<WorldState['projectiles'][number]>,
    kind: NonNullable<WorldState['projectiles'][number]['kind']>
  ): { x: number; y: number } {
    if (!this.world) {
      return { x: projectile.x, y: projectile.y };
    }

    const dx = projectile.x - this.world.boss.x;
    const dy = projectile.y - this.world.boss.y;
    const distance = Math.hypot(dx, dy);
    const minDistance = this.world.boss.radius + this.resolveProjectileVisualBackRadius(kind, projectile.radius) + 2;
    if (distance >= minDistance) {
      return { x: projectile.x, y: projectile.y };
    }

    const outwardLength = distance || 1;
    return {
      x: this.world.boss.x + (dx / outwardLength) * minDistance,
      y: this.world.boss.y + (dy / outwardLength) * minDistance
    };
  }

  private resolveProjectileVisualBackRadius(
    kind: NonNullable<WorldState['projectiles'][number]['kind']>,
    radius: number
  ): number {
    if (kind === 'explosion') {
      return Math.max(radius * 3.2, radius * 5.3 * 0.5);
    }
    if (kind === 'laser') {
      return radius * 8.2 * 0.5;
    }
    if (kind === 'melee') {
      return radius * 6.6 * 0.5;
    }
    return radius * 5.6 * 0.5;
  }

  private resolveLaserFeedbackOrigin(): { x: number; y: number } {
    if (!this.world) return { x: 0, y: 0 };
    const laserHazard = [...this.world.hazards].reverse().find((hazard) => hazard.kind === 'laser');
    if (laserHazard) {
      return { x: laserHazard.x, y: laserHazard.y };
    }

    const angle = Math.atan2(this.world.player.y - this.world.boss.y, this.world.player.x - this.world.boss.x);
    return projectPoint(this.world.boss.x, this.world.boss.y, angle, this.world.boss.radius + 20);
  }

  private resolveProjectileFeedbackOrigin(): { x: number; y: number; angle: number } {
    if (!this.world) return { x: 0, y: 0, angle: 0 };
    const nearestProjectile = this.world.projectiles
      .slice()
      .sort((left, right) => (
        Math.hypot(left.x - this.world!.boss.x, left.y - this.world!.boss.y)
        - Math.hypot(right.x - this.world!.boss.x, right.y - this.world!.boss.y)
      ))[0];

    if (nearestProjectile) {
      const kind = nearestProjectile.kind ?? 'bullet';
      const renderOrigin = this.resolveProjectileRenderOrigin(nearestProjectile, kind);
      return {
        x: renderOrigin.x,
        y: renderOrigin.y,
        angle: Math.atan2(nearestProjectile.vy, nearestProjectile.vx)
      };
    }

    const angle = Math.atan2(this.world.player.y - this.world.boss.y, this.world.player.x - this.world.boss.x);
    const origin = projectPoint(this.world.boss.x, this.world.boss.y, angle, this.world.boss.radius + 18);
    return { ...origin, angle };
  }

  private drawHud(time: number, energy: number): void {
    if (!this.world) return;
    const stats = this.world.rhythm.getStats();
    const moduleLabel = localizeSegmentLabel(this.world.activeBehavior?.label ?? 'sync');
    const attackLabel = localizeAttackLabel(this.world.activeBehavior?.attack ?? 'none');
    if (this.world.arena.minX < 96) {
      this.drawCompactHud(energy, stats.combo, stats.accuracy, moduleLabel, attackLabel);
      return;
    }
    const gutter = 16;
    const hudWidth = Math.min(156, Math.max(128, this.world.arena.minX - gutter * 2));
    const leftX = Math.max(gutter, this.world.arena.minX - hudWidth - gutter);
    const rightX = Math.min(this.canvas.width - hudWidth - gutter, this.world.arena.maxX + gutter);
    const hp = Math.max(0, Math.round(this.world.player.hp));
    const hpRatio = clamp(hp / this.world.player.maxHp, 0, 1);

    this.drawHudPanel(leftX, 24, hudWidth, 64, '生命', `${hp}/${this.world.player.maxHp}`, '#70d8d1');
    this.drawHudMeter(leftX + 14, 76, hudWidth - 28, 5, hpRatio, hpRatio < 0.35 ? '#d96868' : '#70d8d1');

    this.drawPanelShell(leftX, 100, hudWidth, 84, '#d6b45f', 0.08);
    this.drawHudText(leftX + 14, 124, '战斗', '#8b949d', 10, 800, 0.16);
    this.drawHudText(leftX + 14, 148, `伤害 ${Math.round(this.world.damageDealt)}`, '#f1f4f3', 14, 800);
    this.drawHudText(leftX + 14, 168, `分数 ${this.world.score}`, '#f1f4f3', 14, 800);
    this.drawHudText(leftX + 14, 180, `${stats.combo}连 / ${stats.accuracy}%`, '#70d8d1', 11, 800);

    this.drawHudPanel(rightX, 24, hudWidth, 64, '段落', moduleLabel, '#70d8d1');
    this.drawHudPanel(rightX, 100, hudWidth, 64, '招式', attackLabel, '#ff8b8b');
    this.drawHudPanel(rightX, 176, hudWidth, 64, '时间', `${time.toFixed(1)} / ${this.duration.toFixed(1)}`, '#d6b45f');
    this.drawHudMeter(rightX + 14, 228, hudWidth - 28, 5, energy, '#d6b45f');
  }

  private drawCompactHud(
    energy: number,
    combo: number,
    accuracy: number,
    moduleLabel: string,
    attackLabel: string
  ): void {
    if (!this.world) return;
    const x = 16;
    const y = 16;
    const width = this.canvas.width - 32;
    const hp = Math.max(0, Math.round(this.world.player.hp));
    const hpRatio = clamp(hp / this.world.player.maxHp, 0, 1);
    this.drawPanelShell(x, y, width, 66, '#70d8d1', 0.1);

    const columnWidth = width / 4;
    this.drawHudText(x + 12, y + 21, '生命', '#8b949d', 9, 800, 0.14);
    this.drawHudText(x + 12, y + 42, `${hp}/${this.world.player.maxHp}`, '#f1f4f3', 13, 800);
    this.drawHudMeter(x + 12, y + 52, columnWidth - 24, 4, hpRatio, hpRatio < 0.35 ? '#d96868' : '#70d8d1');

    this.drawHudText(x + columnWidth + 8, y + 21, '战斗', '#8b949d', 9, 800, 0.12);
    this.drawHudText(x + columnWidth + 8, y + 42, `${combo}连/${accuracy}%`, '#f1f4f3', 13, 800);

    this.drawHudText(x + columnWidth * 2 + 8, y + 21, '段落', '#8b949d', 9, 800, 0.14);
    this.drawHudText(x + columnWidth * 2 + 8, y + 42, moduleLabel, '#f1f4f3', 13, 800);

    this.drawHudText(x + columnWidth * 3 + 8, y + 21, '招式', '#8b949d', 9, 800, 0.14);
    this.drawHudText(x + columnWidth * 3 + 8, y + 42, attackLabel, '#f1f4f3', 13, 800);
    this.drawHudMeter(x + columnWidth * 3 + 8, y + 52, columnWidth - 20, 4, energy, '#d6b45f');
  }

  private drawFeedbackBanner(): void {
    if (this.feedbackTimer <= 0 || !this.feedbackText) return;
    const ctx = this.context;
    const color = this.feedbackTone === 'success'
      ? '#8bf2cf'
      : this.feedbackTone === 'danger'
        ? '#ff8b8b'
        : '#f4d35e';
    const width = Math.min(420, this.canvas.width - 48);
    const height = 48;
    const x = (this.canvas.width - width) / 2;
    const y = this.canvas.height - height - 24;
    this.drawPanelShell(x, y, width, height, color, 0.14);
    ctx.fillStyle = color;
    ctx.font = '800 18px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(this.feedbackText, x + width / 2, y + height / 2 + 1);
    ctx.textAlign = 'start';
    ctx.textBaseline = 'alphabetic';
  }

  private finishRun(result: GameResult, stopSource = false): void {
    if (!this.world) return;
    this.running = false;
    cancelAnimationFrame(this.animationId);
    const resultText = this.createResultText(result);
    const activeSource = this.source;
    this.source = null;
    if (activeSource) {
      activeSource.onended = null;
      if (stopSource) {
        try {
          activeSource.stop();
        } catch {
          // ignore invalid stop calls while ending the run
        }
      }
    }
    const context = this.audioContext;
    this.audioContext = null;
    this.soundEffects.disconnect();
    void context?.close();
    this.callbacks.onResult(resultText);
  }

  private drawHudPanel(
    x: number,
    y: number,
    width: number,
    height: number,
    label: string,
    value: string,
    accent: string
  ): void {
    this.drawPanelShell(x, y, width, height, accent, 0.1);
    this.drawHudText(x + 14, y + 22, label, '#8b949d', 10, 800, 0.16);
    this.drawHudText(x + 14, y + 43, value, '#f1f4f3', 15, 800);
  }

  private drawPanelShell(
    x: number,
    y: number,
    width: number,
    height: number,
    accent: string,
    alpha: number
  ): void {
    const ctx = this.context;
    ctx.save();
    ctx.fillStyle = 'rgba(8, 10, 12, 0.74)';
    ctx.fillRect(x, y, width, height);
    ctx.strokeStyle = 'rgba(86, 96, 108, 0.72)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y, width, height);
    ctx.fillStyle = accent;
    ctx.globalAlpha = alpha;
    ctx.fillRect(x, y, width, height);
    ctx.globalAlpha = 1;
    ctx.fillStyle = accent;
    ctx.fillRect(x, y, 46, 2);
    ctx.fillRect(x + width - 46, y + height - 2, 46, 2);
    ctx.restore();
  }

  private drawHudMeter(x: number, y: number, width: number, height: number, ratio: number, color: string): void {
    const ctx = this.context;
    ctx.fillStyle = 'rgba(86, 96, 108, 0.64)';
    ctx.fillRect(x, y, width, height);
    ctx.fillStyle = color;
    ctx.fillRect(x, y, width * clamp(ratio, 0, 1), height);
  }

  private drawHudText(
    x: number,
    y: number,
    text: string,
    color: string,
    size: number,
    weight: number,
    letterSpacing = 0
  ): void {
    const ctx = this.context;
    ctx.fillStyle = color;
    ctx.font = `${weight} ${size}px system-ui, sans-serif`;
    ctx.letterSpacing = `${letterSpacing}em`;
    ctx.fillText(text, x, y);
    ctx.letterSpacing = '0px';
  }

  private consumeWorldEvents(dt: number): void {
    if (!this.world) return;
    this.feedbackTimer = Math.max(0, this.feedbackTimer - dt);
    this.playerFlashTimer = Math.max(0, this.playerFlashTimer - dt);
    this.bossFlashTimer = Math.max(0, this.bossFlashTimer - dt);
    this.screenShakeTimer = Math.max(0, this.screenShakeTimer - dt);

    const hasAttackBeat = this.world.events.some((event) => event.type === 'player-attack-beat');
    const hasDashBeat = this.world.events.some((event) => event.type === 'player-dash-beat');
    const hasBlockBeat = this.world.events.some((event) => event.type === 'player-block-beat' || event.type === 'perfect-defense');

    for (const event of this.world.events) {
      if (event.type === 'attack-hit') {
        this.spawnBurst(this.world.boss.x, this.world.boss.y, '#d6b45f', 14, 180);
        this.spawnRing(this.world.boss.x, this.world.boss.y, '#fff1a8', this.world.boss.radius * 1.5);
        this.spawnSequence(this.world.boss.x, this.world.boss.y, 'impact', '#d6b45f', 96, this.world.player.facing, 0.5);
      } else if (event.type === 'boss-break') {
        this.spawnBurst(this.world.boss.x, this.world.boss.y, '#fff1a8', 26, 240);
        this.spawnRing(this.world.boss.x, this.world.boss.y, '#d6b45f', this.world.boss.radius * 2.8);
        this.spawnSequence(this.world.boss.x, this.world.boss.y, 'burst', '#fff1a8', 144, 0, 0.8);
      } else if (event.type === 'boss-charged') {
        this.spawnBurst(this.world.boss.x, this.world.boss.y, '#ff8b8b', 12, 180);
        this.spawnSequence(this.world.boss.x, this.world.boss.y, 'charge', '#ff8b8b', 128, Math.random() * Math.PI, 0.42);
      } else if (event.type === 'boss-laser') {
        const angle = Math.atan2(this.world.player.y - this.world.boss.y, this.world.player.x - this.world.boss.x);
        const origin = this.resolveLaserFeedbackOrigin();
        this.spawnBurst(origin.x, origin.y, '#8bf2cf', 10, 190);
        this.spawnSequence(origin.x, origin.y, 'burst', '#8bf2cf', 142, angle, 0.48);
      } else if (event.type === 'boss-sweep') {
        this.spawnBurst(this.world.boss.x, this.world.boss.y, '#ff8b8b', 14, 170);
        this.spawnRing(this.world.boss.x, this.world.boss.y, '#ff8b8b', this.world.boss.radius * 2.2);
        this.spawnSequence(this.world.boss.x, this.world.boss.y, 'impact', '#ff8b8b', 112, Math.random() * Math.PI, 0.46);
      } else if (event.type === 'projectiles-fired') {
        const origin = this.resolveProjectileFeedbackOrigin();
        this.spawnBurst(origin.x, origin.y, '#ff6b6b', 8, 120);
        this.spawnSequence(origin.x, origin.y, 'burst', '#ff8b8b', 82, origin.angle, 0.36);
      } else if (event.type === 'near-graze') {
        this.spawnBurst(this.world.player.x, this.world.player.y, '#70d8d1', 5, 110);
        this.spawnRing(this.world.player.x, this.world.player.y, '#8bf2cf', this.world.player.radius * 1.9);
        this.spawnSequence(this.world.player.x, this.world.player.y, 'graze', '#8bf2cf', 64, this.world.player.facing, 0.34);
      } else if (event.type === 'player-hit') {
        this.spawnBurst(this.world.player.x, this.world.player.y, '#ff8b8b', 16, 210);
        this.spawnRing(this.world.player.x, this.world.player.y, '#ff8b8b', this.world.player.radius * 1.4);
        this.spawnSequence(this.world.player.x, this.world.player.y, 'impact', '#ff8b8b', 88, Math.random() * Math.PI, 0.45);
      } else if (event.type === 'player-blocked-hit') {
        this.spawnBurst(this.world.player.x, this.world.player.y, '#8bf2cf', 10, 150);
        this.spawnRing(this.world.player.x, this.world.player.y, '#70d8d1', this.world.player.radius * 2.2);
        this.spawnSequence(this.world.player.x, this.world.player.y, 'guard', '#70d8d1', 78, this.world.player.facing, 0.42);
      } else if (event.type === 'perfect-defense') {
        this.spawnBurst(this.world.player.x, this.world.player.y, '#d6b45f', 12, 170);
        this.spawnRing(this.world.player.x, this.world.player.y, '#8bf2cf', this.world.player.radius * 2.6);
        this.spawnSequence(this.world.player.x, this.world.player.y, 'guard', '#d6b45f', 96, this.world.player.facing, 0.5);
      } else if (event.type === 'dash-cleared-projectiles') {
        this.spawnBurst(this.world.player.x, this.world.player.y, '#fff1a8', 14, 180);
        this.spawnRing(this.world.player.x, this.world.player.y, '#d6b45f', this.world.player.radius * 3.2);
        this.spawnSequence(this.world.player.x, this.world.player.y, 'guard', '#fff1a8', 108, this.world.player.facing, 0.48);
      } else if (event.type === 'player-attack-beat') {
        const sparkX = this.world.player.x + Math.cos(this.world.player.facing) * (this.world.player.radius + 28);
        const sparkY = this.world.player.y + Math.sin(this.world.player.facing) * (this.world.player.radius + 28);
        this.spawnBurst(sparkX, sparkY, '#fff1a8', 8, 135);
        this.spawnRing(this.world.player.x, this.world.player.y, '#d6b45f', this.world.player.radius * 1.65);
        this.spawnSequence(sparkX, sparkY, 'impact', '#d6b45f', 58, this.world.player.facing, 0.24);
      } else if (event.type === 'player-attack' && !hasAttackBeat) {
        const sparkX = this.world.player.x + Math.cos(this.world.player.facing) * (this.world.player.radius + 20);
        const sparkY = this.world.player.y + Math.sin(this.world.player.facing) * (this.world.player.radius + 20);
        this.spawnBurst(sparkX, sparkY, '#d6b45f', 4, 92);
      } else if (event.type === 'player-dash-beat') {
        this.spawnRing(this.world.player.x, this.world.player.y, '#fff1a8', this.world.player.radius * 2.1);
        this.spawnSequence(this.world.player.x, this.world.player.y, 'dash', '#fff1a8', 64, this.world.player.facing, 0.24);
      } else if (event.type === 'player-dash' && !hasDashBeat) {
        this.spawnRing(this.world.player.x, this.world.player.y, '#70d8d1', this.world.player.radius * 1.45);
      } else if (event.type === 'player-block-beat') {
        this.spawnRing(this.world.player.x, this.world.player.y, '#8bf2cf', this.world.player.radius * 2.2);
        this.spawnSequence(this.world.player.x, this.world.player.y, 'guard', '#8bf2cf', 72, this.world.player.facing, 0.28);
      } else if (event.type === 'player-block' && !hasBlockBeat) {
        this.spawnRing(this.world.player.x, this.world.player.y, '#70d8d1', this.world.player.radius * 1.75);
      } else if (event.type === 'attack-blocked-by-cooldown' || event.type === 'dash-blocked-by-cooldown') {
        this.spawnBurst(this.world.player.x, this.world.player.y, '#ff8b8b', 5, 78);
        this.spawnRing(this.world.player.x, this.world.player.y, '#ff8b8b', this.world.player.radius * 1.35);
      } else if (event.type === 'victory') {
        this.spawnBurst(this.world.boss.x, this.world.boss.y, '#8bf2cf', 24, 220);
        this.spawnRing(this.world.boss.x, this.world.boss.y, '#d6b45f', this.world.boss.radius * 2.4);
        this.spawnSequence(this.world.boss.x, this.world.boss.y, 'burst', '#8bf2cf', 132, 0, 0.75);
      } else if (event.type === 'defeat') {
        this.spawnBurst(this.world.player.x, this.world.player.y, '#ff8b8b', 22, 190);
        this.spawnRing(this.world.player.x, this.world.player.y, '#ff8b8b', this.world.player.radius * 2.8);
        this.spawnSequence(this.world.player.x, this.world.player.y, 'burst', '#ff8b8b', 118, 0, 0.65);
      }
    }

    this.soundEffects.playEvents(
      this.world.events,
      this.world.activeBehavior?.attack ?? null,
      0.8 + (this.world.activeBehavior?.warningIntensity ?? 0.4) * 0.6
    );

    const feedback = pickCombatFeedback(this.world.events);
    if (!feedback) return;

    this.feedbackText = feedback.text;
    this.feedbackTone = feedback.tone;
    this.feedbackTimer = 0.7;
    if (feedback.playerFlash !== 'none') {
      this.playerFlashTone = feedback.playerFlash;
      this.playerFlashTimer = 0.18;
    }
    if (feedback.bossFlash !== 'none') {
      this.bossFlashTimer = 0.16;
    }
    if (feedback.screenShake > 0) {
      this.screenShakeTimer = 0.15;
      this.screenShakeStrength = feedback.screenShake;
    }
  }

  private readEnergy(): number {
    if (!this.analyser || !this.frequencyData) return 0;
    this.analyser.getByteFrequencyData(this.frequencyData);
    const sum = this.frequencyData.reduce((total, value) => total + value, 0);
    const lowBins = Math.max(1, Math.floor(this.frequencyData.length / 8));
    let lowSum = 0;
    for (let index = 0; index < lowBins; index += 1) {
      lowSum += this.frequencyData[index];
    }
    this.lowFrequencyEnergy = lowSum / (lowBins * 255);
    return sum / (this.frequencyData.length * 255);
  }

  private createResultText(result: string): string {
    if (!this.world) return result;
    const stats = this.world.rhythm.getStats();
    if (result === 'defeat') {
      return `同步失败 / 分数 ${this.world.score} / 伤害 ${Math.round(this.world.damageDealt)} / 最大连击 ${stats.maxCombo} / 准确率 ${stats.accuracy}%`;
    }
    return `同步完成 / 分数 ${this.world.score} / 伤害 ${Math.round(this.world.damageDealt)} / 最大连击 ${stats.maxCombo} / 准确率 ${stats.accuracy}%`;
  }

  private isBossInsideAttackCone(): boolean {
    if (!this.world) return false;
    const player = this.world.player;
    const boss = this.world.boss;
    const dx = boss.x - player.x;
    const dy = boss.y - player.y;
    const distance = Math.hypot(dx, dy);
    if (distance > ATTACK_ARC_RADIUS + 26) return false;
    const angle = Math.atan2(dy, dx);
    const aim = player.attackTime > 0 ? player.attackAim : player.facing;
    return Math.abs(normalizeAngle(angle - aim)) <= ATTACK_ARC_HALF_ANGLE + Math.PI / 20;
  }
}

function localizeSegmentLabel(label: string): string {
  const labels: Record<string, string> = {
    intro: '序章',
    verse: '主段',
    chorus: '高潮',
    bridge: '过渡',
    drop: '爆发',
    outro: '尾声',
    sync: '同步'
  };

  return labels[label.toLowerCase()] ?? label;
}

function localizeAttackLabel(attack: string): string {
  const labels: Record<string, string> = {
    none: '待机',
    'sparse-ring': '稀疏环',
    'aimed-burst': '瞄准弹',
    'screen-ring': '全屏环',
    'lane-burst': '轨道弹',
    'melee-sweep': '近身扫击',
    'laser-ray': '光束锁定',
    'explosive-burst': '爆裂弹',
    'charge-strike': '冲撞',
    'ground-slam': '地面震荡',
    'cone-cleave': '扇形斩',
    'laser-barrage': '光束连携',
    'charge-sweep': '冲锋扫击'
  };

  return labels[attack.toLowerCase()] ?? attack;
}

function createArena(width: number, height: number): WorldState['arena'] {
  const arenaSize = Math.max(280, Math.min(720, width - 32, height - 32));
  const centerX = width / 2;
  const centerY = height / 2;
  return {
    minX: centerX - arenaSize / 2,
    minY: centerY - arenaSize / 2,
    maxX: centerX + arenaSize / 2,
    maxY: centerY + arenaSize / 2
  };
}

function projectIntoArena(
  previousArena: WorldState['arena'],
  nextArena: WorldState['arena'],
  x: number,
  y: number
): { x: number; y: number } {
  const previousWidth = Math.max(1, previousArena.maxX - previousArena.minX);
  const previousHeight = Math.max(1, previousArena.maxY - previousArena.minY);
  const nextWidth = nextArena.maxX - nextArena.minX;
  const nextHeight = nextArena.maxY - nextArena.minY;
  const ratioX = (x - previousArena.minX) / previousWidth;
  const ratioY = (y - previousArena.minY) / previousHeight;

  return {
    x: clamp(nextArena.minX + ratioX * nextWidth, nextArena.minX, nextArena.maxX),
    y: clamp(nextArena.minY + ratioY * nextHeight, nextArena.minY, nextArena.maxY)
  };
}

function projectRayToArena(
  originX: number,
  originY: number,
  angle: number,
  arena: WorldState['arena']
): { x: number; y: number } {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  const candidates: number[] = [];
  if (Math.abs(dx) > 0.0001) {
    candidates.push((arena.minX - originX) / dx, (arena.maxX - originX) / dx);
  }
  if (Math.abs(dy) > 0.0001) {
    candidates.push((arena.minY - originY) / dy, (arena.maxY - originY) / dy);
  }
  const distance = candidates
    .filter((candidate) => candidate > 0)
    .sort((a, b) => a - b)
    .find((candidate) => {
      const x = originX + dx * candidate;
      const y = originY + dy * candidate;
      return x >= arena.minX - 1 && x <= arena.maxX + 1 && y >= arena.minY - 1 && y <= arena.maxY + 1;
    }) ?? 0;

  return {
    x: clamp(originX + dx * distance, arena.minX, arena.maxX),
    y: clamp(originY + dy * distance, arena.minY, arena.maxY)
  };
}

function projectPoint(originX: number, originY: number, angle: number, distance: number): { x: number; y: number } {
  return {
    x: originX + Math.cos(angle) * distance,
    y: originY + Math.sin(angle) * distance
  };
}

function normalizeAngle(angle: number): number {
  let value = angle;
  while (value > Math.PI) value -= Math.PI * 2;
  while (value < -Math.PI) value += Math.PI * 2;
  return value;
}

function createBattleBeatGrid(analysis: AudioAnalysis, bpm: number, firstBeat: number): number[] {
  if (analysis.calibration?.confirmed) {
    return createMetronomeBeatGrid(bpm, firstBeat, analysis.duration);
  }

  const detected = analysis.beats
    .map((beat) => beat.time)
    .filter((time) => Number.isFinite(time) && time >= 0 && time <= analysis.duration);
  if (detected.length >= 4) {
    return detected;
  }

  return createMetronomeBeatGrid(bpm, firstBeat, analysis.duration);
}

function createMetronomeBeatGrid(bpm: number, firstBeat: number, duration: number): number[] {
  const interval = 60 / Math.max(1, bpm);
  const beats: number[] = [];
  let time = firstBeat;
  while (time > 0) {
    time -= interval;
  }
  while (time < 0) {
    time += interval;
  }
  for (; time <= duration + 0.001; time += interval) {
    beats.push(Math.round(time * 1000) / 1000);
  }
  return beats;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
