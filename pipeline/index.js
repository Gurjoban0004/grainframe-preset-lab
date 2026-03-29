// index.js — Pipeline orchestrator
// Tries WebGL first; falls back to Canvas API pipeline automatically.

import { WebGLRenderer } from './webgl/renderer.js';

// Canvas API pipeline imports (fallback path — unchanged)
import { applyColor }      from './color.js';
import { applyVignette }   from './vignette.js';
import { buildToneCurveLUTs, applyToneCurve } from './tonecurve.js';
import { applyGrain }      from './grain.js';
import { applySharpen }    from './sharpen.js';

// ─── WebGL availability ───────────────────────────────────────────────────────

let glAvailable = null; // null = untested
let glRenderer = null;

function isWebGLAvailable() {
  if (glAvailable !== null) return glAvailable;
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2');
    glAvailable = !!gl;
    // Release the context immediately
    canvas.width = 0;
    canvas.height = 0;
  } catch {
    glAvailable = false;
  }
  return glAvailable;
}

function getRenderer() {
  if (!glRenderer && isWebGLAvailable()) {
    try {
      glRenderer = new WebGLRenderer();
    } catch (err) {
      console.warn('WebGL renderer init failed, using Canvas fallback:', err);
      glAvailable = false;
    }
  }
  return glRenderer;
}

// ─── Canvas API fallback ──────────────────────────────────────────────────────

/**
 * Process an ImageData through the Canvas API pipeline.
 * This is the original implementation, kept as the fallback path.
 *
 * @param {ImageData} imageData  Source pixels (not mutated; a copy is made)
 * @param {object}    preset
 * @param {object}    options
 * @returns {ImageData}
 */
function processImageCanvas(imageData, preset, options = {}) {
  const data = new Uint8ClampedArray(imageData.data);
  const out  = new ImageData(data, imageData.width, imageData.height);

  applyColor(out, preset);
  applyVignette(out, preset);

  const luts = buildToneCurveLUTs(preset);
  applyToneCurve(out, luts);

  applyGrain(out, preset, options);
  applySharpen(out, preset);

  return out;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Process an ImageData through the full Grainframe pipeline.
 * Uses WebGL when available; falls back to Canvas API automatically.
 *
 * Signature is identical to the previous Canvas-only version so all
 * callers (useImagePipeline, usePresetCache, worker, export) work unchanged.
 *
 * @param {ImageData} imageData  Source pixels
 * @param {object}    preset     Preset configuration object
 * @param {object}    [options]  { mode: 'preview'|'export', previewWidth, exportWidth }
 * @returns {ImageData}
 */
/**
 * Process an ImageData through the full Grainframe pipeline.
 * Uses WebGL when available; falls back to Canvas API automatically.
 *
 * @param {ImageData} imageData  Source pixels
 * @param {object}    preset     Preset configuration object
 * @param {object}    [options]  { mode, previewWidth, exportWidth, forceCanvas }
 * @returns {ImageData}
 */
export function processImage(imageData, preset, options = {}) {
  if (!options.forceCanvas) {
    const renderer = getRenderer();

    console.log('[Pipeline] WebGL available:', isWebGLAvailable());
    console.log('[Pipeline] Renderer:', renderer ? 'WebGLRenderer' : 'null');

    if (renderer) {
      try {
        console.log('[Pipeline] Using WebGL path');
        const result = renderer.process(imageData, preset, options);
        console.log('[Pipeline] WebGL succeeded');
        return result;
      } catch (err) {
        console.warn('[Pipeline] WebGL failed, falling back:', err.message);
      }
    }
  }

  console.log('[Pipeline] Using Canvas fallback');
  return processImageCanvas(imageData, preset, options);
}

/**
 * Returns true if the WebGL pipeline is active.
 * Useful for logging / diagnostics.
 */
export function isWebGLActive() {
  return !!getRenderer();
}
