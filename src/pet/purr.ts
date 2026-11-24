const MUTE_STORAGE_KEY = 'purr-si:muted';

export function readMutedPreference(): boolean {
  try {
    return window.localStorage.getItem(MUTE_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function writeMutedPreference(muted: boolean): void {
  try {
    window.localStorage.setItem(MUTE_STORAGE_KEY, muted ? '1' : '0');
  } catch {
    // Ignore storage errors (private browsing, quota, disabled storage).
  }
}

type AudioContextConstructor = typeof AudioContext;

function getAudioContextCtor(): AudioContextConstructor | null {
  if (typeof window === 'undefined') return null;
  const win = window as Window & {
    AudioContext?: AudioContextConstructor;
    webkitAudioContext?: AudioContextConstructor;
  };
  return win.AudioContext ?? win.webkitAudioContext ?? null;
}

function createBrownNoiseBuffer(
  ctx: AudioContext,
  durationSec = 3,
): AudioBuffer {
  const sampleRate = ctx.sampleRate;
  const length = Math.max(1, Math.floor(sampleRate * durationSec));
  const fadeSamples = Math.min(2048, Math.floor(length / 8));
  const raw = new Float32Array(length + fadeSamples);

  let lastOut = 0;
  for (let i = 0; i < raw.length; i++) {
    const white = Math.random() * 2 - 1;
    lastOut = (lastOut + 0.02 * white) / 1.02;
    raw[i] = lastOut;
  }

  const buffer = ctx.createBuffer(1, length, sampleRate);
  const data = buffer.getChannelData(0);

  let peak = 0;
  for (let i = 0; i < length; i++) {
    let sample = raw[i];
    if (i < fadeSamples) {
      const t = i / fadeSamples;
      sample = raw[i] * t + raw[length + i] * (1 - t);
    }
    data[i] = sample;
    const abs = Math.abs(sample);
    if (abs > peak) peak = abs;
  }

  const norm = peak > 0 ? 0.85 / peak : 1;
  for (let i = 0; i < length; i++) {
    data[i] *= norm;
  }

  return buffer;
}

function tryVibrate(pattern: number | number[]): boolean {
  if (
    typeof navigator === 'undefined' ||
    typeof navigator.vibrate !== 'function'
  ) {
    return false;
  }
  try {
    return navigator.vibrate(pattern);
  } catch {
    return false;
  }
}

export class PurrAudio {
  private ctx: AudioContext | null = null;
  private noiseSource: AudioBufferSourceNode | null = null;
  private lowpass: BiquadFilterNode | null = null;
  private amGain: GainNode | null = null;
  private lfo: OscillatorNode | null = null;
  private lfoDepth: GainNode | null = null;
  private masterGain: GainNode | null = null;

  private muted: boolean;
  private hasGesture = false;
  private destroyed = false;

  private continuousPetTime = 0;
  private petGraceTimer = 0;
  private smoothedSpeed = 0;
  private currentGain = 0;
  private breathPhase = 0;
  private vibrateCooldown = 0;
  private hasVibrated = false;

  constructor(initialMuted = false) {
    this.muted = initialMuted;
  }

  /**
   * Must only be called inside a user gesture handler (pointerdown, pointerup, click, keydown).
   */
  unlock(): void {
    if (this.destroyed) return;

    if (typeof navigator !== 'undefined') {
      const ua = (
        navigator as Navigator & {
          userActivation?: { isActive: boolean; hasBeenActive: boolean };
        }
      ).userActivation;
      if (ua && !ua.isActive && !ua.hasBeenActive) {
        return;
      }
    }

    this.hasGesture = true;

    if (!this.ctx) {
      const Ctor = getAudioContextCtor();
      if (!Ctor) return;
      try {
        const ctx = new Ctor();
        const noiseBuffer = createBrownNoiseBuffer(ctx, 3);
        const noiseSource = ctx.createBufferSource();
        noiseSource.buffer = noiseBuffer;
        noiseSource.loop = true;

        const lowpass = ctx.createBiquadFilter();
        lowpass.type = 'lowpass';
        lowpass.frequency.value = 280;
        lowpass.Q.value = 1.35;

        // Amplitude-modulated gain node driven by 22-28 Hz LFO (the purr pulse)
        const amGain = ctx.createGain();
        amGain.gain.value = 0.56;

        const lfo = ctx.createOscillator();
        lfo.type = 'sine';
        lfo.frequency.value = 24;

        const lfoDepth = ctx.createGain();
        lfoDepth.gain.value = 0.44;

        const masterGain = ctx.createGain();
        masterGain.gain.value = 0;

        noiseSource.connect(lowpass);
        lowpass.connect(amGain);
        amGain.connect(masterGain);
        masterGain.connect(ctx.destination);

        lfo.connect(lfoDepth);
        lfoDepth.connect(amGain.gain);

        noiseSource.start();
        lfo.start();

        this.ctx = ctx;
        this.noiseSource = noiseSource;
        this.lowpass = lowpass;
        this.amGain = amGain;
        this.lfo = lfo;
        this.lfoDepth = lfoDepth;
        this.masterGain = masterGain;
      } catch {
        this.ctx = null;
        return;
      }
    }

    if (this.ctx && this.ctx.state === 'suspended') {
      void this.ctx.resume().catch(() => {
        // Ignore autoplay rejection; next user gesture will retry.
      });
    }
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (muted) {
      if (this.hasVibrated) {
        tryVibrate(0);
        this.hasVibrated = false;
      }
      if (this.ctx && this.masterGain && this.ctx.state === 'running') {
        const now = this.ctx.currentTime;
        this.masterGain.gain.setTargetAtTime(0, now, 0.03);
      }
    }
  }

  isMuted(): boolean {
    return this.muted;
  }

  /**
   * Immediately cut active petting (e.g., on pointer leave or playful nip cooldown)
   * so purring eases out smoothly.
   */
  stopPetting(): void {
    this.petGraceTimer = 0;
    this.continuousPetTime = 0;
  }

  /**
   * Short playful buzz on nip reaction, respecting mute toggle.
   */
  triggerNipHaptic(): void {
    if (this.destroyed || this.muted || !this.hasGesture) return;
    if (tryVibrate([24, 36, 24])) {
      this.hasVibrated = true;
    }
  }

  /**
   * Advance audio envelope and haptics each animation frame.
   * @param dt Seconds since last frame
   * @param isPettingOnCat Whether the pointer/virtual hand moved on the cat this frame
   * @param normalizedSpeed Stroke speed normalized to [0, 1]
   */
  update(dt: number, isPettingOnCat: boolean, normalizedSpeed: number): void {
    if (this.destroyed) return;
    const clampedDt = Math.min(Math.max(dt, 0), 0.1);
    const speedClamped = Math.min(Math.max(normalizedSpeed, 0), 1);

    if (isPettingOnCat) {
      this.petGraceTimer = 0.24;
    } else {
      this.petGraceTimer = Math.max(0, this.petGraceTimer - clampedDt);
    }

    const activelyPetting = this.petGraceTimer > 0;
    if (activelyPetting) {
      this.continuousPetTime += clampedDt;
    } else {
      this.continuousPetTime = 0;
    }

    const speedLerp = 1 - Math.exp(-clampedDt / 0.18);
    const targetSpeed = isPettingOnCat ? speedClamped : 0;
    this.smoothedSpeed += (targetSpeed - this.smoothedSpeed) * speedLerp;

    // Purr starts after ~0.5 s of continuous petting
    const shouldPurr =
      !this.muted && activelyPetting && this.continuousPetTime >= 0.5;

    if (shouldPurr) {
      this.breathPhase += clampedDt * 0.3 * Math.PI * 2;
      const breath = 0.88 + 0.12 * Math.sin(this.breathPhase);
      const targetGain = (0.34 + this.smoothedSpeed * 0.44) * breath;
      const attackLerp = 1 - Math.exp(-clampedDt / 0.26);
      this.currentGain += (targetGain - this.currentGain) * attackLerp;
    } else {
      // Ease out ~0.8 s after petting stops (or quickly when muted)
      const tau = this.muted ? 0.03 : 0.25;
      const releaseLerp = 1 - Math.exp(-clampedDt / tau);
      this.currentGain += (0 - this.currentGain) * releaseLerp;
      if (this.currentGain < 0.001) {
        this.currentGain = 0;
      }
    }

    if (
      this.ctx &&
      this.masterGain &&
      this.lowpass &&
      this.lfo &&
      this.ctx.state === 'running'
    ) {
      const now = this.ctx.currentTime;
      const filterFreq = 260 + this.smoothedSpeed * 135; // 260-395 Hz
      const lfoFreq = 22.5 + this.smoothedSpeed * 5.0; // 22.5-27.5 Hz

      this.masterGain.gain.setTargetAtTime(this.currentGain, now, 0.04);
      this.lowpass.frequency.setTargetAtTime(filterFreq, now, 0.08);
      this.lfo.frequency.setTargetAtTime(lfoFreq, now, 0.1);
    }

    // Subtle rhythmic haptic purr pulses while actively purring
    this.vibrateCooldown = Math.max(0, this.vibrateCooldown - clampedDt);
    if (
      this.hasGesture &&
      !this.muted &&
      shouldPurr &&
      this.currentGain > 0.12 &&
      this.vibrateCooldown <= 0
    ) {
      if (tryVibrate(16)) {
        this.hasVibrated = true;
      }
      this.vibrateCooldown = 0.21;
    }
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;

    if (this.hasVibrated) {
      tryVibrate(0);
      this.hasVibrated = false;
    }

    try {
      this.noiseSource?.stop();
    } catch {
      // Already stopped
    }
    try {
      this.lfo?.stop();
    } catch {
      // Already stopped
    }

    this.noiseSource?.disconnect();
    this.lowpass?.disconnect();
    this.amGain?.disconnect();
    this.lfo?.disconnect();
    this.lfoDepth?.disconnect();
    this.masterGain?.disconnect();

    this.noiseSource = null;
    this.lowpass = null;
    this.amGain = null;
    this.lfo = null;
    this.lfoDepth = null;
    this.masterGain = null;

    const ctx = this.ctx;
    this.ctx = null;
    if (ctx && ctx.state !== 'closed') {
      void ctx.close().catch(() => {
        // Ignore close errors during teardown
      });
    }
  }
}
