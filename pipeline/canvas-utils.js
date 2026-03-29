// canvas-utils.js — OffscreenCanvas + Display P3 context helpers
// No framework imports.

export function createCanvas(width, height) {
  if (typeof OffscreenCanvas !== 'undefined') {
    return new OffscreenCanvas(width, height);
  }
  // Fallback for environments without OffscreenCanvas (e.g. main thread Safari)
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

export function getContext(canvas, options = {}) {
  // Attempt Display P3 wide-gamut context first
  try {
    const ctx = canvas.getContext('2d', { colorSpace: 'display-p3', ...options });
    if (ctx) return ctx;
  } catch (_) {
    // Display P3 not supported — fall through
  }
  return canvas.getContext('2d', options);
}
