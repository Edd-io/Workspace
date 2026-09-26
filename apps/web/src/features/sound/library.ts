import manifest from './sounds.json';

/**
 * The office's recorded sounds (CC0, built by assets/audio/build_sounds.py): ambience loops,
 * keyboards and footsteps, fetched and decoded on first use.
 */

export interface LoopSound {
  buffer: AudioBuffer;
  /** Seconds: the seamless part of the buffer (the rest is padding around it). */
  loopStart: number;
  loopEnd: number;
}

export type AmbienceName = 'ambience-indoor' | 'ambience-day' | 'ambience-night';
export type Surface = keyof typeof manifest.steps;

export interface OneShot {
  buffer: AudioBuffer;
  /** Where the sound actually starts (decoders may add a little silence first). */
  offset: number;
}

export interface SoundLibrary {
  ambience: Record<AmbienceName, LoopSound>;
  typing: LoopSound[];
  steps: Record<Surface, OneShot[]>;
}

const cache = new Map<string, Promise<AudioBuffer>>();

function load(context: BaseAudioContext, url: string): Promise<AudioBuffer> {
  let pending = cache.get(url);
  if (!pending) {
    pending = fetch(url)
      .then((response) => {
        if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
        return response.arrayBuffer();
      })
      .then((data) => context.decodeAudioData(data));
    // A failed download may be retried later.
    pending.catch(() => cache.delete(url));
    cache.set(url, pending);
  }
  return pending;
}

/** First sample loud enough to hear, in seconds. */
export function soundStart(buffer: AudioBuffer, threshold = 0.01): number {
  const data = buffer.getChannelData(0);
  for (let index = 0; index < data.length; index++) {
    if (Math.abs(data[index]!) > threshold) return Math.max(0, index - 32) / buffer.sampleRate;
  }
  return 0;
}

async function loop(context: BaseAudioContext, name: keyof typeof manifest.loops): Promise<LoopSound> {
  const entry = manifest.loops[name];
  return { buffer: await load(context, entry.url), loopStart: entry.loopStart, loopEnd: entry.loopEnd };
}

let library: Promise<SoundLibrary> | null = null;

export function loadSoundLibrary(context: BaseAudioContext): Promise<SoundLibrary> {
  library ??= (async () => {
    const [indoor, day, night, typing, steps] = await Promise.all([
      loop(context, 'ambience-indoor'),
      loop(context, 'ambience-day'),
      loop(context, 'ambience-night'),
      Promise.all(
        (['typing-1', 'typing-2', 'typing-3', 'typing-4'] as const).map((name) => loop(context, name)),
      ),
      Promise.all(
        (Object.keys(manifest.steps) as Surface[]).map(async (surface) => {
          const buffers = await Promise.all(manifest.steps[surface].map((url) => load(context, url)));
          return [surface, buffers.map((buffer) => ({ buffer, offset: soundStart(buffer) }))] as const;
        }),
      ),
    ]);
    return {
      ambience: { 'ambience-indoor': indoor, 'ambience-day': day, 'ambience-night': night },
      typing,
      steps: Object.fromEntries(steps) as Record<Surface, OneShot[]>,
    };
  })();
  library.catch(() => {
    library = null;
  });
  return library;
}
