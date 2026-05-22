import type { BossAttack } from '../core/behavior.js';
import type { WorldEvent } from '../core/combat.js';

const SOUND_URLS = {
  tap: new URL('../assets/sfx/tap.ogg', import.meta.url).href,
  beat: new URL('../assets/sfx/beat.ogg', import.meta.url).href,
  attackTap: new URL('../assets/sfx/attack-tap.ogg', import.meta.url).href,
  attackBeat: new URL('../assets/sfx/attack-beat.ogg', import.meta.url).href,
  dashTap: new URL('../assets/sfx/dash-tap.ogg', import.meta.url).href,
  dashBeat: new URL('../assets/sfx/dash-beat.ogg', import.meta.url).href,
  guardTap: new URL('../assets/sfx/guard-tap.ogg', import.meta.url).href,
  guardBeat: new URL('../assets/sfx/guard-beat.ogg', import.meta.url).href,
  hit: new URL('../assets/sfx/hit.ogg', import.meta.url).href,
  graze: new URL('../assets/sfx/graze.ogg', import.meta.url).href,
  blip: new URL('../assets/sfx/blip.ogg', import.meta.url).href,
  charge: new URL('../assets/sfx/charge.ogg', import.meta.url).href,
  explosion: new URL('../assets/sfx/explosion.ogg', import.meta.url).href,
  laser: new URL('../assets/sfx/laser.ogg', import.meta.url).href,
  message: new URL('../assets/sfx/message.ogg', import.meta.url).href
} satisfies Partial<Record<SoundCue, string>>;

const CUE_VOLUME = {
  tap: 0.11,
  beat: 0.17,
  moveTap: 0.055,
  moveBeat: 0.085,
  attackTap: 0.12,
  attackBeat: 0.18,
  dashTap: 0.1,
  dashBeat: 0.16,
  guardTap: 0.11,
  guardBeat: 0.17,
  hit: 0.15,
  graze: 0.1,
  blip: 0.09,
  charge: 0.08,
  explosion: 0.1,
  laser: 0.08,
  message: 0.1,
  deny: 0.075
} satisfies Record<SoundCue, number>;

const CUE_COOLDOWN = {
  tap: 0.025,
  beat: 0.045,
  moveTap: 0.13,
  moveBeat: 0.16,
  attackTap: 0.035,
  attackBeat: 0.045,
  dashTap: 0.04,
  dashBeat: 0.055,
  guardTap: 0.04,
  guardBeat: 0.055,
  hit: 0.06,
  graze: 0.035,
  blip: 0.05,
  charge: 0.14,
  explosion: 0.12,
  laser: 0.055,
  message: 0.12,
  deny: 0.08
} satisfies Record<SoundCue, number>;

export type SoundCue =
  | 'tap'
  | 'beat'
  | 'moveTap'
  | 'moveBeat'
  | 'attackTap'
  | 'attackBeat'
  | 'dashTap'
  | 'dashBeat'
  | 'guardTap'
  | 'guardBeat'
  | 'hit'
  | 'graze'
  | 'blip'
  | 'charge'
  | 'explosion'
  | 'laser'
  | 'message'
  | 'deny';

export function selectSoundCuesForEvents(events: WorldEvent[], activeAttack: BossAttack | null): SoundCue[] {
  const cues: SoundCue[] = [];
  const hasMoveBeat = hasEvent(events, 'player-move-beat');
  const hasAttackBeat = hasEvent(events, 'player-attack-beat');
  const hasBlockBeat = hasEvent(events, 'player-block-beat');
  const hasDashBeat = hasEvent(events, 'player-dash-beat');

  for (const event of events) {
    if (event.type === 'projectiles-fired') {
      cues.push(resolveProjectileCue(activeAttack));
    } else if (event.type === 'boss-laser') {
      cues.push('blip');
    } else if (event.type === 'boss-laser-blast') {
      cues.push('laser');
    } else if (event.type === 'boss-sweep') {
      cues.push('tap');
    } else if (event.type === 'boss-area-warning') {
      cues.push('charge');
    } else if (event.type === 'boss-area-blast') {
      cues.push('explosion');
    } else if (event.type === 'boss-charged') {
      cues.push('beat');
    } else if (event.type === 'boss-break') {
      cues.push('explosion');
    } else if (
      event.type === 'perfect-defense'
      || event.type === 'dash-cleared-projectiles'
    ) {
      cues.push('beat');
    } else if (event.type === 'player-attack-beat') {
      cues.push('attackBeat');
    } else if (event.type === 'player-move-beat') {
      cues.push('moveBeat');
    } else if (event.type === 'player-dash-beat') {
      cues.push('dashBeat');
    } else if (event.type === 'player-block-beat') {
      cues.push('guardBeat');
    } else if (event.type === 'attack-hit' && !hasAttackBeat) {
      cues.push('hit');
    } else if (event.type === 'player-move' && !hasMoveBeat) {
      cues.push('moveTap');
    } else if (event.type === 'player-attack' && !hasAttackBeat) {
      cues.push('attackTap');
    } else if (event.type === 'player-dash' && !hasDashBeat) {
      cues.push('dashTap');
    } else if (event.type === 'player-block' && !hasBlockBeat) {
      cues.push('guardTap');
    } else if (event.type === 'player-hit') {
      cues.push('hit');
    } else if (event.type === 'near-graze') {
      cues.push('graze');
    } else if (event.type === 'player-blocked-hit') {
      cues.push('guardTap');
    } else if (event.type === 'dash-blocked-by-cooldown') {
      cues.push('deny');
    } else if (event.type === 'attack-blocked-by-cooldown') {
      cues.push('deny');
    }
  }
  return dedupeAdjacent(cues);
}

export class SoundEffectPlayer {
  private context: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private buffers = new Map<SoundCue, AudioBuffer>();
  private loading: Promise<void> | null = null;
  private loadingSettled = false;
  private supported = false;
  private lastPlayedAt = new Map<SoundCue, number>();

  connect(context: AudioContext): void {
    this.disconnect();
    if (!supportsWebAudioPlayback(context)) {
      this.supported = false;
      return;
    }

    this.context = context;
    this.supported = true;
    this.loadingSettled = false;
    this.masterGain = context.createGain();
    this.masterGain.gain.value = 0.28;
    this.masterGain.connect(context.destination);
    this.loading = this.preload().finally(() => {
      this.loadingSettled = true;
    });
  }

  disconnect(): void {
    this.masterGain?.disconnect();
    this.masterGain = null;
    this.context = null;
    this.loading = null;
    this.loadingSettled = false;
    this.supported = false;
    this.lastPlayedAt.clear();
  }

  play(cue: SoundCue, intensity = 1): void {
    if (!this.supported || !this.context || !this.masterGain) return;
    const now = this.context.currentTime;
    if (now - (this.lastPlayedAt.get(cue) ?? -Infinity) < CUE_COOLDOWN[cue]) return;

    const buffer = this.buffers.get(cue);
    if (!buffer) {
      if (this.playProceduralCue(cue, intensity)) {
        this.lastPlayedAt.set(cue, now);
        return;
      }
      if (!this.loadingSettled) {
        void this.loading?.then(() => this.play(cue, intensity));
      }
      return;
    }

    const source = this.context.createBufferSource();
    const gain = this.context.createGain();
    source.buffer = buffer;
    source.playbackRate.value = isRhythmInputCue(cue) ? 1 : 0.96 + Math.random() * 0.08;
    gain.gain.value = CUE_VOLUME[cue] * Math.max(0.35, Math.min(1.5, intensity));
    source.connect(gain);
    gain.connect(this.masterGain);
    source.start();
    source.onended = () => {
      source.disconnect();
      gain.disconnect();
    };
    this.lastPlayedAt.set(cue, now);
  }

  playEvents(events: WorldEvent[], activeAttack: BossAttack | null, intensity = 1): void {
    for (const cue of selectSoundCuesForEvents(events, activeAttack)) {
      this.play(cue, intensity);
    }
  }

  private playProceduralCue(cue: SoundCue, intensity: number): boolean {
    if (!this.context || !this.masterGain || typeof this.context.createOscillator !== 'function') return false;
    const now = this.context.currentTime;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    const config = resolveProceduralCue(cue);
    oscillator.type = config.type;
    oscillator.frequency.setValueAtTime(config.startFrequency, now);
    oscillator.frequency.exponentialRampToValueAtTime(config.endFrequency, now + config.duration);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(config.gain * Math.max(0.35, Math.min(1.35, intensity)), now + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + config.duration);
    oscillator.connect(gain);
    gain.connect(this.masterGain);
    oscillator.start(now);
    oscillator.stop(now + config.duration + 0.01);
    oscillator.onended = () => {
      oscillator.disconnect();
      gain.disconnect();
    };
    return true;
  }

  private async preload(): Promise<void> {
    if (!this.context || !this.supported || typeof fetch !== 'function') return;
    await Promise.all(Object.entries(SOUND_URLS).map(async ([cue, url]) => {
      if (this.buffers.has(cue as SoundCue)) return;
      try {
        const response = await fetch(url);
        if (!response.ok) return;
        const bytes = await response.arrayBuffer();
        if (!this.context || !this.supported) return;
        const buffer = await this.context.decodeAudioData(bytes);
        this.buffers.set(cue as SoundCue, buffer);
      } catch {
        // Missing optional samples should not disable the rest of the sound board.
      }
    }));
  }
}

function resolveProjectileCue(activeAttack: BossAttack | null): SoundCue {
  if (activeAttack === 'laser-ray' || activeAttack === 'laser-barrage') return 'blip';
  if (activeAttack === 'explosive-burst' || activeAttack === 'screen-ring' || activeAttack === 'ground-slam') return 'beat';
  if (activeAttack === 'charge-strike' || activeAttack === 'charge-sweep' || activeAttack === 'cone-cleave') return 'beat';
  return 'blip';
}

function resolveProceduralCue(cue: SoundCue): {
  type: OscillatorType;
  startFrequency: number;
  endFrequency: number;
  duration: number;
  gain: number;
} {
  if (cue === 'attackBeat') return { type: 'triangle', startFrequency: 880, endFrequency: 1320, duration: 0.055, gain: 0.12 };
  if (cue === 'attackTap') return { type: 'triangle', startFrequency: 620, endFrequency: 940, duration: 0.045, gain: 0.08 };
  if (cue === 'moveBeat') return { type: 'triangle', startFrequency: 240, endFrequency: 180, duration: 0.042, gain: 0.07 };
  if (cue === 'moveTap') return { type: 'triangle', startFrequency: 190, endFrequency: 150, duration: 0.032, gain: 0.045 };
  if (cue === 'dashBeat') return { type: 'square', startFrequency: 760, endFrequency: 1120, duration: 0.045, gain: 0.09 };
  if (cue === 'dashTap') return { type: 'square', startFrequency: 520, endFrequency: 760, duration: 0.038, gain: 0.065 };
  if (cue === 'guardBeat') return { type: 'sine', startFrequency: 520, endFrequency: 720, duration: 0.06, gain: 0.11 };
  if (cue === 'guardTap') return { type: 'sine', startFrequency: 360, endFrequency: 520, duration: 0.045, gain: 0.075 };
  if (cue === 'beat') return { type: 'triangle', startFrequency: 700, endFrequency: 980, duration: 0.05, gain: 0.09 };
  if (cue === 'blip') return { type: 'sine', startFrequency: 480, endFrequency: 720, duration: 0.035, gain: 0.055 };
  if (cue === 'graze') return { type: 'sine', startFrequency: 960, endFrequency: 1280, duration: 0.032, gain: 0.05 };
  if (cue === 'deny') return { type: 'square', startFrequency: 170, endFrequency: 120, duration: 0.045, gain: 0.055 };
  return { type: 'sine', startFrequency: 420, endFrequency: 560, duration: 0.035, gain: 0.055 };
}

function hasEvent(events: WorldEvent[], type: WorldEvent['type']): boolean {
  return events.some((event) => event.type === type);
}

function isRhythmInputCue(cue: SoundCue): boolean {
  return (
    cue === 'tap'
    || cue === 'beat'
    || cue === 'moveTap'
    || cue === 'moveBeat'
    || cue === 'attackTap'
    || cue === 'attackBeat'
    || cue === 'dashTap'
    || cue === 'dashBeat'
    || cue === 'guardTap'
    || cue === 'guardBeat'
  );
}

function dedupeAdjacent(cues: SoundCue[]): SoundCue[] {
  const deduped: SoundCue[] = [];
  for (const cue of cues) {
    if (deduped[deduped.length - 1] !== cue) {
      deduped.push(cue);
    }
  }
  return deduped;
}

function supportsWebAudioPlayback(context: AudioContext): boolean {
  const candidate = context as unknown as Record<string, unknown>;
  return (
    typeof candidate.createGain === 'function'
    && typeof candidate.createBufferSource === 'function'
    && typeof candidate.decodeAudioData === 'function'
  );
}
