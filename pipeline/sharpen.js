// sharpen.js — Unsharp mask in sRGB space
// No framework imports.

import { createCanvas, getContext } from './canvas-utils.js';

/**
 * Apply unsharp mask to ImageData in-place (sRGB space).
 * output = original + (original - blurred) * amount
 * @param {ImageData} imageData
 * @param {object} preset  { sharpenAmount }
 */
export function applySharpen(imageData, preset) {
  const MAX_AMOUNT = 0.3;
  const amount = Math.min(MAX_AMOUNT, Math.max(0, preset.sharpenAmount ?? 0));
  if (amount === 0) return;

  const { width, height } = imageData;

  // Blur pass via ctx.filter
  const canvas = createCanvas(width, height);
  const ctx = getContext(canvas);
  ctx.putImageData(imageData, 0, 0);

  const blurCanvas = createCanvas(width, height);
  const blurCtx = getContext(blurCanvas);
  if (typeof blurCtx.filter !== 'undefined') {
    blurCtx.filter = 'blur(1px)';
  }
  blurCtx.drawImage(canvas, 0, 0);
  const blurred = blurCtx.getImageData(0, 0, width, height);

  const d  = imageData.data;
  const bd = blurred.data;

  for (let i = 0; i < d.length; i += 4) {
    d[i]     = Math.min(255, Math.max(0, d[i]     + (d[i]     - bd[i])     * amount));
    d[i + 1] = Math.min(255, Math.max(0, d[i + 1] + (d[i + 1] - bd[i + 1]) * amount));
    d[i + 2] = Math.min(255, Math.max(0, d[i + 2] + (d[i + 2] - bd[i + 2]) * amount));
  }
}
