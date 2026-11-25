/** Haptic and Web Audio payment feedback helpers (§3.13). */

export type AudioPref = 'bell' | 'drum' | 'silent';
const AUDIO_KEY = 'paidar.audio';

export function readAudioPref(): AudioPref {
  try {
    const v = localStorage.getItem(AUDIO_KEY);
    return v === 'bell' || v === 'drum' || v === 'silent' ? v : 'bell';
  } catch {
    return 'bell';
  }
}

export function writeAudioPref(pref: AudioPref): void {
  try {
    localStorage.setItem(AUDIO_KEY, pref);
  } catch {
    /* storage unavailable */
  }
}

export function vibrate(pattern: number | number[]): void {
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate(pattern);
    }
  } catch {
    /* ignore */
  }
}

export function hapticCopy(): void {
  vibrate(12);
}

export function hapticClaim(): void {
  vibrate(20);
}

export function hapticPaidPing(): void {
  vibrate([30, 40, 90]);
  playPaymentAudio(readAudioPref());
}

export function hapticError(): void {
  vibrate([40, 30, 40]);
}

export function hapticHoldComplete(): void {
  vibrate([20, 30, 60]);
}

export function playPaymentAudio(pref: AudioPref): void {
  if (pref === 'silent' || typeof window === 'undefined') return;
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;

    if (pref === 'bell') {
      // Subtle warm dual chime
      [880, 1318.5].forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now + i * 0.08);
        gain.gain.setValueAtTime(0.001, now + i * 0.08);
        gain.gain.exponentialRampToValueAtTime(0.08, now + i * 0.08 + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.08 + 0.45);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + i * 0.08);
        osc.stop(now + i * 0.08 + 0.5);
      });
    } else if (pref === 'drum') {
      // Deep warm resonant thump
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(140, now);
      osc.frequency.exponentialRampToValueAtTime(52, now + 0.22);
      gain.gain.setValueAtTime(0.18, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.28);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.3);
    }
    setTimeout(() => void ctx.close().catch(() => {}), 700);
  } catch {
    /* ignore audio errors / autoplay block */
  }
}
