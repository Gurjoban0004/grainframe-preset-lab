// color.js — Color grading in linear light
// No framework imports. Pure math only.

import { srgbToLinearLUT, linearToSrgbLUT } from './colorspace.js';

function rgbToHsl(r, g, b) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return [0, 0, l];
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) {
    h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  } else if (max === g) {
    h = ((b - r) / d + 2) / 6;
  } else {
    h = ((r - g) / d + 4) / 6;
  }
  return [h * 360, s, l];
}

function hue2rgb(p, q, t) {
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}

function hslToRgb(h, s, l) {
  if (s === 0) return [l, l, l];
  const hNorm = h / 360;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [
    hue2rgb(p, q, hNorm + 1 / 3),
    hue2rgb(p, q, hNorm),
    hue2rgb(p, q, hNorm - 1 / 3),
  ];
}

export function applyColor(imageData, preset) {
  const { rMult = 1, gMult = 1, bMult = 1, saturation = 1, warmth = 0 } = preset;
  const data = imageData.data;
  const len = data.length;

  for (let i = 0; i < len; i += 4) {
    let r = srgbToLinearLUT[data[i]];
    let g = srgbToLinearLUT[data[i + 1]];
    let b = srgbToLinearLUT[data[i + 2]];

    r *= rMult;
    g *= gMult;
    b *= bMult;

    const [h, s, l] = rgbToHsl(r, g, b);
    const newS = Math.min(1, s * saturation);
    const rgb = hslToRgb(h, newS, l);
    r = rgb[0];
    g = rgb[1];
    b = rgb[2];

    r += warmth;
    b -= warmth;

    data[i]     = linearToSrgbLUT[Math.round(Math.min(1, Math.max(0, r)) * 4095)];
    data[i + 1] = linearToSrgbLUT[Math.round(Math.min(1, Math.max(0, g)) * 4095)];
    data[i + 2] = linearToSrgbLUT[Math.round(Math.min(1, Math.max(0, b)) * 4095)];
  }
}
