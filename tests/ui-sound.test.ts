import test from 'node:test';
import assert from 'node:assert/strict';
import { installUiControlSounds } from '../src/ui/ui-sound.js';
import type { SoundCue } from '../src/game/sound-feedback.js';

class FakeControlTarget {
  constructor(private readonly control: Record<string, unknown> | null) {}

  closest(selector: string): Record<string, unknown> | null {
    assert.equal(selector, 'button, input, select, textarea, label, [role="button"]');
    return this.control;
  }
}

function createRoot(): {
  root: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;
  dispatch(type: string, event: Record<string, unknown>): void;
  removedCount(): number;
} {
  const listeners = new Map<string, EventListener[]>();
  let removed = 0;
  const root = {
    addEventListener(type: string, listener: EventListener) {
      listeners.set(type, [...(listeners.get(type) ?? []), listener]);
    },
    removeEventListener(type: string, listener: EventListener) {
      removed += 1;
      listeners.set(type, (listeners.get(type) ?? []).filter((candidate) => candidate !== listener));
    }
  };

  return {
    root,
    dispatch(type, event) {
      for (const listener of listeners.get(type) ?? []) {
        listener(event as unknown as Event);
      }
    },
    removedCount() {
      return removed;
    }
  };
}

test('plays a concise cue when ui controls are activated', () => {
  const { root, dispatch } = createRoot();
  const played: SoundCue[] = [];

  installUiControlSounds(root, {
    play(cue: SoundCue) {
      played.push(cue);
    }
  });

  dispatch('pointerdown', {
    target: new FakeControlTarget({ disabled: false })
  });
  dispatch('keydown', {
    key: 'Enter',
    repeat: false,
    target: new FakeControlTarget({ disabled: false })
  });

  assert.deepEqual(played, ['tap', 'tap']);
});

test('ignores disabled controls and repeated keyboard activation', () => {
  const { root, dispatch, removedCount } = createRoot();
  const played: SoundCue[] = [];

  const controller = installUiControlSounds(root, {
    play(cue: SoundCue) {
      played.push(cue);
    }
  });

  dispatch('pointerdown', {
    target: new FakeControlTarget({ disabled: true })
  });
  dispatch('keydown', {
    key: ' ',
    repeat: true,
    target: new FakeControlTarget({ disabled: false })
  });
  dispatch('pointerdown', {
    target: new FakeControlTarget(null)
  });
  controller.disconnect();

  assert.deepEqual(played, []);
  assert.equal(removedCount(), 2);
});
