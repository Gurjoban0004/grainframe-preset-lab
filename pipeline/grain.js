// grain.js — Luminance-dependent film grain with seeded PRNG
// No framework imports.

import { createCanvas, getContext } from './canvas-utils.js';
import { gaussianBlur } from './blur.js';

// Mulberry32 — fast seeded PRNG
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

/**
 * Apply film grain to ImageData in-place (sRGB space).
 * @param {ImageData} imageData
 * @param {object} preset  { grainIntensity, grainSize, grainSeed }
 * @param {object} options { mode: 'preview'|'export', previewWidth, exportWidth }
 */
export function applyGrain(imageData, preset, options = {}) {
  const intensity = Math.max(0, preset.grainIntensity ?? 0.02);
  if (intensity === 0) return;

  const { width, height } = imageData;
  const seed = preset.grainSeed ?? 42;

  // Scale grain size for export vs preview
  const previewWidth  = options.previewWidth  ?? width;
  const exportWidth   = options.exportWidth   ?? width;
  const resolutionRatio = options.mode === 'export' ? exportWidth / previewWidth : 1;
  const baseSize = preset.grainSize ?? 1;
  const blurRadius = Math.max(0.5, baseSize * resolutionRatio);

  // Generate noise field on a canvas
  const noiseCanvas = createCanvas(width, height);
  const noiseCtx = getContext(noiseCanvas);
  const noiseData = noiseCtx.createImageData(width, height);
  const nd = noiseData.data;
  const rand = mulberry32(seed);

  for (let i = 0; i < nd.length; i += 4) {
    const v = Math.round(rand() * 255);
    nd[i] = nd[i + 1] = nd[i + 2] = v;
    nd[i + 3] = 255;
  }
  noiseCtx.putImageData(noiseData, 0, 0);

  // Blur the noise field
  let blurred;
  const blurCanvas = createCanvas(width, height);
  const blurCtx = getContext(blurCanvas);
  if (typeof blurCtx.filter !== 'undefined') {
    blurCtx.filter = `blur(${blurRadius}px)`;
    blurCtx.drawImage(noiseCanvas, 0, 0);
    blurred = blurCtx.getImageData(0, 0, width, height);
  } else {
    // Fallback: use software gaussian blur
    const noiseImageData = noiseCtx.getImageData(0, 0, width, height);
    blurred = gaussianBlur(noiseImageData, blurRadius);
  }
  const bd = blurred.data;

  // Apply grain to image
  const isMonochrome = (preset.saturation ?? 1) < 0.05;
  const d = imageData.data;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2];

    // Luminance (sRGB approximation)
    const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    // Shadows get more grain: scale inversely with luminance
    const lumScale = 1 - lum * 0.7;

    // Noise value centered at 0 (-0.5 to 0.5)
    const noise = (bd[i] / 255) - 0.5;

    if (isMonochrome) {
      // Same grain on all channels — no colored speckles in B&W
      const grainValue = noise * intensity * lumScale * 255;
      d[i]     = Math.min(255, Math.max(0, r + grainValue));
      d[i + 1] = Math.min(255, Math.max(0, g + grainValue));
      d[i + 2] = Math.min(255, Math.max(0, b + grainValue));
    } else {
      const grainR = noise * intensity * lumScale * 1.1 * 255;
      const grainG = noise * intensity * lumScale * 1.0 * 255;
      const grainB = noise * intensity * lumScale * 1.1 * 255;

      d[i]     = Math.min(255, Math.max(0, r + grainR));
      d[i + 1] = Math.min(255, Math.max(0, g + grainG));
      d[i + 2] = Math.min(255, Math.max(0, b + grainB));
    }
  }
}
