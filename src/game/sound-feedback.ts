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
} satisfies Record<SoundCue, string>;

const CUE_VOLUME = {
  tap: 0.11,
  beat: 0.17,
  attackTap: 0.12,
  attackBeat: 0.18,
  dashTap: 0.1,
  dashBeat: 0.16,
  guardTap: 0.11,
  guardBeat: 0.17,
  hit: 0.15,
  graze: 0.1,
  blip: 0.1,
  charge: 0.13,
  explosion: 0.16,
  laser: 0.12,
  message: 0.1
} satisfies Record<SoundCue, number>;

const CUE_COOLDOWN = {
  tap: 0.025,
  beat: 0.045,
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
  message: 0.12
} satisfies Record<SoundCue, number>;

export type SoundCue =
  | 'tap'
  | 'beat'
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
  | 'message';

export function selectSoundCuesForEvents(events: WorldEvent[], activeAttack: BossAttack | null): SoundCue[] {
  const cues: SoundCue[] = [];
  const hasAttackBeat = hasEvent(events, 'player-attack-beat');
  const hasBlockBeat = hasEvent(events, 'player-block-beat');
  const hasDashBeat = hasEvent(events, 'player-dash-beat');

  for (const event of events) {
    if (event.type === 'projectiles-fired') {
      cues.push(resolveProjectileCue(activeAttack));
    } else if (event.type === 'boss-laser') {
      cues.push('laser');
    } else if (event.type === 'boss-sweep') {
      cues.push('charge');
    } else if (event.type === 'boss-charged') {
      cues.push('charge');
    } else if (event.type === 'boss-break' || event.type === 'boss-self-hit') {
      cues.push('explosion');
    } else if (
      event.type === 'perfect-defense'
      || event.type === 'dash-cleared-projectiles'
    ) {
      cues.push('beat');
    } else if (event.type === 'player-attack-beat') {
      cues.push('attackBeat');
    } else if (event.type === 'player-dash-beat') {
      cues.push('dashBeat');
    } else if (event.type === 'player-block-beat') {
      cues.push('guardBeat');
    } else if (event.type === 'attack-hit' && !hasAttackBeat) {
      cues.push('hit');
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
      cues.push('tap');
    }
  }
  return dedupeAdjacent(cues);
}

export class SoundEffectPlayer {
  private context: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private buffers = new Map<SoundCue, AudioBuffer>();
  private loading: Promise<void> | null = null;
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
    this.masterGain = context.createGain();
    this.masterGain.gain.value = 0.28;
    this.masterGain.connect(context.destination);
    this.loading = this.preload().catch(() => undefined);
  }

  disconnect(): void {
    this.masterGain?.disconnect();
    this.masterGain = null;
    this.context = null;
    this.loading = null;
    this.supported = false;
    this.lastPlayedAt.clear();
  }

  play(cue: SoundCue, intensity = 1): void {
    if (!this.supported || !this.context || !this.masterGain) return;
    const now = this.context.currentTime;
    if (now - (this.lastPlayedAt.get(cue) ?? -Infinity) < CUE_COOLDOWN[cue]) return;

    const buffer = this.buffers.get(cue);
    if (!buffer) {
      void this.loading?.then(() => this.play(cue, intensity));
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

  private async preload(): Promise<void> {
    if (!this.context || !this.supported || typeof fetch !== 'function') return;
    await Promise.all(Object.entries(SOUND_URLS).map(async ([cue, url]) => {
      if (this.buffers.has(cue as SoundCue)) return;
      const response = await fetch(url);
      const bytes = await response.arrayBuffer();
      if (!this.context || !this.supported) return;
      const buffer = await this.context.decodeAudioData(bytes);
      this.buffers.set(cue as SoundCue, buffer);
    }));
  }
}

function resolveProjectileCue(activeAttack: BossAttack | null): SoundCue {
  if (activeAttack === 'laser-ray') return 'laser';
  if (activeAttack === 'explosive-burst' || activeAttack === 'screen-ring') return 'explosion';
  if (activeAttack === 'charge-strike') return 'charge';
  return 'blip';
}

function hasEvent(events: WorldEvent[], type: WorldEvent['type']): boolean {
  return events.some((event) => event.type === type);
}

function isRhythmInputCue(cue: SoundCue): boolean {
  return (
    cue === 'tap'
    || cue === 'beat'
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
