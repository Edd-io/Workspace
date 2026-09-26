"""Builds the office's sounds from CC0 field recordings.

Downloads the sources listed below (every one is CC0, see CREDITS.md), cuts seamless loops out of
the calmest stretch of each ambience, levels everything, and encodes MP3s into
apps/web/public/sounds/, plus the manifest the web client reads
(apps/web/src/features/sound/sounds.json).

    python3 assets/audio/build_sounds.py

Needs ffmpeg (with libmp3lame) and numpy. Downloads are cached in assets/audio/.cache/ (ignored by git).
"""

import io
import json
import subprocess
import urllib.request
import zipfile
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
CACHE = Path(__file__).resolve().parent / ".cache"
OUT = ROOT / "apps/web/public/sounds"
MANIFEST = ROOT / "apps/web/src/features/sound/sounds.json"

RATE = 44100
# Every loop file carries this much wrapped audio at both ends, so that the loop points are safe
# whatever delay the MP3 decoder adds (it is ~26 ms).
PAD = 0.2

BIGSOUNDBANK = "https://bigsoundbank.com/UPLOAD/mp3/{}.mp3"
KENNEY_IMPACT = "https://kenney.nl/media/pages/assets/impact-sounds/87b4ddecda-1677589768/kenney_impact-sounds.zip"

# name, BigSoundBank id, loop length (s), crossfade (s), channels, loudness (LUFS), bitrate
LOOPS = [
    # "Sound atmosphere in a house", meant to be played very low: the room tone indoors.
    ("ambience-indoor", "2458", 40, 2.0, 2, -32, "96k"),
    # Blackbirds, blackcaps and wrens in a city garden, spring morning: outdoors by day.
    ("ambience-day", "3575", 45, 2.0, 2, -30, "96k"),
    # Nocturnal insects, wind in a hedge, distant roads: outdoors at night.
    ("ambience-night", "1470", 40, 2.0, 2, -32, "96k"),
    # Keyboards (quick computer keyboard, slow keyboard, white MacBook, iMac).
    ("typing-1", "1734", 16, 0.25, 1, -24, "64k"),
    ("typing-2", "1733", 16, 0.25, 1, -24, "64k"),
    ("typing-3", "1726", 14, 0.25, 1, -24, "64k"),
    ("typing-4", "1731", 16, 0.25, 1, -24, "64k"),
]

# Footsteps from Kenney's Impact Sounds, per floor surface.
STEPS = {"wood": "wood", "concrete": "concrete", "grass": "grass"}
STEP_VARIANTS = 5


def download(url: str, name: str) -> bytes:
    CACHE.mkdir(exist_ok=True)
    path = CACHE / name
    if not path.exists():
        request = urllib.request.Request(url, headers={"User-Agent": "workspace-sound-build"})
        with urllib.request.urlopen(request, timeout=120) as response:
            path.write_bytes(response.read())
    return path.read_bytes()


def decode(data: bytes, channels: int) -> np.ndarray:
    """Any audio file → float32 samples at RATE, shape (frames, channels)."""
    result = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", "pipe:0", "-ac", str(channels), "-ar", str(RATE), "-f", "f32le", "pipe:1"],
        input=data,
        capture_output=True,
        check=True,
    )
    return np.frombuffer(result.stdout, dtype=np.float32).reshape(-1, channels).copy()


def encode(samples: np.ndarray, path: Path, bitrate: str) -> None:
    channels = samples.shape[1]
    subprocess.run(
        [
            "ffmpeg", "-v", "error", "-y", "-f", "f32le", "-ar", str(RATE), "-ac", str(channels), "-i", "pipe:0",
            "-c:a", "libmp3lame", "-b:a", bitrate, "-map_metadata", "-1", str(path),
        ],
        input=np.clip(samples, -1, 1).astype(np.float32).tobytes(),
        check=True,
    )


def loudness(samples: np.ndarray) -> float:
    """Integrated loudness (EBU R128) measured by ffmpeg."""
    channels = samples.shape[1]
    result = subprocess.run(
        [
            "ffmpeg", "-nostats", "-f", "f32le", "-ar", str(RATE), "-ac", str(channels), "-i", "pipe:0",
            "-af", "ebur128", "-f", "null", "-",
        ],
        input=samples.astype(np.float32).tobytes(),
        capture_output=True,
        check=True,
    )
    for line in reversed(result.stderr.decode().splitlines()):
        line = line.strip()
        if line.startswith("I:"):
            return float(line.split()[1])
    raise RuntimeError("no loudness measured")


def calmest_window(samples: np.ndarray, length: int, margin: int) -> int:
    """Start of the window of `length` frames with the fewest loud events (a car, a door...)."""
    hop = RATE // 5
    mono = samples.mean(axis=1)
    blocks = len(mono) // hop
    rms = np.sqrt(np.mean(mono[: blocks * hop].reshape(blocks, hop) ** 2, axis=1) + 1e-12)
    level = 20 * np.log10(rms)
    span = length // hop
    best, best_score = margin, float("inf")
    for block in range(margin // hop, blocks - span - margin // hop):
        window = level[block : block + span]
        # Peaks above the typical level are what sounds wrong when a loop repeats.
        score = (np.percentile(window, 98) - np.median(window)) + 0.5 * np.std(window)
        if score < best_score:
            best, best_score = block * hop, score
    return best


def seamless_loop(segment: np.ndarray, length: int, fade: int) -> np.ndarray:
    """`segment` holds length + fade frames: its tail is cross-faded into its head (equal power)."""
    loop = segment[:length].copy()
    t = np.linspace(0, 1, fade, dtype=np.float32)[:, None]
    loop[:fade] = segment[:fade] * np.sqrt(t) + segment[length : length + fade] * np.sqrt(1 - t)
    return loop


def build_loops(manifest: dict) -> None:
    for name, source, seconds, crossfade, channels, target, bitrate in LOOPS:
        samples = decode(download(BIGSOUNDBANK.format(source), f"bsb-{source}.mp3"), channels)
        length, fade = int(seconds * RATE), int(crossfade * RATE)
        start = calmest_window(samples, length + fade, margin=2 * RATE)
        loop = seamless_loop(samples[start : start + length + fade], length, fade)
        loop *= 10 ** ((target - loudness(loop)) / 20)
        pad = int(PAD * RATE)
        padded = np.concatenate([loop[-pad:], loop, loop[:pad]])
        encode(padded, OUT / f"{name}.mp3", bitrate)
        manifest["loops"][name] = {"url": f"/sounds/{name}.mp3", "loopStart": PAD, "loopEnd": PAD + seconds}
        print(f"{name}: {seconds} s from {start / RATE:.1f} s of BigSoundBank #{source}")


def build_steps(manifest: dict) -> None:
    archive = zipfile.ZipFile(io.BytesIO(download(KENNEY_IMPACT, "kenney_impact-sounds.zip")))
    files = {Path(name).name: name for name in archive.namelist()}
    for surface, prefix in STEPS.items():
        urls = []
        for index in range(STEP_VARIANTS):
            samples = decode(archive.read(files[f"footstep_{prefix}_{index:03d}.ogg"]), 1)
            loud = np.flatnonzero(np.abs(samples[:, 0]) > 0.01)
            samples = samples[max(0, loud[0] - 40) : loud[-1] + 1]
            fade = min(len(samples), int(0.01 * RATE))
            samples[-fade:] *= np.linspace(1, 0, fade, dtype=np.float32)[:, None]
            # Same peak for every step: the surfaces differ by their sound, not their level.
            samples *= 0.7 / np.abs(samples).max()
            name = f"step-{surface}-{index + 1}"
            encode(samples, OUT / f"{name}.mp3", "64k")
            urls.append(f"/sounds/{name}.mp3")
        manifest["steps"][surface] = urls
        print(f"steps on {surface}: {len(urls)} variants")


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    manifest: dict = {"loops": {}, "steps": {}}
    build_loops(manifest)
    build_steps(manifest)
    MANIFEST.write_text(json.dumps(manifest, indent=2) + "\n")
    total = sum(path.stat().st_size for path in OUT.glob("*.mp3"))
    print(f"{len(list(OUT.glob('*.mp3')))} files, {total / 1024:.0f} KiB in {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
