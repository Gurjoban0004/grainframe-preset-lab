/**
 * Generate a tileable, pre-blurred noise texture for film grain.
 * 256×256 single-channel (R8) texture.
 *
 * Box-blurred 3×3 to mimic silver halide crystal clumping.
 * Wraps at edges for seamless tiling.
 *
 * @param {number} size — texture dimension (default 256)
 * @returns {Uint8Array} — single-channel pixel data
 */
export function generateGrainTexture(size = 256) {
  // Seeded PRNG for reproducibility
  let seed = 12345;
  function random() {
    seed = (seed * 16807 + 0) % 2147483647;
    return (seed & 0x7fffffff) / 0x7fffffff;
  }

  // Generate base noise
  const raw = new Float32Array(size * size);
  for (let i = 0; i < raw.length; i++) {
    raw[i] = random();
  }

  // Box blur 3×3 with wrapping (for tileable output)
  const blurred = new Float32Array(raw.length);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let sum = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = (x + dx + size) % size;
          const ny = (y + dy + size) % size;
          sum += raw[ny * size + nx];
        }
      }
      blurred[y * size + x] = sum / 9.0;
    }
  }

  const output = new Uint8Array(size * size);
  for (let i = 0; i < blurred.length; i++) {
    output[i] = Math.round(blurred[i] * 255);
  }

  return output;
}
