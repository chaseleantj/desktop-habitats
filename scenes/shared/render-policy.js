export function framebufferSize(width, height, scale, maxDimension = 8192, maxPixels = Infinity) {
  if (!(width > 0 && height > 0 && scale > 0)) return null;
  const safeScale = Math.min(scale, maxDimension / width, maxDimension / height, Math.sqrt(maxPixels / (width * height)));
  return {
    width: Math.max(1, Math.round(width * safeScale)),
    height: Math.max(1, Math.round(height * safeScale)),
    scale: safeScale,
  };
}

// Presentation cadence is shared; scene-specific lighting and geometry stay local.
export const QUALITY_PRESETS = Object.freeze({
  eco: Object.freeze({ fps: 20, pixels: 1050000, dpr: 1 }),
  balanced: Object.freeze({ fps: 30, pixels: 1800000, dpr: 1.25 }),
  detail: Object.freeze({ fps: 60, pixels: 3000000, dpr: 1.5 }),
});

export function qualityName(value) {
  return Object.hasOwn(QUALITY_PRESETS, value) ? value : 'balanced';
}

export function frameRate(quality, requested = 60, onBattery = false) {
  if (!Number.isFinite(requested) || requested <= 0) return 0;
  return Math.min(QUALITY_PRESETS[qualityName(quality)].fps, requested, onBattery ? 30 : 60);
}

export function renderScale(quality, pixelRatio = 1, onBattery = false) {
  const dpr = Number.isFinite(pixelRatio) && pixelRatio > 0 ? pixelRatio : 1;
  return Math.min(dpr, QUALITY_PRESETS[qualityName(quality)].dpr) * (onBattery ? 0.9 : 1);
}
