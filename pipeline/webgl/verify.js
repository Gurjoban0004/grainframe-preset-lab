/**
 * Parity verification utility — compare WebGL vs Canvas pipeline output.
 * Use in test-pipeline.html during development.
 */
import { WebGLRenderer } from './renderer.js';
import { processImage as processImageCanvas } from '../index.js';

/**
 * Compare WebGL and Canvas outputs for the same input.
 * Returns the maximum per-channel difference across all pixels.
 * Acceptable: maxDiff <= 3 (float precision rounding).
 *
 * @param {ImageData} imageData
 * @param {object} preset
 * @returns {Promise<number>} maxDiff
 */
export async function verifyParity(imageData, preset) {
  const renderer = new WebGLRenderer();

  const cloneA = new ImageData(
    new Uint8ClampedArray(imageData.data),
    imageData.width,
    imageData.height
  );
  const cloneB = new ImageData(
    new Uint8ClampedArray(imageData.data),
    imageData.width,
    imageData.height
  );

  const webglResult = renderer.process(cloneA, preset, { mode: 'preview' });
  const canvasResult = processImageCanvas(cloneB, preset, { mode: 'preview' });

  renderer.destroy();

  let maxDiff = 0;
  for (let i = 0; i < webglResult.data.length; i++) {
    const diff = Math.abs(webglResult.data[i] - canvasResult.data[i]);
    if (diff > maxDiff) maxDiff = diff;
  }

  console.log(`[verifyParity] preset=${preset.id} maxDiff=${maxDiff}/255`);
  return maxDiff;
}
