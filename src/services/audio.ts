/**
 * TECH-13, YG-05, FX-06, SND-01…SND-03: the only place that makes sound. Sound plays only when no
 * silence reason is active (hidden tab, lost focus, page hide, SDK pause, an ad) and the player
 * has not switched it off; it starts after the first touch (SND-03). The effects are synthesised
 * in code at run time — 0 KB to download, no decoding delay: wooden marimba notes, bells, soft
 * knocks, a room echo, and a quiet ambience loop while the battle is played (setAmbience).
 * Give each game its own timbres in voices(); the plumbing stays.
 */

export type SilenceReason = 'hidden' | 'blur' | 'pagehide' | 'sdk_pause' | 'ad';

export type Sfx =
  'tap' | 'hit' | 'miss' | 'empty' | 'coin' | 'continue' | 'win' | 'lose' | 'button';

/** FX-06: at most 6 sounds a second. */
const MAX_PER_SECOND = 6;
const MASTER = 0.7;
/** SND-02: the ambience is much quieter than the effects. */
const AMBIENCE = 0.05;

/** An oscillator voice; `partials` are [frequency ratio, loudness] pairs. */
interface Tone {
  kind?: 'tone';
  freq: number;
  dur: number;
  type?: OscillatorType;
  gain?: number;
  /** The frequency at the end, as a factor. */
  slide?: number;
  delay?: number;
  attack?: number;
  partials?: [number, number][];
}

/** Filtered noise: water, splashes, swooshes. */
interface Noise {
  kind: 'noise';
  dur: number;
  filter: BiquadFilterType;
  freq: number;
  /** The filter frequency at the end. */
  to?: number;
  q?: number;
  gain?: number;
  delay?: number;
  attack?: number;
}

type Voice = Tone | Noise;

/** Wooden bar partials: the marimba. */
const MARIMBA: [number, number][] = [
  [1, 1],
  [3.93, 0.16],
  [2, 0.08],
];
/** A small bell. */
const BELL: [number, number][] = [
  [1, 1],
  [2.76, 0.28],
  [5.4, 0.1],
];

/** SND-01: a run of good moves climbs a major pentatonic scale — one base sound, rising. */
const PENTATONIC = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];

/** The pitch factor of step n of a run (0 is the base note). */
export function scalePitch(step: number): number {
  const semis = PENTATONIC[Math.min(Math.max(0, step), PENTATONIC.length - 1)] as number;
  return Math.pow(2, semis / 12);
}

function voices(name: Sfx, pitch: number): Voice[] {
  switch (name) {
    case 'tap':
      // A light wooden tick.
      return [
        { freq: 880, dur: 0.06, type: 'triangle', gain: 0.16, slide: 0.7, attack: 0.002 },
        { kind: 'noise', dur: 0.025, filter: 'highpass', freq: 3500, gain: 0.05 },
      ];
    case 'hit':
      return [
        { freq: 392 * pitch, dur: 0.5, gain: 0.3, partials: MARIMBA, attack: 0.003 },
        { freq: 1568 * pitch, dur: 0.12, gain: 0.05, delay: 0.03 },
        { kind: 'noise', dur: 0.1, filter: 'bandpass', freq: 900, to: 2600, q: 3, gain: 0.1 },
      ];
    case 'miss':
      return [
        { freq: 220, dur: 0.3, gain: 0.18, partials: MARIMBA, slide: 0.8 },
        { kind: 'noise', dur: 0.3, filter: 'lowpass', freq: 1800, to: 300, gain: 0.18 },
      ];
    case 'empty':
      // A soft double knock.
      return [
        { freq: 196, dur: 0.08, type: 'triangle', gain: 0.14 },
        { freq: 165, dur: 0.09, type: 'triangle', gain: 0.12, delay: 0.09 },
      ];
    case 'coin':
      // A two-note chime.
      return [
        { freq: 988, dur: 0.45, gain: 0.18, partials: BELL },
        { freq: 1319, dur: 0.6, gain: 0.18, partials: BELL, delay: 0.09 },
      ];
    case 'continue':
      return [392, 494, 588].map((freq, i) => ({
        freq,
        dur: 0.4,
        gain: 0.2,
        partials: MARIMBA,
        delay: i * 0.08,
      }));
    case 'win':
      return [
        ...[523, 659, 784, 1047].map((freq, i) => ({
          freq,
          dur: 0.5,
          gain: 0.24,
          partials: MARIMBA,
          delay: i * 0.11,
        })),
        ...[523, 659, 784].map((freq) => ({ freq, dur: 1.1, gain: 0.06, delay: 0.46 })),
        { freq: 2093, dur: 0.5, gain: 0.05, partials: BELL, delay: 0.5 },
      ];
    case 'lose':
      return [392, 349, 294].map((freq, i) => ({
        freq,
        dur: 0.45,
        gain: 0.2,
        partials: MARIMBA,
        delay: i * 0.2,
      }));
    case 'button':
      return [{ freq: 1100, dur: 0.04, type: 'triangle', gain: 0.1, slide: 0.75, attack: 0.002 }];
  }
}

export class AudioService {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  /** Effects go here: straight to the master and through the echo. */
  private bus: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private ambienceGain: GainNode | null = null;
  private ambienceWanted = false;
  private readonly reasons = new Set<SilenceReason>();
  private enabled = true;
  private readonly recent: number[] = [];
  /** For tests: what would have been played. */
  readonly played: Sfx[] = [];

  /** SND-03: browsers allow sound only after a user gesture; call from the first one. */
  unlock(): void {
    if (this.ctx) return;
    const Ctor = window.AudioContext as typeof AudioContext | undefined;
    if (!Ctor) return;
    try {
      const ctx = new Ctor();
      this.ctx = ctx;
      this.master = ctx.createGain();
      this.master.gain.value = MASTER;
      this.master.connect(ctx.destination);
      this.noise = noiseBuffer(ctx, 2, false);
      this.bus = ctx.createGain();
      this.bus.connect(this.master);
      const echo = ctx.createConvolver();
      echo.buffer = roomEcho(ctx);
      const wet = ctx.createGain();
      wet.gain.value = 0.22;
      this.bus.connect(echo).connect(wet).connect(this.master);
    } catch {
      this.ctx = null;
      return;
    }
    this.sync();
    this.applyAmbience();
  }

  setSilenced(reason: SilenceReason, on: boolean): void {
    if (on) this.reasons.add(reason);
    else this.reasons.delete(reason);
    this.sync();
  }

  /** UI-06: the player's sound switch. */
  setEnabled(on: boolean): void {
    this.enabled = on;
    this.sync();
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  audible(): boolean {
    return this.enabled && this.reasons.size === 0;
  }

  silenceReasons(): SilenceReason[] {
    return [...this.reasons];
  }

  /** SND-02: the ambience plays while the battle is played (the GameplayAPI.start condition). */
  setAmbience(on: boolean): void {
    this.ambienceWanted = on;
    this.applyAmbience();
  }

  ambienceOn(): boolean {
    return this.ambienceWanted;
  }

  /** `pitch` — a frequency factor (scalePitch for a rising run). */
  play(name: Sfx, pitch = 1): void {
    if (!this.audible()) return;
    const now = performance.now();
    while (this.recent.length > 0 && now - (this.recent[0] as number) > 1000) this.recent.shift();
    if (this.recent.length >= MAX_PER_SECOND) return;
    this.recent.push(now);
    this.played.push(name);
    if (this.played.length > 50) this.played.shift();
    const ctx = this.ctx;
    const out = this.bus;
    if (ctx?.state !== 'running' || !out) return;
    for (const v of voices(name, pitch)) {
      if (v.kind === 'noise') this.noiseVoice(ctx, out, v);
      else this.tone(ctx, out, v);
    }
  }

  private envelope(ctx: AudioContext, t0: number, v: Voice, peak: number): GainNode {
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(peak, t0 + (v.attack ?? 0.008));
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + v.dur);
    return gain;
  }

  private tone(ctx: AudioContext, out: AudioNode, v: Tone): void {
    const t0 = ctx.currentTime + (v.delay ?? 0);
    for (const [ratio, loud] of v.partials ?? [[1, 1]]) {
      const osc = ctx.createOscillator();
      osc.type = v.type ?? 'sine';
      const f = v.freq * ratio;
      osc.frequency.setValueAtTime(f, t0);
      if (v.slide) osc.frequency.exponentialRampToValueAtTime(f * v.slide, t0 + v.dur);
      // Higher partials fade sooner, as on a wooden bar.
      const dur = ratio > 1 ? v.dur * 0.45 : v.dur;
      const gain = this.envelope(ctx, t0, { ...v, dur }, (v.gain ?? 0.3) * loud);
      osc.connect(gain).connect(out);
      osc.start(t0);
      osc.stop(t0 + dur + 0.02);
    }
  }

  private noiseVoice(ctx: AudioContext, out: AudioNode, v: Noise): void {
    if (!this.noise) return;
    const t0 = ctx.currentTime + (v.delay ?? 0);
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = v.filter;
    filter.frequency.setValueAtTime(v.freq, t0);
    if (v.to) filter.frequency.exponentialRampToValueAtTime(v.to, t0 + v.dur);
    filter.Q.value = v.q ?? 0.8;
    const gain = this.envelope(ctx, t0, v, v.gain ?? 0.2);
    src.connect(filter).connect(gain).connect(out);
    // A different stretch of the 2-second noise each time (voices are at most 1 s long).
    src.start(t0, (t0 * 0.37) % 1);
    src.stop(t0 + v.dur + 0.02);
  }

  /** Builds the loop once (brown noise, low-passed, slowly swelling) and fades it in or out. */
  private applyAmbience(): void {
    const ctx = this.ctx;
    const out = this.master;
    if (!ctx || !out) return;
    if (!this.ambienceGain) {
      const src = ctx.createBufferSource();
      src.buffer = noiseBuffer(ctx, 4, true);
      src.loop = true;
      const low = ctx.createBiquadFilter();
      low.type = 'lowpass';
      low.frequency.value = 650;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.13;
      const depth = ctx.createGain();
      depth.gain.value = 220;
      lfo.connect(depth).connect(low.frequency);
      this.ambienceGain = ctx.createGain();
      this.ambienceGain.gain.value = 0;
      src.connect(low).connect(this.ambienceGain).connect(out);
      src.start();
      lfo.start();
    }
    const g = this.ambienceGain.gain;
    const t = ctx.currentTime;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(
      this.ambienceWanted ? AMBIENCE : 0,
      t + (this.ambienceWanted ? 0.8 : 0.3),
    );
  }

  private sync(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    if (this.audible()) void ctx.resume().catch(() => undefined);
    else void ctx.suspend().catch(() => undefined);
  }
}

/** White noise, or brown noise (softer, like wind or water). */
function noiseBuffer(ctx: AudioContext, seconds: number, brown: boolean): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds);
  // 50 ms more than needed: the loop joins without a click when the start fades in over them.
  const fade = Math.floor(ctx.sampleRate * 0.05);
  const raw = new Float32Array(len + fade);
  // A fixed LCG: the sound is the same every time.
  let seed = 12345;
  let last = 0;
  for (let i = 0; i < raw.length; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const white = seed / 2147483648 - 1;
    last = (last + 0.02 * white) / 1.02;
    raw[i] = brown ? last * 3.5 : white;
  }
  for (let i = 0; i < fade; i++) {
    const k = i / fade;
    raw[i] = (raw[i] as number) * k + (raw[len + i] as number) * (1 - k);
  }
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  buf.getChannelData(0).set(raw.subarray(0, len));
  return buf;
}

/** A short, soft room echo for the convolver. */
function roomEcho(ctx: AudioContext): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * 0.9);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch);
    let seed = 777 + ch * 101;
    for (let i = 0; i < len; i++) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      data[i] = (seed / 2147483648 - 1) * Math.pow(1 - i / len, 3.2);
    }
  }
  return buf;
}
