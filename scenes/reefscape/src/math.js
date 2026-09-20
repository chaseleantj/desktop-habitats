// Scene coordinates: one unit = 0.10 m. No frame-rate-dependent randomness.
export const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export { randomGenerator } from '../../shared/random.js';
export function noise(x, y, z) {
  return Math.sin(x * 2.37 + Math.sin(z * 3.1)) * Math.sin(y * 2.73 + z * .73) * .55
    + Math.sin(x * 5.7 - y * 4.1 + z * 3.8) * .24 + Math.sin(x * 12.3 + y * 8.9 - z * 11.2) * .09;
}
export function groundHeight(x, z) {
  return -.30 + .12 * Math.sin(x * .49 + z * .22) + .075 * Math.sin(z * .75 - x * .25)
    + .25 * Math.exp(-((x - 6) ** 2 / 17 + (z + 1) ** 2 / 13));
}
export function limitVector(v, max) { const l = v.length(); if (l > max) v.multiplyScalar(max / l); return v; }
