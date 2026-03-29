// blur.js — Gaussian blur helper (GPU via ctx.filter, fallback to box blur)
// No framework imports.

import { createCanvas, getContext } from './canvas-utils.js';

/**
 * Blur an ImageData by `radius` pixels.
 * Uses ctx.filter = 'blur()' when available; falls back to 3-pass box blur.
 * @param {ImageData} imageData
 * @param {number} radius
 * @returns {ImageData}
 */
export function gaussianBlur(imageData, radius) {
  const { width, height } = imageData;
  const canvas = createCanvas(width, height);
  const ctx = getContext(canvas);

  if (typeof ctx.filter !== 'undefined') {
    ctx.filter = `blur(${radius}px)`;
    ctx.putImageData(imageData, 0, 0);
    // Draw onto itself with filter applied
    const tmp = createCanvas(width, height);
    const tmpCtx = getContext(tmp);
    tmpCtx.filter = `blur(${radius}px)`;
    tmpCtx.drawImage(canvas, 0, 0);
    return tmpCtx.getImageData(0, 0, width, height);
  }

  // Fallback: 3-pass horizontal + vertical box blur
  return boxBlur3Pass(imageData, radius);
}

function boxBlur3Pass(imageData, radius) {
  let data = new Uint8ClampedArray(imageData.data);
  const { width, height } = imageData;
  for (let pass = 0; pass < 3; pass++) {
    data = boxBlurH(data, width, height, radius);
    data = boxBlurV(data, width, height, radius);
  }
  return new ImageData(data, width, height);
}

function boxBlurH(src, width, height, r) {
  const dst = new Uint8ClampedArray(src.length);
  const iarr = 1 / (r + r + 1);
  for (let i = 0; i < height; i++) {
    let ti = i * width * 4;
    let li = ti;
    let ri = ti + r * 4;
    const fv = [src[ti], src[ti + 1], src[ti + 2], src[ti + 3]];
    const lv = [src[ti + (width - 1) * 4], src[ti + (width - 1) * 4 + 1], src[ti + (width - 1) * 4 + 2], src[ti + (width - 1) * 4 + 3]];
    let val = [fv[0] * (r + 1), fv[1] * (r + 1), fv[2] * (r + 1), fv[3] * (r + 1)];
    for (let j = 0; j < r; j++) {
      for (let c = 0; c < 4; c++) val[c] += src[ti + j * 4 + c];
    }
    for (let j = 0; j <= r; j++) {
      for (let c = 0; c < 4; c++) {
        val[c] += src[ri + c] - fv[c];
        dst[ti + c] = Math.round(val[c] * iarr);
      }
      ri += 4; ti += 4;
    }
    for (let j = r + 1; j < width - r; j++) {
      for (let c = 0; c < 4; c++) {
        val[c] += src[ri + c] - src[li + c];
        dst[ti + c] = Math.round(val[c] * iarr);
      }
      ri += 4; li += 4; ti += 4;
    }
    for (let j = width - r; j < width; j++) {
      for (let c = 0; c < 4; c++) {
        val[c] += lv[c] - src[li + c];
        dst[ti + c] = Math.round(val[c] * iarr);
      }
      li += 4; ti += 4;
    }
  }
  return dst;
}

function boxBlurV(src, width, height, r) {
  const dst = new Uint8ClampedArray(src.length);
  const iarr = 1 / (r + r + 1);
  for (let i = 0; i < width; i++) {
    let ti = i * 4;
    let li = ti;
    let ri = ti + r * width * 4;
    const fv = [src[ti], src[ti + 1], src[ti + 2], src[ti + 3]];
    const lv = [src[ti + (height - 1) * width * 4], src[ti + (height - 1) * width * 4 + 1], src[ti + (height - 1) * width * 4 + 2], src[ti + (height - 1) * width * 4 + 3]];
    let val = [fv[0] * (r + 1), fv[1] * (r + 1), fv[2] * (r + 1), fv[3] * (r + 1)];
    for (let j = 0; j < r; j++) {
      for (let c = 0; c < 4; c++) val[c] += src[ti + j * width * 4 + c];
    }
    for (let j = 0; j <= r; j++) {
      for (let c = 0; c < 4; c++) {
        val[c] += src[ri + c] - fv[c];
        dst[ti + c] = Math.round(val[c] * iarr);
      }
      ri += width * 4; ti += width * 4;
    }
    for (let j = r + 1; j < height - r; j++) {
      for (let c = 0; c < 4; c++) {
        val[c] += src[ri + c] - src[li + c];
        dst[ti + c] = Math.round(val[c] * iarr);
      }
      ri += width * 4; li += width * 4; ti += width * 4;
    }
    for (let j = height - r; j < height; j++) {
      for (let c = 0; c < 4; c++) {
        val[c] += lv[c] - src[li + c];
        dst[ti + c] = Math.round(val[c] * iarr);
      }
      li += width * 4; ti += width * 4;
    }
  }
  return dst;
}
