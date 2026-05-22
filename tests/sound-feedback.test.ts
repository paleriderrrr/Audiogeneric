import test from 'node:test';
import assert from 'node:assert/strict';
import { selectSoundCuesForEvents, SoundEffectPlayer } from '../src/game/sound-feedback.js';

test('maps projectile events to attack-specific sound cues', () => {
  assert.deepEqual(selectSoundCuesForEvents([{ type: 'projectiles-fired' }], 'laser-ray'), ['blip']);
  assert.deepEqual(selectSoundCuesForEvents([{ type: 'projectiles-fired' }], 'explosive-burst'), ['beat']);
  assert.deepEqual(selectSoundCuesForEvents([{ type: 'projectiles-fired' }], 'sparse-ring'), ['blip']);
});

test('maps direct boss attacks to distinct sound cues', () => {
  assert.deepEqual(selectSoundCuesForEvents([{ type: 'boss-laser' }], null), ['blip']);
  assert.deepEqual(selectSoundCuesForEvents([{ type: 'boss-sweep' }], null), ['tap']);
});

test('maps major combat feedback to distinct sound cues', () => {
  const cues = selectSoundCuesForEvents([
    { type: 'boss-charged' },
    { type: 'perfect-defense' },
    { type: 'near-graze' }
  ], null);

  assert.deepEqual(cues, ['beat', 'graze']);
});

test('maps ordinary player operation events to action-specific short cues', () => {
  const cues = selectSoundCuesForEvents([
    { type: 'player-attack' },
    { type: 'player-dash' },
    { type: 'player-block' },
    { type: 'dash-blocked-by-cooldown' }
  ], null);

  assert.deepEqual(cues, ['attackTap', 'dashTap', 'guardTap', 'tap']);
});

test('maps on-beat player operation events to action-specific accented cues', () => {
  assert.deepEqual(
    selectSoundCuesForEvents([{ type: 'player-attack' }, { type: 'player-attack-beat' }], null),
    ['attackBeat']
  );
  assert.deepEqual(
    selectSoundCuesForEvents([{ type: 'player-dash' }, { type: 'player-dash-beat' }], null),
    ['dashBeat']
  );
  assert.deepEqual(
    selectSoundCuesForEvents([{ type: 'player-block' }, { type: 'player-block-beat' }], null),
    ['guardBeat']
  );
});

test('maps damage and graze feedback to separate concise cues', () => {
  assert.deepEqual(selectSoundCuesForEvents([{ type: 'player-hit' }], null), ['hit']);
  assert.deepEqual(selectSoundCuesForEvents([{ type: 'near-graze' }], null), ['graze']);
  assert.deepEqual(selectSoundCuesForEvents([{ type: 'player-blocked-hit' }], null), ['guardTap']);
});

test('plays immediate procedural rhythm cues before sample buffers finish loading', () => {
  let oscillatorStarted = false;
  const context = {
    currentTime: 1,
    destination: {},
    createGain() {
      return {
        gain: {
          value: 0,
          setValueAtTime() {},
          exponentialRampToValueAtTime() {}
        },
        connect() {},
        disconnect() {}
      };
    },
    createBufferSource() {
      return {
        buffer: null,
        playbackRate: { value: 1 },
        connect() {},
        disconnect() {},
        start() {},
        onended: null
      };
    },
    createOscillator() {
      return {
        type: 'sine',
        frequency: {
          setValueAtTime() {},
          exponentialRampToValueAtTime() {}
        },
        connect() {},
        disconnect() {},
        start() {
          oscillatorStarted = true;
        },
        stop() {},
        onended: null
      };
    },
    decodeAudioData() {
      return Promise.resolve({} as AudioBuffer);
    }
  } as unknown as AudioContext;
  const player = new SoundEffectPlayer();

  player.connect(context);
  player.play('attackTap');

  assert.equal(oscillatorStarted, true);
});

test('does not recursively retry a missing non-immediate sample after preload settles', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new Error('missing sample');
  }) as typeof fetch;

  const context = {
    currentTime: 1,
    destination: {},
    createGain() {
      return {
        gain: {
          value: 0,
          setValueAtTime() {},
          exponentialRampToValueAtTime() {}
        },
        connect() {},
        disconnect() {}
      };
    },
    createBufferSource() {
      return {
        buffer: null,
        playbackRate: { value: 1 },
        connect() {},
        disconnect() {},
        start() {},
        onended: null
      };
    },
    createOscillator() {
      return {
        type: 'sine',
        frequency: {
          setValueAtTime() {},
          exponentialRampToValueAtTime() {}
        },
        connect() {},
        disconnect() {},
        start() {},
        stop() {},
        onended: null
      };
    },
    decodeAudioData() {
      return Promise.resolve({} as AudioBuffer);
    }
  } as unknown as AudioContext;
  const player = new SoundEffectPlayer();
  const originalPlay = player.play.bind(player);
  let playAttempts = 0;
  player.play = ((cue: Parameters<SoundEffectPlayer['play']>[0], intensity?: number) => {
    playAttempts += 1;
    if (playAttempts < 8) {
      originalPlay(cue, intensity);
    }
  }) as SoundEffectPlayer['play'];

  try {
    player.connect(context);
    await new Promise<void>((resolve) => setImmediate(resolve));

    player.play('explosion');
    await new Promise<void>((resolve) => setImmediate(resolve));

    assert.equal(playAttempts, 1);
  } finally {
    player.disconnect();
    globalThis.fetch = originalFetch;
  }
});
