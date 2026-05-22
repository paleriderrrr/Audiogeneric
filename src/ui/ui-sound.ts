import { SoundEffectPlayer, type SoundCue } from '../game/sound-feedback.js';

export interface UiSoundPlayer {
  play(cue: SoundCue, intensity?: number): void;
}

export interface UiSoundController {
  disconnect(): void;
}

type UiSoundRoot = Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;

export function installUiControlSounds(root: UiSoundRoot, player: UiSoundPlayer = createDefaultUiSoundPlayer()): UiSoundController {
  const handlePointerDown = (event: Event) => {
    if (isUiSoundControl(event.target)) {
      player.play('tap', 0.65);
    }
  };

  const handleKeyDown = (event: Event) => {
    const keyboardEvent = event as KeyboardEvent;
    if (keyboardEvent.repeat) return;
    if (keyboardEvent.key !== 'Enter' && keyboardEvent.key !== ' ') return;
    if (isUiSoundControl(keyboardEvent.target)) {
      player.play('tap', 0.65);
    }
  };

  root.addEventListener('pointerdown', handlePointerDown);
  root.addEventListener('keydown', handleKeyDown);

  return {
    disconnect() {
      root.removeEventListener('pointerdown', handlePointerDown);
      root.removeEventListener('keydown', handleKeyDown);
    }
  };
}

function createDefaultUiSoundPlayer(): UiSoundPlayer {
  const soundEffects = new SoundEffectPlayer();
  let context: AudioContext | null = null;

  return {
    play(cue, intensity) {
      if (!context) {
        context = new AudioContext();
        soundEffects.connect(context);
      }
      if (context.state === 'suspended') {
        void context.resume();
      }
      soundEffects.play(cue, intensity);
    }
  };
}

function isUiSoundControl(target: EventTarget | null): boolean {
  const element = asClosestCapableElement(target);
  const control = element?.closest('button, input, select, textarea, label, [role="button"]') as HTMLElement | null;
  if (!control) return false;

  const controlState = control as HTMLButtonElement | HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
  if (controlState.disabled) return false;
  if (typeof control.getAttribute === 'function' && control.getAttribute('aria-disabled') === 'true') return false;
  return true;
}

function asClosestCapableElement(target: EventTarget | null): Element | null {
  if (!target || typeof target !== 'object') return null;
  if (typeof Element !== 'undefined' && target instanceof Element) return target;
  return typeof (target as { closest?: unknown }).closest === 'function'
    ? target as Element
    : null;
}
