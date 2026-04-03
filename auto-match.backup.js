/**
 * auto-match.js — Grade Extraction Engine for the Preset Lab
 *
 * PHILOSOPHY SHIFT:
 * Previous approach: histogram-match source → reference (scene-dependent, fails
 * when photos have different content).
 *
 * New approach: EXTRACT THE GRADE from the reference photo in absolute terms,
 * then APPLY that grade to the source. This is how professional colorists work.
 *
 * A "grade" consists of:
 *   1. Contrast curve — how the reference compresses/expands tonal ranges
 *      (shadow lift, highlight rolloff, midtone contrast)
 *   2. Color temperature — warm/cool bias
 *   3. Color saturation — how much color is in the image
 *   4. Channel balance — relative R/G/B levels
 *   5. Fade/lift — how much the blacks are lifted (film look)
 *
 * We extract these from the reference's absolute statistics, then build
 * preset parameters that impose those characteristics on the source.
 *
 * Pipeline order (must match exactly):
 *   1. applyColor  — rMult/gMult/bMult (linear), saturation (HSL), warmth (linear)
 *   2. applyVignette
 *   3. applyToneCurve — Catmull-Rom LUT (sRGB)
 *   4. applyGrain
 *   5. applySharpen
 */

// ─── sRGB ↔ Linear ────────────────────────────────────────────────────────────

const S2L = new Float32Array(256);
const L2S = new Uint8Array(4096);
for (let i = 0; i < 256; i++) {
  const n = i / 255;
  S2L[i] = n <= 0.04045 ? n / 12.92 : Math.pow((n + 0.055) / 1.055, 2.4);
}
for (let i = 0; i < 4096; i++) {
  const v = i / 4095;
  L2S[i] = Math.round((v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055) * 255);
}

// ─── In-memory pipeline (mirrors the actual pipeline exactly) ─────────────────

function applyColorInMemory(src, rMult, gMult, bMult, saturation, warmth) {
  const data = new Uint8ClampedArray(src.data);
  for (let i = 0; i < data.length; i += 4) {
    let r = S2L[data[i]] * rMult;
    let g = S2L[data[i+1]] * gMult;
    let b = S2L[data[i+2]] * bMult;
    const maxC = Math.max(r, g, b), minC = Math.min(r, g, b);
    const l = (maxC + minC) / 2, d = maxC - minC;
    if (d > 0.0001 && saturation !== 1) {
      const s = l > 0.5 ? d / (2 - maxC - minC) : d / (maxC + minC);
      const newS = Math.min(1, s * saturation);
      const ratio = newS / s;
      const mid = (maxC + minC) / 2;
      r = mid + (r - mid) * ratio;
      g = mid + (g - mid) * ratio;
      b = mid + (b - mid) * ratio;
    }
    r += warmth; b -= warmth;
    data[i]   = L2S[Math.min(4095, Math.round(Math.max(0, Math.min(1, r)) * 4095))];
    data[i+1] = L2S[Math.min(4095, Math.round(Math.max(0, Math.min(1, g)) * 4095))];
    data[i+2] = L2S[Math.min(4095, Math.round(Math.max(0, Math.min(1, b)) * 4095))];
    data[i+3] = src.data[i+3];
  }
  return new ImageData(data, src.width, src.height);
}

function applyLUTsInMemory(src, lutR, lutG, lutB) {
  const data = new Uint8ClampedArray(src.data);
  for (let i = 0; i < data.length; i += 4) {
    data[i]   = lutR[data[i]];
    data[i+1] = lutG[data[i+1]];
    data[i+2] = lutB[data[i+2]];
  }
  return new ImageData(data, src.width, src.height);
}

// ─── Catmull-Rom LUT builder (mirrors tonecurve.js exactly) ──────────────────

function buildCatmullRomLUT(points) {
  const pts = [...points].sort((a, b) => a[0] - b[0]);
  const p = [[pts[0][0]-1, pts[0][1]], ...pts, [pts[pts.length-1][0]+1, pts[pts.length-1][1]]];
  const lut = new Uint8Array(256);
  for (let x = 0; x < 256; x++) {
    let seg = 1;
    while (seg < p.length-2 && p[seg+1][0] <= x) seg++;
    const p0=p[seg-1], p1=p[seg], p2=p[seg+1], p3=p[Math.min(seg+2,p.length-1)];
    const dx = p2[0]-p1[0], t = dx===0 ? 0 : (x-p1[0])/dx;
    const t2=t*t, t3=t2*t;
    const y = 0.5*((2*p1[1])+(-p0[1]+p2[1])*t+(2*p0[1]-5*p1[1]+4*p2[1]-p3[1])*t2+(-p0[1]+3*p1[1]-3*p2[1]+p3[1])*t3);
    lut[x] = Math.min(255, Math.max(0, Math.round(y)));
  }
  for (let i = 1; i < 256; i++) if (lut[i] < lut[i-1]) lut[i] = lut[i-1];
  return lut;
}

// ─── Histogram tools ──────────────────────────────────────────────────────────

export function computeHistograms(imageData) {
  const { data } = imageData;
  const r = new Uint32Array(256), g = new Uint32Array(256), b = new Uint32Array(256);
  for (let i = 0; i < data.length; i += 4) { r[data[i]]++; g[data[i+1]]++; b[data[i+2]]++; }
  return { r, g, b };
}

export function computeCDF(histogram) {
  const cdf = new Float64Array(256);
  let sum = 0;
  const total = histogram.reduce((a, b) => a + b, 0) || 1;
  for (let i = 0; i < 256; i++) { sum += histogram[i]; cdf[i] = sum / total; }
  return cdf;
}

export function histogramMatch(sourceCDF, referenceCDF) {
  const mapping = new Uint8Array(256);
  for (let i = 0; i < 256; i++) {
    const sv = sourceCDF[i];
    let bestJ = 0, bestDiff = Math.abs(sv - referenceCDF[0]);
    for (let j = 1; j < 256; j++) {
      const diff = Math.abs(sv - referenceCDF[j]);
      if (diff < bestDiff) { bestDiff = diff; bestJ = j; } else break;
    }
    mapping[i] = bestJ;
  }
  return mapping;
}

// ─── Grade Analysis — extract absolute characteristics from a photo ───────────

/**
 * Analyze a photo's "grade" — its absolute tonal and color characteristics.
 * This is scene-independent: we measure what the photo IS, not relative to anything.
 *
 * Returns:
 *   - shadowLift: how much the blacks are lifted (0 = pure black, 0.1 = faded)
 *   - highlightRolloff: where highlights compress (0 = hard clip, 1 = soft roll)
 *   - midtoneContrast: S-curve strength in midtones
 *   - colorTemp: warm/cool bias in linear light (-1 cool, 0 neutral, +1 warm)
 *   - saturation: average colorfulness (0 = B&W, 1 = normal, >1 = vivid)
 *   - channelBalance: { r, g, b } relative channel means (normalized to sum=3)
 *   - tonePercentiles: luminance at p5, p25, p50, p75, p95 (the "S-curve shape")
 *   - channelPercentiles: per-channel p5/p50/p95 (for per-channel curve shaping)
 */
function analyzeGrade(imageData) {
  const { data, width, height } = imageData;
  const n = data.length / 4;

  // Collect luminance and per-channel values
  const lums = new Float32Array(n);
  const rs = new Float32Array(n), gs = new Float32Array(n), bs = new Float32Array(n);
  let sumR = 0, sumG = 0, sumB = 0, sumChroma = 0, sumLum = 0;

  for (let i = 0, pi = 0; i < data.length; i += 4, pi++) {
    const r = S2L[data[i]], g = S2L[data[i+1]], b = S2L[data[i+2]];
    rs[pi] = r; gs[pi] = g; bs[pi] = b;
    const lum = 0.2126*r + 0.7152*g + 0.0722*b;
    lums[pi] = lum;
    sumR += r; sumG += g; sumB += b; sumLum += lum;
    const maxC = Math.max(r,g,b), minC = Math.min(r,g,b);
    sumChroma += maxC - minC;
  }

  const meanR = sumR/n, meanG = sumG/n, meanB = sumB/n;
  const meanLum = sumLum/n, meanChroma = sumChroma/n;

  // Sort for percentiles
  const sortedLum = Float32Array.from(lums).sort();
  const sortedR = Float32Array.from(rs).sort();
  const sortedG = Float32Array.from(gs).sort();
  const sortedB = Float32Array.from(bs).sort();

  const pct = (arr, p) => arr[Math.floor(p * (arr.length-1))];

  // Tonal percentiles in linear light
  const lumP = {
    p2:  pct(sortedLum, 0.02),
    p10: pct(sortedLum, 0.10),
    p25: pct(sortedLum, 0.25),
    p50: pct(sortedLum, 0.50),
    p75: pct(sortedLum, 0.75),
    p90: pct(sortedLum, 0.90),
    p98: pct(sortedLum, 0.98),
  };

  // Per-channel percentiles
  const chP = {
    r: { p2: pct(sortedR,0.02), p50: pct(sortedR,0.50), p98: pct(sortedR,0.98) },
    g: { p2: pct(sortedG,0.02), p50: pct(sortedG,0.50), p98: pct(sortedG,0.98) },
    b: { p2: pct(sortedB,0.02), p50: pct(sortedB,0.50), p98: pct(sortedB,0.98) },
  };

  // Shadow lift: how high are the darkest pixels (p2 luminance)
  const shadowLift = lumP.p2;

  // Highlight rolloff: how compressed are the highlights
  // If p98 is well below 1.0, highlights are rolled off
  const highlightRolloff = lumP.p98;

  // Midtone contrast: ratio of (p75-p25) to what it would be for a linear image
  // Higher = more contrast in midtones
  const midtoneSpread = lumP.p75 - lumP.p25;

  // Color temperature: R/B ratio in linear light
  const colorTemp = (meanR - meanB) / (meanR + meanB + 0.001);

  // Saturation: mean chroma relative to mean luminance
  const saturation = meanChroma / (meanLum + 0.001);

  // Channel balance (normalized)
  const chanSum = meanR + meanG + meanB;
  const channelBalance = {
    r: meanR / (chanSum/3 + 0.001),
    g: meanG / (chanSum/3 + 0.001),
    b: meanB / (chanSum/3 + 0.001),
  };

  return {
    shadowLift, highlightRolloff, midtoneSpread,
    colorTemp, saturation, channelBalance,
    lumP, chP, meanR, meanG, meanB, meanLum, meanChroma,
  };
}

// ─── Build tone curve from grade characteristics ──────────────────────────────

/**
 * Build a tone curve that transforms the source's tonal range to match
 * the reference's tonal characteristics.
 *
 * Key insight: we're not matching histograms (scene-dependent).
 * We're building a curve that:
 *   1. Lifts shadows to match reference's shadow lift
 *   2. Rolls off highlights to match reference's highlight rolloff
 *   3. Adjusts midtone contrast to match reference's midtone spread
 *
 * This is done per-channel to capture color grading in the curves.
 */
function buildGradeCurve(srcGrade, refGrade, channel) {
  const srcP = srcGrade.lumP;
  const refP = refGrade.lumP;
  const srcCh = srcGrade.chP[channel];
  const refCh = refGrade.chP[channel];

  // Convert linear percentiles to sRGB for curve control points
  const linToSrgb = (v) => {
    const c = Math.max(0, Math.min(1, v));
    return Math.round((c <= 0.0031308 ? c*12.92 : 1.055*Math.pow(c,1/2.4)-0.055) * 255);
  };

  // Build 5 control points mapping source tonal positions to reference tonal positions
  // We use the source's percentile positions as X and the reference's as Y
  // This creates a curve that "reshapes" the source to have the reference's tonal distribution

  // For per-channel curves, blend luminance-based and channel-based percentiles
  const blend = 0.6; // 60% channel-specific, 40% luminance-based

  const srcBlack  = linToSrgb(srcCh.p2  * blend + srcP.p2  * (1-blend));
  const srcShadow = linToSrgb(srcCh.p2  * blend + srcP.p10 * (1-blend));
  const srcMid    = linToSrgb(srcCh.p50 * blend + srcP.p50 * (1-blend));
  const srcHigh   = linToSrgb(srcCh.p98 * blend + srcP.p90 * (1-blend));
  const srcWhite  = linToSrgb(srcCh.p98 * blend + srcP.p98 * (1-blend));

  const refBlack  = linToSrgb(refCh.p2  * blend + refP.p2  * (1-blend));
  const refShadow = linToSrgb(refCh.p2  * blend + refP.p10 * (1-blend));
  const refMid    = linToSrgb(refCh.p50 * blend + refP.p50 * (1-blend));
  const refHigh   = linToSrgb(refCh.p98 * blend + refP.p90 * (1-blend));
  const refWhite  = linToSrgb(refCh.p98 * blend + refP.p98 * (1-blend));

  // Build control points: [source_x, reference_y]
  // These tell the pipeline: "when source has value X, output value Y"
  const points = [
    [0,           Math.max(0, refBlack)],
    [srcShadow,   Math.min(255, refShadow)],
    [srcMid,      Math.min(255, refMid)],
    [srcHigh,     Math.min(255, refHigh)],
    [255,         Math.min(255, refWhite)],
  ];

  // Ensure monotonicity and valid range
  for (let i = 1; i < points.length; i++) {
    if (points[i][0] <= points[i-1][0]) points[i][0] = points[i-1][0] + 1;
    if (points[i][1] < points[i-1][1]) points[i][1] = points[i-1][1];
  }
  points[0][0] = 0;
  points[points.length-1][0] = 255;

  return points;
}

// ─── Solve color parameters from grade analysis ───────────────────────────────

/**
 * Derive color parameters by comparing source and reference grades.
 *
 * The key insight: we're not matching per-pixel values, we're matching
 * the STYLE of the grade:
 *   - Color temperature (warm/cool)
 *   - Saturation level
 *   - Channel balance (color cast)
 */
function solveColorFromGrades(srcGrade, refGrade) {
  // Channel multipliers: make source's channel balance match reference's
  // refGrade.channelBalance tells us the relative R/G/B of the reference
  // We want to shift the source's balance to match
  let rMult = refGrade.channelBalance.r / (srcGrade.channelBalance.r + 0.001);
  let gMult = refGrade.channelBalance.g / (srcGrade.channelBalance.g + 0.001);
  let bMult = refGrade.channelBalance.b / (srcGrade.channelBalance.b + 0.001);

  // Normalize by geometric mean
  const geoMean = Math.pow(rMult * gMult * bMult, 1/3);
  if (geoMean > 0.001) { rMult /= geoMean; gMult /= geoMean; bMult /= geoMean; }

  // Clamp
  rMult = Math.max(0.7, Math.min(1.3, rMult));
  gMult = Math.max(0.7, Math.min(1.3, gMult));
  bMult = Math.max(0.7, Math.min(1.3, bMult));

  // Saturation: ratio of reference saturation to source saturation
  let saturation = refGrade.saturation / (srcGrade.saturation + 0.001);
  saturation = Math.max(0.0, Math.min(1.5, saturation));

  // Warmth: difference in color temperature
  let warmth = (refGrade.colorTemp - srcGrade.colorTemp) * 0.15;
  warmth = Math.max(-0.06, Math.min(0.06, warmth));

  // Green shift
  const srcGreenBias = srcGrade.meanG - (srcGrade.meanR + srcGrade.meanB) / 2;
  const refGreenBias = refGrade.meanG - (refGrade.meanR + refGrade.meanB) / 2;
  let greenShift = 0;
  if (refGreenBias > srcGreenBias + 0.003) {
    greenShift = Math.min(0.2, (refGreenBias - srcGreenBias) * 1.5);
  }

  return {
    rMult:      Math.round(rMult * 1000) / 1000,
    gMult:      Math.round(gMult * 1000) / 1000,
    bMult:      Math.round(bMult * 1000) / 1000,
    saturation: Math.round(saturation * 1000) / 1000,
    warmth:     Math.round(warmth * 10000) / 10000,
    greenShift: Math.round(greenShift * 1000) / 1000,
  };
}

// ─── Control point fitting ────────────────────────────────────────────────────

function fitControlPoints(targetLUT) {
  const xPositions = [0, 16, 32, 48, 64, 80, 96, 112, 128, 144, 160, 176, 192, 208, 224, 240, 255];
  let points = xPositions.map(x => [x, targetLUT[x]]);
  for (let pass = 0; pass < 20; pass++) {
    let improved = false;
    for (let pi = 0; pi < points.length; pi++) {
      const x = points[pi][0];
      const lo = Math.max(0, x-20), hi = Math.min(255, x+20);
      const currentY = points[pi][1];
      let bestY = currentY, bestErr = regionErr(points, targetLUT, lo, hi);
      for (let dy = -5; dy <= 5; dy++) {
        if (dy === 0) continue;
        const testY = Math.max(0, Math.min(255, currentY+dy));
        points[pi][1] = testY;
        const err = regionErr(points, targetLUT, lo, hi);
        if (err < bestErr) { bestErr = err; bestY = testY; improved = true; }
      }
      points[pi][1] = bestY;
    }
    if (!improved) break;
  }
  return points;
}

function regionErr(points, targetLUT, lo, hi) {
  const lut = buildCatmullRomLUT(points);
  let err = 0;
  for (let i = lo; i <= hi; i++) { const d = lut[i]-targetLUT[i]; err += d*d; }
  return err;
}

export function extractToneCurves(sourceImageData, referenceImageData) {
  const srcHist = computeHistograms(sourceImageData);
  const refHist = computeHistograms(referenceImageData);
  const result = {};
  for (const ch of ['r', 'g', 'b']) {
    const lut = histogramMatch(computeCDF(srcHist[ch]), computeCDF(refHist[ch]));
    result[ch] = fitControlPoints(lut);
  }
  return result;
}

// ─── Grain & Vignette ─────────────────────────────────────────────────────────

export function estimateGrain(imageData) {
  const { data, width, height } = imageData;
  const lum = new Float32Array(width * height);
  for (let i = 0; i < lum.length; i++) {
    const idx = i * 4;
    lum[i] = (data[idx]*0.299 + data[idx+1]*0.587 + data[idx+2]*0.114) / 255;
  }
  let grainEnergy = 0, smoothPixels = 0;
  const step = Math.max(1, Math.floor(Math.sqrt(width * height / 10000)));
  for (let y = 2; y < height-2; y += step) {
    for (let x = 2; x < width-2; x += step) {
      const idx = y * width + x;
      const gx = Math.abs(lum[idx+1] - lum[idx-1]);
      const gy = Math.abs(lum[idx+width] - lum[idx-width]);
      if (gx + gy < 0.05) {
        grainEnergy += Math.abs(4*lum[idx] - lum[idx-1] - lum[idx+1] - lum[idx-width] - lum[idx+width]);
        smoothPixels++;
      }
    }
  }
  if (smoothPixels < 100) return { intensity: 0.02, size: 1.0 };
  const avg = grainEnergy / smoothPixels;
  const intensity = Math.round(Math.min(0.08, Math.max(0, (avg - 0.005) * 1.5)) * 1000) / 1000;
  const size = intensity > 0.06 ? 2.0 : intensity > 0.05 ? 1.8 : intensity > 0.04 ? 1.5 : 1.0;
  return { intensity, size };
}

export function detectVignette(imageData) {
  const { data, width, height } = imageData;
  const cx = width/2, cy = height/2;
  const maxDist = Math.sqrt(cx*cx + cy*cy);
  const rings = [0,0,0,0,0], counts = [0,0,0,0,0];
  const step = Math.max(1, Math.floor(Math.sqrt(width*height/5000)));
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const dist = Math.sqrt((x-cx)**2 + (y-cy)**2) / maxDist;
      const idx = (y*width+x)*4;
      const lum = (data[idx]*0.299 + data[idx+1]*0.587 + data[idx+2]*0.114) / 255;
      const ring = Math.min(4, Math.floor(dist*5));
      rings[ring] += lum; counts[ring]++;
    }
  }
  const avg = rings.map((s,i) => counts[i] > 0 ? s/counts[i] : 0);
  if (avg[0] < 0.01) return { intensity: 0 };
  const ratio = 1 - (avg[4] / avg[0]);
  return { intensity: Math.round(Math.max(0, Math.min(0.65, ratio * 1.5)) * 100) / 100 };
}

// ─── Main autoMatch ───────────────────────────────────────────────────────────

/**
 * autoMatch — Grade extraction + application
 *
 * Strategy:
 * 1. Analyze both photos' grades (absolute tonal/color characteristics)
 * 2. Solve color params from grade comparison (scene-independent)
 * 3. Apply color params to source in memory
 * 4. Build tone curves from grade-based percentile mapping
 *    (not histogram matching — this is scene-independent)
 * 5. Verify with histogram matching as a refinement pass
 *
 * The grade-based approach works because:
 * - Shadow lift is an absolute property (how high are the darkest pixels)
 * - Highlight rolloff is absolute (where do highlights compress)
 * - Color temperature is absolute (R/B ratio)
 * - Saturation is absolute (chroma/luminance ratio)
 * These don't depend on what's in the photo.
 */
export function autoMatch(sourceImageData, referenceImageData, options = {}) {
  const {
    matchCurves = true,
    matchColor = true,
    matchGrain = true,
    matchVignette = true,
  } = options;

  let colorParams = { rMult: 1, gMult: 1, bMult: 1, saturation: 1, warmth: 0, greenShift: 0 };
  let toneCurve = {
    r: [[0,0],[128,128],[255,255]],
    g: [[0,0],[128,128],[255,255]],
    b: [[0,0],[128,128],[255,255]],
  };

  // Analyze both photos' grades
  const srcGrade = analyzeGrade(sourceImageData);
  const refGrade = analyzeGrade(referenceImageData);

  if (matchColor) {
    // Solve color params from grade comparison
    colorParams = solveColorFromGrades(srcGrade, refGrade);
  }

  if (matchCurves) {
    // Apply color to source, then build grade-based tone curves
    const colorCorrected = matchColor
      ? applyColorInMemory(sourceImageData, colorParams.rMult, colorParams.gMult,
          colorParams.bMult, colorParams.saturation, colorParams.warmth)
      : sourceImageData;

    // Analyze the color-corrected source
    const correctedGrade = analyzeGrade(colorCorrected);

    // Build grade-based curves (percentile mapping — scene-independent)
    const gradeCurveR = buildGradeCurve(correctedGrade, refGrade, 'r');
    const gradeCurveG = buildGradeCurve(correctedGrade, refGrade, 'g');
    const gradeCurveB = buildGradeCurve(correctedGrade, refGrade, 'b');

    // Also compute histogram-match curves for comparison
    const srcHist = computeHistograms(colorCorrected);
    const refHist = computeHistograms(referenceImageData);
    const histLutR = histogramMatch(computeCDF(srcHist.r), computeCDF(refHist.r));
    const histLutG = histogramMatch(computeCDF(srcHist.g), computeCDF(refHist.g));
    const histLutB = histogramMatch(computeCDF(srcHist.b), computeCDF(refHist.b));

    // Blend grade-based and histogram-based curves
    // Grade-based: scene-independent, captures the "style"
    // Histogram-based: scene-dependent, but captures fine tonal detail
    // Blend 70% grade + 30% histogram for best of both worlds
    const blendLUT = (gradePts, histLut, blendFactor) => {
      const gradeLut = buildCatmullRomLUT(gradePts);
      const blended = new Uint8Array(256);
      for (let i = 0; i < 256; i++) {
        blended[i] = Math.round(gradeLut[i] * blendFactor + histLut[i] * (1 - blendFactor));
      }
      // Ensure monotonicity
      for (let i = 1; i < 256; i++) if (blended[i] < blended[i-1]) blended[i] = blended[i-1];
      return blended;
    };

    const blendedR = blendLUT(gradeCurveR, histLutR, 0.7);
    const blendedG = blendLUT(gradeCurveG, histLutG, 0.7);
    const blendedB = blendLUT(gradeCurveB, histLutB, 0.7);

    // Fit control points to the blended LUTs
    toneCurve = {
      r: fitControlPoints(blendedR),
      g: fitControlPoints(blendedG),
      b: fitControlPoints(blendedB),
    };

    // Refinement pass: apply curves to color-corrected source, re-solve color
    if (matchColor) {
      const lutR = buildCatmullRomLUT(toneCurve.r);
      const lutG = buildCatmullRomLUT(toneCurve.g);
      const lutB = buildCatmullRomLUT(toneCurve.b);
      const doublyCorrected = applyLUTsInMemory(colorCorrected, lutR, lutG, lutB);
      const dcGrade = analyzeGrade(doublyCorrected);
      const refinedColor = solveColorFromGrades(dcGrade, refGrade);

      // Apply a fraction of the refinement (avoid overcorrection)
      const blend = 0.4;
      colorParams.rMult     = Math.round(Math.max(0.7, Math.min(1.3, colorParams.rMult * (1 + (refinedColor.rMult-1)*blend))) * 1000) / 1000;
      colorParams.gMult     = Math.round(Math.max(0.7, Math.min(1.3, colorParams.gMult * (1 + (refinedColor.gMult-1)*blend))) * 1000) / 1000;
      colorParams.bMult     = Math.round(Math.max(0.7, Math.min(1.3, colorParams.bMult * (1 + (refinedColor.bMult-1)*blend))) * 1000) / 1000;
      colorParams.saturation = Math.round(Math.max(0, Math.min(1.5, colorParams.saturation * (1 + (refinedColor.saturation-1)*blend))) * 1000) / 1000;
      colorParams.warmth    = Math.round(Math.max(-0.06, Math.min(0.06, colorParams.warmth + refinedColor.warmth*blend)) * 10000) / 10000;
    }
  }

  const grain = matchGrain ? estimateGrain(referenceImageData) : { intensity: 0, size: 1.0 };
  const vignette = matchVignette ? detectVignette(referenceImageData) : { intensity: 0 };

  return {
    id: 'auto-matched',
    name: 'Auto Matched',
    description: 'Generated by auto-matching',
    toneCurve,
    saturation: colorParams.saturation,
    rMult: colorParams.rMult,
    gMult: colorParams.gMult,
    bMult: colorParams.bMult,
    warmth: colorParams.warmth,
    greenShift: colorParams.greenShift,
    grainIntensity: grain.intensity,
    grainSize: grain.size,
    grainSeed: 42,
    vignetteIntensity: vignette.intensity,
    sharpenAmount: 0.15,
    colorAdjust: { ...colorParams },
    grain,
    vignette,
  };
}

// ─── Histogram Drawing ────────────────────────────────────────────────────────

export function drawHistogram(ctx, histogram, color, width, height) {
  const max = Math.max(...histogram);
  if (max === 0) return;
  ctx.beginPath();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  for (let i = 0; i < 256; i++) {
    const x = (i/255)*width, h = (histogram[i]/max)*height;
    if (i === 0) ctx.moveTo(x, height-h); else ctx.lineTo(x, height-h);
  }
  ctx.stroke();
  ctx.lineTo(width, height); ctx.lineTo(0, height); ctx.closePath();
  ctx.fillStyle = color.replace('0.7', '0.12');
  ctx.fill();
}

export function drawBlended(ctx, processedImageData, referenceImageData, blend) {
  ctx.putImageData(processedImageData, 0, 0);
  if (blend > 0.01) {
    const tmp = document.createElement('canvas');
    tmp.width = referenceImageData.width; tmp.height = referenceImageData.height;
    tmp.getContext('2d').putImageData(referenceImageData, 0, 0);
    ctx.globalAlpha = blend;
    ctx.drawImage(tmp, 0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.globalAlpha = 1.0;
    tmp.width = 0; tmp.height = 0;
  }
}
