import { sharedAudioContext, soundEnabled } from './soundSettings';

/** Tiny synthesized sounds (no audio files): a soft two-note chime for alerts. */

export function audioContext(): AudioContext | null {
  try {
    const context = sharedAudioContext();
    if (context.state === 'suspended') void context.resume();
    return context;
  } catch {
    return null;
  }
}

function note(audio: AudioContext, frequency: number, start: number, duration: number, volume: number): void {
  const oscillator = audio.createOscillator();
  const gain = audio.createGain();
  oscillator.type = 'sine';
  oscillator.frequency.value = frequency;
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(volume, start + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  oscillator.connect(gain).connect(audio.destination);
  oscillator.start(start);
  oscillator.stop(start + duration + 0.05);
}

export function playChime(kind: 'question' | 'error'): void {
  if (!soundEnabled()) return;
  const audio = audioContext();
  if (!audio || audio.state !== 'running') return;
  const now = audio.currentTime;
  if (kind === 'error') {
    note(audio, 440, now, 0.35, 0.08);
    note(audio, 330, now + 0.18, 0.5, 0.08);
  } else {
    note(audio, 784, now, 0.4, 0.07);
    note(audio, 1046.5, now + 0.14, 0.6, 0.06);
  }
}
