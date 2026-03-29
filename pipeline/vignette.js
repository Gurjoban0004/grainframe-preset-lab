// vignette.js — Radial vignette in linear light, multiply blend
// No framework imports.

import { srgbToLinearLUT, linearToSrgbLUT } from './colorspace.js';

/**
 * Apply radial vignette to ImageData in-place.
 * Operates in linear light. Multiply blend: pixel *= 1 - intensity * falloff.
 * Inner radius = 50% of shorter dim, outer = 75% of longer dim.
 * Max corner darkness capped at 25%.
 * @param {ImageData} imageData
 * @param {object} preset  { vignetteIntensity }
 */
export function applyVignette(imageData, preset) {
  const intensity = Math.min(1, Math.max(0, preset.vignetteIntensity ?? 0.5));
  if (intensity === 0) return;

  const { width, height } = imageData;
  const cx = width / 2;
  const cy = height / 2;
  const shorter = Math.min(width, height);
  const longer  = Math.max(width, height);
  const innerR  = shorter * 0.5;
  const outerR  = longer  * 0.75;
  const range   = outerR - innerR;

  // Max falloff at corners — no cap, preset value is the limit
  const effectiveIntensity = intensity;

  const d = imageData.data;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dx = x - cx, dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const falloff = Math.min(1, Math.max(0, (dist - innerR) / range));
      if (falloff === 0) continue;

      const mul = 1 - effectiveIntensity * falloff;
      const i = (y * width + x) * 4;

      // sRGB → linear → multiply → linear → sRGB
      const r = srgbToLinearLUT[d[i]]     * mul;
      const g = srgbToLinearLUT[d[i + 1]] * mul;
      const b = srgbToLinearLUT[d[i + 2]] * mul;

      d[i]     = linearToSrgbLUT[Math.min(4095, Math.round(Math.min(1, r) * 4095))];
      d[i + 1] = linearToSrgbLUT[Math.min(4095, Math.round(Math.min(1, g) * 4095))];
      d[i + 2] = linearToSrgbLUT[Math.min(4095, Math.round(Math.min(1, b) * 4095))];
    }
  }
}
