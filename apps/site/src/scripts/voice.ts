/**
 * A voice-like level, 0–1, for someone talking for `length` seconds:
 * syllables in bursts, a breath now and then, silence at both ends.
 */
export function voiceLevel(t: number, length: number): number {
  if (t <= 0 || t >= length) return 0;
  const syllables = Math.abs(Math.sin(t * 9.1) * Math.sin(t * 4.3 + 1)) ** 0.6;
  const breath = 0.65 + 0.35 * Math.sin(t * 1.7);
  const envelope = Math.min(1, t / 0.15, (length - t) / 0.3);
  return Math.min(1, syllables * breath * envelope * 1.15);
}

/** True when the visitor asked their system for less motion. */
export const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
