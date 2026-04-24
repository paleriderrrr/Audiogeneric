import { createRuleBehaviorTimeline } from '../behavior/factory.js';
import { createInitialWorld, stepWorld, type CombatInput, type WorldState } from '../core/combat.js';
import { createRhythmTracker } from '../core/rhythm.js';
import type { AudioAnalysis } from '../audio/types.js';

export interface RuntimeCallbacks {
  onStatus(message: string): void;
  onResult(result: string): void;
}

export class GameRuntime {
  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;
  private readonly callbacks: RuntimeCallbacks;
  private world: WorldState | null = null;
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

  constructor(canvas: HTMLCanvasElement, callbacks: RuntimeCallbacks) {
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas 2D is not available.');
    this.canvas = canvas;
    this.context = context;
    this.callbacks = callbacks;
    this.installInput();
  }

  async start(analysis: AudioAnalysis, difficulty: number): Promise<void> {
    this.stop();
    this.resize();
    const runToken = ++this.runToken;
    const bpm = analysis.calibration?.selectedBpm ?? analysis.bpm;
    const firstBeat = analysis.calibration?.selectedDownbeat ?? analysis.firstBeat;
    const rhythm = createRhythmTracker({
      bpm,
      firstBeat,
      duration: analysis.duration
    });
    const behaviorTimeline = createRuleBehaviorTimeline({
      bpm,
      downbeat: firstBeat,
      beatGrid: analysis.beats.map((beat) => beat.time),
      segments: analysis.segments,
      confidence: {
        overall: 0.85,
        segmentation: 0.8,
        tempo: 0.9
      }
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
        this.callbacks.onResult(this.createResultText('victory'));
      }
    };

    this.running = true;
    this.lastFrame = performance.now();
    this.callbacks.onStatus(`BPM ${bpm} / ${analysis.segments.length} segments / difficulty ${difficulty.toFixed(1)}x`);
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
    void this.audioContext?.close();
    this.audioContext = null;
  }

  resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    const scale = window.devicePixelRatio || 1;
    this.canvas.width = Math.max(640, Math.floor(rect.width * scale));
    this.canvas.height = Math.max(420, Math.floor(rect.height * scale));
    this.syncWorldToCanvas();
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
    this.canvas.addEventListener('mousemove', (event) => {
      const rect = this.canvas.getBoundingClientRect();
      const scaleX = this.canvas.width / rect.width;
      const scaleY = this.canvas.height / rect.height;
      this.pointer.x = (event.clientX - rect.left) * scaleX;
      this.pointer.y = (event.clientY - rect.top) * scaleY;
    });
    this.canvas.addEventListener('mousedown', (event) => {
      if (event.button === 0) this.pendingAttack = true;
    });
    this.canvas.addEventListener('contextmenu', (event) => event.preventDefault());
  }

  private loop(frameTime: number): void {
    if (!this.running || !this.world || !this.audioContext) return;
    const dt = Math.min(0.033, (frameTime - this.lastFrame) / 1000);
    this.lastFrame = frameTime;
    const time = this.audioContext.currentTime - this.startTime;
    const input = this.readInput(time);

    stepWorld(this.world, dt, input);
    if (time >= this.duration && this.world.result === 'playing') {
      this.world.result = 'victory';
    }
    this.draw(time);

    if (this.world.result !== 'playing') {
      this.running = false;
      if (this.world.result === 'defeat') {
        this.source?.stop();
      }
      this.callbacks.onResult(this.createResultText(this.world.result));
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

  private draw(time: number): void {
    if (!this.world) return;
    const ctx = this.context;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.fillStyle = '#050505';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    const energy = this.readEnergy();
    this.drawArena(energy, time);
    this.drawProjectiles();
    this.drawCore(time);
    this.drawActor(this.world.player.x, this.world.player.y, this.world.player.radius, '#4fb3d8');
    this.drawAttackArc();
    this.drawHud(time, energy);
  }

  private drawArena(energy: number, time: number): void {
    if (!this.world) return;
    const { minX, minY, maxX, maxY } = this.world.arena;
    const ctx = this.context;
    ctx.strokeStyle = '#888';
    ctx.lineWidth = 2 + energy * 3;
    ctx.strokeRect(minX, minY, maxX - minX, maxY - minY);
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

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(time * (1.5 + warning * 3));
    ctx.fillStyle = warning > 0.7 ? '#ff2f2f' : '#d84f4f';
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
    if (warning > 0.65) {
      ctx.strokeStyle = `rgba(255, 80, 80, ${warning})`;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(0, 0, radius + 12, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawProjectiles(): void {
    if (!this.world) return;
    for (const projectile of this.world.projectiles) {
      this.drawActor(projectile.x, projectile.y, projectile.radius, '#eeeeee');
    }
  }

  private drawActor(x: number, y: number, radius: number, color: string): void {
    const ctx = this.context;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  private drawAttackArc(): void {
    if (!this.world || this.world.player.attackTime <= 0) return;
    const ctx = this.context;
    const player = this.world.player;
    ctx.strokeStyle = '#f4d35e';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(player.x, player.y, 70, player.facing - 0.65, player.facing + 0.65);
    ctx.stroke();
  }

  private drawHud(time: number, energy: number): void {
    if (!this.world) return;
    const ctx = this.context;
    const stats = this.world.rhythm.getStats();
    const moduleLabel = this.world.activeBehavior?.label ?? 'loading';
    ctx.fillStyle = '#f5f5f5';
    ctx.font = '16px system-ui, sans-serif';
    ctx.fillText(`HP ${Math.max(0, Math.round(this.world.player.hp))}/${this.world.player.maxHp}`, 24, 32);
    ctx.fillText(`Damage ${Math.round(this.world.damageDealt)}  Score ${this.world.score}`, 24, 56);
    ctx.fillText(`Combo ${stats.combo}  Accuracy ${stats.accuracy}%  Segment ${moduleLabel}`, 24, 80);
    ctx.fillText(`Time ${time.toFixed(1)} / ${this.duration.toFixed(1)}  Energy ${energy.toFixed(2)}`, 24, 104);
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
      return `SYNC FAILED / Score ${this.world.score} / Damage ${Math.round(this.world.damageDealt)} / Max Combo ${stats.maxCombo} / Accuracy ${stats.accuracy}%`;
    }
    return `SYNC COMPLETE / Score ${this.world.score} / Damage ${Math.round(this.world.damageDealt)} / Max Combo ${stats.maxCombo} / Accuracy ${stats.accuracy}%`;
  }
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

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
