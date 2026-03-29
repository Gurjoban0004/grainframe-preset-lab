// worker.js — Web Worker entry point for the image processing pipeline
// No framework imports.

import { processImage } from './index.js';
import { prebakeLUTs } from './tonecurve.js';
import classicChrome from '../presets/classic-chrome.json';
import portra from '../presets/portra.json';
import silver from '../presets/silver.json';
import softFilm from '../presets/soft-film.json';
import golden from '../presets/golden.json';
import faded from '../presets/faded.json';
import velvia from '../presets/velvia.json';
import cinema from '../presets/cinema.json';
import darkroom from '../presets/darkroom.json';
import earth from '../presets/earth.json';
import expired from '../presets/expired.json';

// Pre-bake all LUTs at module load time (runs when worker is created)
prebakeLUTs([classicChrome, portra, silver, softFilm, golden, faded, velvia, cinema, darkroom, earth, expired]);

self.onmessage = async function (event) {
  const { type, imageData, preset, mode, previewWidth, exportWidth } = event.data;

  if (type === 'warmup') {
    // Run a tiny pipeline pass to JIT-compile all processing functions
    const tiny = new ImageData(2, 2);
    const warmupPreset = {
      id: '__warmup__',
      toneCurve: { r: [[0,0],[255,255]], g: [[0,0],[255,255]], b: [[0,0],[255,255]] },
      colorAdjust: { saturation: 1, rMult: 1, gMult: 1, bMult: 1, warmth: 0 },
      grain: { intensity: 0, size: 1 },
      vignette: { intensity: 0 },
      sharpen: { amount: 0 },
    };
    try {
      processImage(tiny, warmupPreset, { mode: 'preview' });
    } catch {
      // ignore warmup errors
    }
    self.postMessage({ type: 'warmup-done' });
    return;
  }

  try {
    const result = processImage(imageData, preset, { mode, previewWidth, exportWidth });
    self.postMessage({ imageData: result }, [result.data.buffer]);
  } catch (err) {
    self.postMessage({ error: err instanceof Error ? err.message : String(err) });
  }
};
