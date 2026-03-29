// colorspace.js — sRGB ↔ linear light conversion via pre-computed LUTs
// No framework imports. Pure math only.

function srgbToLinear(v) {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function linearToSrgb(v) {
  const c = v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
  return Math.round(Math.min(1, Math.max(0, c)) * 255);
}

// 256-entry LUT: index = 8-bit sRGB value (0–255), value = linear [0.0, 1.0]
export const srgbToLinearLUT = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  srgbToLinearLUT[i] = srgbToLinear(i);
}

// 4096-entry LUT: index = quantized linear value (i/4095), value = 8-bit sRGB
export const linearToSrgbLUT = new Uint8Array(4096);
for (let i = 0; i < 4096; i++) {
  linearToSrgbLUT[i] = linearToSrgb(i / 4095);
}
