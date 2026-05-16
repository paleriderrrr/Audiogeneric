import test from 'node:test';
import assert from 'node:assert/strict';
import { selectSoundCuesForEvents } from '../src/game/sound-feedback.js';

test('maps projectile events to attack-specific sound cues', () => {
  assert.deepEqual(selectSoundCuesForEvents([{ type: 'projectiles-fired' }], 'laser-ray'), ['laser']);
  assert.deepEqual(selectSoundCuesForEvents([{ type: 'projectiles-fired' }], 'explosive-burst'), ['explosion']);
  assert.deepEqual(selectSoundCuesForEvents([{ type: 'projectiles-fired' }], 'sparse-ring'), ['blip']);
});

test('maps direct boss attacks to distinct sound cues', () => {
  assert.deepEqual(selectSoundCuesForEvents([{ type: 'boss-laser' }], null), ['laser']);
  assert.deepEqual(selectSoundCuesForEvents([{ type: 'boss-sweep' }], null), ['charge']);
});

test('maps major combat feedback to distinct sound cues', () => {
  const cues = selectSoundCuesForEvents([
    { type: 'boss-charged' },
    { type: 'boss-self-hit' },
    { type: 'perfect-defense' },
    { type: 'near-graze' }
  ], null);

  assert.deepEqual(cues, ['charge', 'explosion', 'beat', 'graze']);
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
