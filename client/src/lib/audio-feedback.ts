let sharedAudioCtx: AudioContext | null = null;
let sharedCompressor: DynamicsCompressorNode | null = null;

function getAudioCtx(): AudioContext {
  if (!sharedAudioCtx || sharedAudioCtx.state === "closed") {
    sharedAudioCtx = new AudioContext();
    sharedCompressor = null;
  }
  if (sharedAudioCtx.state === "suspended") {
    sharedAudioCtx.resume();
  }
  return sharedAudioCtx;
}

function getCompressor(ctx: AudioContext): DynamicsCompressorNode {
  if (!sharedCompressor) {
    sharedCompressor = ctx.createDynamicsCompressor();
    sharedCompressor.threshold.value = -3;
    sharedCompressor.knee.value = 3;
    sharedCompressor.ratio.value = 4;
    sharedCompressor.attack.value = 0.001;
    sharedCompressor.release.value = 0.08;
    sharedCompressor.connect(ctx.destination);
  }
  return sharedCompressor;
}

function playTone(
  ctx: AudioContext,
  freq: number,
  gainVal: number,
  startTime: number,
  duration: number
) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain);
  gain.connect(getCompressor(ctx));

  osc.type = "sine";
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0, startTime);
  gain.gain.linearRampToValueAtTime(gainVal, startTime + 0.005);
  gain.gain.setValueAtTime(gainVal, startTime + duration - 0.015);
  gain.gain.linearRampToValueAtTime(0, startTime + duration);

  osc.start(startTime);
  osc.stop(startTime + duration + 0.01);
}

export type BeepType = "success" | "error" | "warning" | "scan" | "complete";

export function playBeep(type: BeepType) {
  try {
    const ctx = getAudioCtx();
    const t = ctx.currentTime;

    if (type === "scan") {
      playTone(ctx, 720, 0.6, t, 0.07);
    } else if (type === "success") {
      playTone(ctx, 880,  0.65, t,        0.09);
      playTone(ctx, 1320, 0.65, t + 0.10, 0.13);
    } else if (type === "error") {
      playTone(ctx, 220, 0.75, t,        0.18);
      playTone(ctx, 180, 0.75, t + 0.20, 0.22);
    } else if (type === "warning") {
      playTone(ctx, 520, 0.65, t,        0.14);
      playTone(ctx, 390, 0.65, t + 0.18, 0.18);
    } else if (type === "complete") {
      playTone(ctx, 523, 0.60, t,        0.10);
      playTone(ctx, 659, 0.60, t + 0.12, 0.10);
      playTone(ctx, 784, 0.65, t + 0.24, 0.17);
    }
  } catch {}
}

const STORAGE_KEY = "stoker_sound_enabled";

export function getSoundEnabled(): boolean {
  try {
    const val = localStorage.getItem(STORAGE_KEY);
    return val !== "false";
  } catch {
    return true;
  }
}

export function setSoundEnabled(enabled: boolean) {
  try {
    localStorage.setItem(STORAGE_KEY, String(enabled));
  } catch {}
}

export function beep(type: BeepType) {
  if (getSoundEnabled()) playBeep(type);
}
