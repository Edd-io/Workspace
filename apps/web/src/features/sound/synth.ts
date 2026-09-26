import { seededRandom } from '../../world/appearance';

/**
 * Procedurally synthesized office sounds, so the app ships no audio file: keyboard typing (with
 * bursts and pauses like a real person), building room tone and footsteps.
 */

function keystroke(
  data: Float32Array,
  start: number,
  sampleRate: number,
  random: () => number,
  loud: number,
): void {
  // A key: sharp click (filtered noise, ~4 ms) followed by a softer bottom-out "thock" (~25 ms).
  const clickLength = Math.floor(sampleRate * 0.004);
  const thockLength = Math.floor(sampleRate * 0.025);
  const thockDelay = Math.floor(sampleRate * (0.008 + random() * 0.006));
  let previous = 0;
  for (let i = 0; i < clickLength && start + i < data.length; i++) {
    const noise = random() * 2 - 1;
    const highPassed = noise - previous * 0.6;
    previous = noise;
    data[start + i]! += highPassed * loud * Math.exp(-i / (clickLength / 3));
  }
  let low = 0;
  for (let i = 0; i < thockLength && start + thockDelay + i < data.length; i++) {
    low = low * 0.85 + (random() * 2 - 1) * 0.15;
    data[start + thockDelay + i]! += low * loud * 1.6 * Math.exp(-i / (thockLength / 4));
  }
}

/** A loop of someone typing: bursts of 3-18 keys at 70-190 ms, pauses of 0.4-2.8 s. */
export function typingBuffer(context: BaseAudioContext, seconds = 12, seed = 1): AudioBuffer {
  const sampleRate = context.sampleRate;
  const buffer = context.createBuffer(1, Math.floor(sampleRate * seconds), sampleRate);
  const data = buffer.getChannelData(0);
  const random = seededRandom(seed);
  let t = random() * 0.5;
  while (t < seconds - 0.3) {
    const keys = 3 + Math.floor(random() * 16);
    for (let k = 0; k < keys && t < seconds - 0.1; k++) {
      const spaceBar = random() < 0.15;
      keystroke(
        data,
        Math.floor(t * sampleRate),
        sampleRate,
        random,
        spaceBar ? 0.55 : 0.32 + random() * 0.15,
      );
      t += 0.07 + random() * 0.12;
    }
    t += 0.4 + random() * 2.4;
  }
  return buffer;
}

/** Soft ventilation hum: low-passed brown noise, seamless when looped. */
export function roomToneBuffer(context: BaseAudioContext, seconds = 6): AudioBuffer {
  const sampleRate = context.sampleRate;
  const length = Math.floor(sampleRate * seconds);
  const buffer = context.createBuffer(1, length, sampleRate);
  const data = buffer.getChannelData(0);
  const random = seededRandom(9);
  let brown = 0;
  for (let i = 0; i < length; i++) {
    brown = (brown + 0.02 * (random() * 2 - 1)) / 1.02;
    data[i] = brown * 3.2;
  }
  // Cross-fade the ends so the loop has no click.
  const fade = Math.floor(sampleRate * 0.25);
  for (let i = 0; i < fade; i++) {
    const weight = i / fade;
    data[i] = data[i]! * weight + data[length - fade + i]! * (1 - weight);
  }
  return buffer;
}

/** One muffled footstep on a hard floor. */
export function footstepBuffer(context: BaseAudioContext, seed: number): AudioBuffer {
  const sampleRate = context.sampleRate;
  const length = Math.floor(sampleRate * 0.12);
  const buffer = context.createBuffer(1, length, sampleRate);
  const data = buffer.getChannelData(0);
  const random = seededRandom(seed);
  let low = 0;
  for (let i = 0; i < length; i++) {
    low = low * 0.9 + (random() * 2 - 1) * 0.1;
    data[i] = low * 2.4 * Math.exp(-i / (length / 6));
  }
  return buffer;
}
