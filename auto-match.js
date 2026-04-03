/**
 * auto-match.js — Style Extraction Engine v4
 *
 * CORE PRINCIPLE: Extract STYLE from reference in isolation,
 * not by comparing pixel values between source and reference.
 *
 * Style = how pixels deviate from "neutral" within each tonal zone.
 * Content = what objects are in the photo.
 * We extract style. We ignore content.
 *
 * Content-independent style markers:
 *   - Black floor / white ceiling (tonal range boundaries)
 *   - Shadow tint (color deviation from neutral in dark pixels)
 *   - Highlight tint (color deviation from neutral in bright pixels)
 *   - Contrast shape (shadow/highlight compression ratios)
 *   - Saturation-vs-luminance profile (how saturation behaves across tonal range)
 *   - Grain, vignette, local contrast (texture characteristics)
 *
 * Content-DEPENDENT (what we avoid):
 *   - Mean color (blue ocean ≠ blue grade)
 *   - Histogram shape (dark scene ≠ dark grade)
 *   - Absolute saturation level (vivid flowers ≠ vivid grade)
 */

// ═══════════════════════════════════════════════════════════════════════════════
// LEGACY EXPORTS (keep for compatibility with existing UI)
// ═══════════════════════════════════════════════════════════════════════════════

export function computeHistograms(imageData) {
  const { data } = imageData;
  const histR = new Uint32Array(256);
  const histG = new Uint32Array(256);
  const histB = new Uint32Array(256);
  for (let i = 0; i < data.length; i += 4) {
    histR[data[i]]++;
    histG[data[i + 1]]++;
    histB[data[i + 2]]++;
  }
  return { r: histR, g: histG, b: histB };
}

export function computeCDF(histogram) {
  const cdf = new Float64Array(256);
  cdf[0] = histogram[0];
  for (let i = 1; i < 256; i++) cdf[i] = cdf[i - 1] + histogram[i];
  return cdf;
}

export function analyzeColor(imageData) {
  const { data } = imageData;
  let sumR = 0, sumG = 0, sumB = 0;
  const n = data.length / 4;
  for (let i = 0; i < data.length; i += 4) {
    sumR += data[i] / 255; sumG += data[i + 1] / 255; sumB += data[i + 2] / 255;
  }
  return { meanR: sumR / n, meanG: sumG / n, meanB: sumB / n };
}

export function deriveColorAdjust(s, r) {
  const rR = (r.meanR + .01) / (s.meanR + .01);
  const gR = (r.meanG + .01) / (s.meanG + .01);
  const bR = (r.meanB + .01) / (s.meanB + .01);
  const a = (rR + gR + bR) / 3;
  return { rMult: rR / a, gMult: gR / a, bMult: bR / a, saturation: 1, warmth: 0, greenShift: 0 };
}

export function extractToneCurves(imageData) {
  const id = [0, 32, 64, 96, 128, 160, 192, 224, 255].map(x => [x, x]);
  return { r: id, g: id.map(p => [...p]), b: id.map(p => [...p]) };
}

export function estimateGrain(imageData) { return analyzeGrainTexture(imageData); }
export function detectVignette(imageData) { return analyzeVignetteProfile(imageData); }

export function drawHistogram(ctx, histogram, color, w, h) {
  const max = Math.max(...histogram) || 1;
  ctx.strokeStyle = color; ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i < 256; i++) {
    const x = (i / 255) * w, y = (histogram[i] / max) * h;
    if (i === 0) ctx.moveTo(x, h - y); else ctx.lineTo(x, h - y);
  }
  ctx.stroke();
  ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath();
  ctx.fillStyle = color.replace(/[\d.]+\)$/, '0.12)');
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
  }
}


// ═══════════════════════════════════════════════════════════════════════════════
// STYLE FINGERPRINT — The Core Innovation
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Extract a content-independent style fingerprint from a single image.
 *
 * This is the key function. It analyzes ONE image and produces a
 * description of its STYLE — how it was graded/processed — separate
 * from its CONTENT — what objects are in the photo.
 *
 * It does this by looking at HOW pixels deviate from neutral within
 * each tonal zone, not at what colors are present.
 */
function extractStyleFingerprint(imageData) {
  const { data, width, height } = imageData;
  const n = width * height;
  const step = Math.max(1, Math.floor(n / 50000));

  // ── Collect all pixel data in one pass ──
  const pixels = [];
  for (let i = 0; i < data.length; i += 4 * step) {
    const r = data[i] / 255;
    const g = data[i + 1] / 255;
    const b = data[i + 2] / 255;
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const chroma = max - min;
    const sat = max > 0.001 ? chroma / max : 0;

    pixels.push({ r, g, b, lum, sat, chroma });
  }

  // Sort by luminance for percentile calculations
  const sorted = [...pixels].sort((a, b) => a.lum - b.lum);
  const pct = (p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];

  // ── 1. Tonal Range (completely content-independent) ──
  const blackFloor = pct(0.01).lum;
  const blackPoint = pct(0.03).lum;
  const whitePoint = pct(0.97).lum;
  const whiteCeiling = pct(0.99).lum;

  // ── 2. Contrast Shape (mostly content-independent) ──
  // Measure PROPORTIONAL compression, not absolute values
  const p10 = pct(0.10).lum;
  const p25 = pct(0.25).lum;
  const p50 = pct(0.50).lum;
  const p75 = pct(0.75).lum;
  const p90 = pct(0.90).lum;

  // Shadow compression: how squeezed is the shadow range relative to overall range?
  const fullRange = whiteCeiling - blackFloor + 0.001;
  const shadowProportion = (p25 - blackFloor) / fullRange;
  const midProportion = (p75 - p25) / fullRange;
  const highlightProportion = (whiteCeiling - p75) / fullRange;

  // ── 3. Color Tinting per Tonal Zone (the KEY style marker) ──
  // Within each zone, how do R, G, B deviate from luminance?
  // This reveals the color GRADE, not the color CONTENT.
  //
  // Key insight: in shadows and highlights, even colorful content
  // approaches neutral (dark red is still dark, bright sky is still bright).
  // The TINT of these near-neutral zones reveals the grade.
  //
  // We further filter for LOW-CHROMA pixels within each zone,
  // which are even more content-independent.
  const zones = [
    { name: 'deepShadow', from: 0.00, to: 0.10, pixels: [] },
    { name: 'shadow',     from: 0.10, to: 0.25, pixels: [] },
    { name: 'lowMid',     from: 0.25, to: 0.40, pixels: [] },
    { name: 'mid',        from: 0.40, to: 0.60, pixels: [] },
    { name: 'highMid',    from: 0.60, to: 0.75, pixels: [] },
    { name: 'highlight',  from: 0.75, to: 0.90, pixels: [] },
    { name: 'bright',     from: 0.90, to: 1.00, pixels: [] },
  ];

  for (const px of pixels) {
    for (const zone of zones) {
      if (px.lum >= zone.from && px.lum < zone.to) {
        zone.pixels.push(px);
        break;
      }
    }
  }

  const tinting = {};
  for (const zone of zones) {
    if (zone.pixels.length < 20) {
      tinting[zone.name] = { rShift: 0, gShift: 0, bShift: 0, confidence: 0 };
      continue;
    }

    // Separate low-chroma and all pixels in this zone
    const lowChroma = zone.pixels.filter(p => p.chroma < 0.15);
    const usePixels = lowChroma.length > 15 ? lowChroma : zone.pixels;

    // Measure deviation from neutral: for each pixel, how does each
    // channel differ from the pixel's own luminance?
    // positive rShift = warm, positive bShift = cool
    let rDev = 0, gDev = 0, bDev = 0;
    for (const px of usePixels) {
      rDev += px.r - px.lum;
      gDev += px.g - px.lum;
      bDev += px.b - px.lum;
    }
    const cnt = usePixels.length;

    tinting[zone.name] = {
      rShift: rDev / cnt,
      gShift: gDev / cnt,
      bShift: bDev / cnt,
      confidence: lowChroma.length > 15 ? 1.0 : 0.5
    };
  }

  // ── 4. Saturation-vs-Luminance Profile ──
  // How does saturation vary across the tonal range?
  // This captures film-like highlight desaturation, shadow saturation, etc.
  // Normalized by zone to be RELATIVE, not absolute.
  const satProfile = {};
  for (const zone of zones) {
    if (zone.pixels.length < 10) {
      satProfile[zone.name] = { meanSat: 0, satSpread: 0 };
      continue;
    }
    const sats = zone.pixels.map(p => p.sat);
    const mean = sats.reduce((a, b) => a + b, 0) / sats.length;
    const spread = Math.sqrt(sats.reduce((s, v) => s + (v - mean) ** 2, 0) / sats.length);
    satProfile[zone.name] = { meanSat: mean, satSpread: spread };
  }

  // ── 5. Overall saturation level ──
  // Use MEDIAN saturation of midtone pixels (most content-neutral zone for this)
  const midSats = zones.find(z => z.name === 'mid').pixels.map(p => p.sat).sort((a, b) => a - b);
  const medianMidSat = midSats.length > 0 ? midSats[Math.floor(midSats.length / 2)] : 0.3;

  // ── 6. Channel Curve Divergence ──
  // At different luminance levels, how do R, G, B differ?
  // This captures per-channel grading (cross-processing, etc.)
  const channelCurves = {};
  for (const zone of zones) {
    if (zone.pixels.length < 10) {
      channelCurves[zone.name] = { r: 0.5, g: 0.5, b: 0.5 };
      continue;
    }
    const meanR = zone.pixels.reduce((s, p) => s + p.r, 0) / zone.pixels.length;
    const meanG = zone.pixels.reduce((s, p) => s + p.g, 0) / zone.pixels.length;
    const meanB = zone.pixels.reduce((s, p) => s + p.b, 0) / zone.pixels.length;
    channelCurves[zone.name] = { r: meanR, g: meanG, b: meanB };
  }

  return {
    // Tonal range (content-independent)
    blackFloor, blackPoint, whitePoint, whiteCeiling,

    // Contrast shape (proportional, not absolute)
    shadowProportion, midProportion, highlightProportion,
    p10, p25, p50, p75, p90,

    // Color tinting per zone (content-independent)
    tinting,

    // Saturation behavior
    satProfile,
    medianMidSat,

    // Per-channel curves
    channelCurves,

    // Raw zone data for advanced use
    zones,
    pixelCount: pixels.length
  };
}


// ═══════════════════════════════════════════════════════════════════════════════
// STYLE COMPARISON — Derive Adjustments
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Compare two style fingerprints and compute adjustments.
 *
 * The key difference from the old approach: we compare STYLE CHARACTERISTICS,
 * not pixel values. Each comparison asks "how does the reference's style
 * differ from the source's style?" not "how do the reference's pixels
 * differ from the source's pixels?"
 */
function computeStyleAdjustments(srcStyle, refStyle) {

  // ═══ TONAL ADJUSTMENTS ═══

  // ── Black Point ──
  // Direct comparison: if reference has lifted blacks, apply same lift.
  // This is 100% content-independent.
  let blackPoint = 0;
  if (refStyle.blackFloor > 0.04) {
    // Reference has faded/lifted blacks
    // Apply the DIFFERENCE, not the absolute value
    // (source might already have some lift)
    blackPoint = Math.max(0, refStyle.blackFloor - srcStyle.blackFloor);
    blackPoint = Math.min(0.18, blackPoint);
  }

  // ── White Point ──
  let whitePoint = 1.0;
  if (refStyle.whiteCeiling < 0.92) {
    const crush = 1.0 - refStyle.whiteCeiling;
    const srcCrush = 1.0 - srcStyle.whiteCeiling;
    const additionalCrush = Math.max(0, crush - srcCrush);
    whitePoint = Math.max(0.75, 1.0 - additionalCrush);
  }

  // ── Exposure ──
  // Compare median luminance, but CAREFULLY.
  // Big differences in p50 are usually content, not style.
  // Only apply exposure if the difference is modest (< 0.5 EV).
  const srcMid = srcStyle.p50;
  const refMid = refStyle.p50;
  let exposure = 0;

  // Only adjust if blacks and whites are similar (suggesting similar exposure intent)
  const rangeRatio = (refStyle.whiteCeiling - refStyle.blackFloor) /
                     (srcStyle.whiteCeiling - srcStyle.blackFloor + 0.001);
  if (rangeRatio > 0.7 && rangeRatio < 1.4) {
    const midRatio = (refMid + 0.01) / (srcMid + 0.01);
    exposure = Math.log2(midRatio);
    // HEAVILY dampen — large exposure differences are almost always content
    exposure = exposure * 0.35;
    exposure = Math.max(-0.8, Math.min(0.8, exposure));
    if (Math.abs(exposure) < 0.1) exposure = 0;
  }

  // ── Contrast ──
  // Compare the PROPORTIONAL distribution, not absolute values.
  // If reference has wider midtone proportion → more contrast.
  const srcMidProp = srcStyle.midProportion;
  const refMidProp = refStyle.midProportion;
  let contrast = 0;
  if (srcMidProp > 0.05) {
    const propRatio = refMidProp / srcMidProp;
    if (propRatio > 1.1) contrast = (propRatio - 1) * 0.8;
    else if (propRatio < 0.9) contrast = (propRatio - 1) * 1.0;
    contrast = Math.max(-0.5, Math.min(0.5, contrast));
  }

  // ── Highlights / Shadows ──
  // Compare proportional compression
  let highlights = 0;
  if (srcStyle.highlightProportion > 0.02 && refStyle.highlightProportion > 0.02) {
    const hiRatio = refStyle.highlightProportion / srcStyle.highlightProportion;
    if (hiRatio < 0.7) highlights = -(1 - hiRatio) * 0.8;  // compressed
    else if (hiRatio > 1.3) highlights = (hiRatio - 1) * 0.6;  // expanded
    highlights = Math.max(-0.7, Math.min(0.7, highlights));
  }

  let shadows = 0;
  if (srcStyle.shadowProportion > 0.02 && refStyle.shadowProportion > 0.02) {
    const loRatio = refStyle.shadowProportion / srcStyle.shadowProportion;
    if (loRatio > 1.3) shadows = (loRatio - 1) * 0.6;  // lifted
    else if (loRatio < 0.7) shadows = -(1 - loRatio) * 0.8;  // crushed
    shadows = Math.max(-0.7, Math.min(0.7, shadows));
  }

  let brightness = 0;  // usually zero — exposure handles most of it

  const tonal = { exposure, highlights, shadows, brightness, contrast, blackPoint, whitePoint };


  // ═══ COLOR TINTING (the big improvement) ═══

  // Instead of comparing mean colors (content-dependent),
  // compare the TINTING in each tonal zone (style-dependent).
  //
  // The tinting is measured as deviation from neutral within each zone,
  // using low-chroma pixels when available (more content-independent).

  // Shadow tinting → warmth + color multipliers
  const srcShadowTint = srcStyle.tinting.shadow || { rShift: 0, gShift: 0, bShift: 0 };
  const refShadowTint = refStyle.tinting.shadow || { rShift: 0, gShift: 0, bShift: 0 };
  const srcMidTint = srcStyle.tinting.mid || { rShift: 0, gShift: 0, bShift: 0 };
  const refMidTint = refStyle.tinting.mid || { rShift: 0, gShift: 0, bShift: 0 };
  const srcHiTint = srcStyle.tinting.highlight || { rShift: 0, gShift: 0, bShift: 0 };
  const refHiTint = refStyle.tinting.highlight || { rShift: 0, gShift: 0, bShift: 0 };

  // Weighted tinting difference across zones
  // Shadows weighted more because they're more content-independent
  const tintDiffR = (refShadowTint.rShift - srcShadowTint.rShift) * 0.45 +
                    (refMidTint.rShift - srcMidTint.rShift) * 0.35 +
                    (refHiTint.rShift - srcHiTint.rShift) * 0.20;

  const tintDiffG = (refShadowTint.gShift - srcShadowTint.gShift) * 0.45 +
                    (refMidTint.gShift - srcMidTint.gShift) * 0.35 +
                    (refHiTint.gShift - srcHiTint.gShift) * 0.20;

  const tintDiffB = (refShadowTint.bShift - srcShadowTint.bShift) * 0.45 +
                    (refMidTint.bShift - srcMidTint.bShift) * 0.35 +
                    (refHiTint.bShift - srcHiTint.bShift) * 0.20;

  // Convert tinting differences to warmth and color multipliers
  // warmth = R-B tinting difference
  let warmth = (tintDiffR - tintDiffB) * 0.6;
  warmth = Math.max(-0.06, Math.min(0.06, warmth));

  // green shift = G tinting
  let greenShift = tintDiffG * 0.4;
  greenShift = Math.max(-0.02, Math.min(0.02, greenShift));

  // Color multipliers from tinting — use confidence weighting
  const shadowConf = refStyle.tinting.shadow?.confidence || 0;
  const midConf = refStyle.tinting.mid?.confidence || 0;
  const avgConf = (shadowConf + midConf) / 2;

  // Convert tint differences to multipliers (small, centered around 1.0)
  let rMult = 1.0 + tintDiffR * avgConf * 1.5;
  let gMult = 1.0 + tintDiffG * avgConf * 1.5;
  let bMult = 1.0 + tintDiffB * avgConf * 1.5;

  // Normalize to preserve brightness
  const avgMult = (rMult + gMult + bMult) / 3;
  rMult /= avgMult;
  gMult /= avgMult;
  bMult /= avgMult;

  // Clamp conservatively
  rMult = Math.max(0.85, Math.min(1.15, rMult));
  gMult = Math.max(0.85, Math.min(1.15, gMult));
  bMult = Math.max(0.85, Math.min(1.15, bMult));


  // ═══ SATURATION & VIBRANCE ═══

  // Compare saturation PROFILES, not absolute values.
  // Use the midtone zone where content influence is moderate.
  const srcMidSat = srcStyle.medianMidSat;
  const refMidSat = refStyle.medianMidSat;

  let saturation = 1.0;
  if (srcMidSat > 0.02) {
    let satRatio = refMidSat / srcMidSat;
    // HEAVILY dampen — saturation differences are partially content
    satRatio = 1.0 + (satRatio - 1.0) * 0.45;
    saturation = Math.max(0.55, Math.min(1.45, satRatio));
  }

  // Vibrance: compare saturation distribution SHAPE
  // If reference has similar high-sat but lower low-sat → negative vibrance
  let vibrance = 0;
  const srcShadowSat = srcStyle.satProfile.shadow?.meanSat || 0;
  const refShadowSat = refStyle.satProfile.shadow?.meanSat || 0;
  const srcHighSat = srcStyle.satProfile.highlight?.meanSat || 0;
  const refHighSat = refStyle.satProfile.highlight?.meanSat || 0;

  // Highlight desaturation is a strong style marker (film stocks do this)
  if (srcHighSat > 0.02) {
    const hiSatRatio = refHighSat / srcHighSat;
    // If highlights are relatively less saturated in reference → film-like vibrance
    if (hiSatRatio < 0.8) {
      vibrance -= (1 - hiSatRatio) * 0.5;
    }
  }
  // Shadow saturation changes
  if (srcShadowSat > 0.02) {
    const loSatRatio = refShadowSat / srcShadowSat;
    if (loSatRatio < 0.8) {
      vibrance -= (1 - loSatRatio) * 0.3;
    }
  }
  vibrance = Math.max(-0.6, Math.min(0.6, vibrance));


  // ═══ TONE CURVES ═══
  // Build per-channel curves from the channel divergence pattern,
  // NOT from histogram matching.
  //
  // The idea: at each luminance level, measure how R, G, B differ
  // between source and reference. This captures per-channel grading
  // (cross-processing, split toning) without content contamination.

  const toneCurve = buildStyleCurves(srcStyle, refStyle);


  return {
    tonal,
    rMult, gMult, bMult,
    warmth, greenShift,
    saturation, vibrance,
    toneCurve,
  };
}


// ═══════════════════════════════════════════════════════════════════════════════
// STYLE-BASED TONE CURVE GENERATION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Build tone curves from style analysis instead of histogram matching.
 *
 * Instead of "make source histogram look like reference histogram" (content-dependent),
 * we extract the per-channel TINTING PATTERN and build curves that reproduce
 * the same tinting on the source.
 *
 * At each luminance level:
 *   - How much does R deviate from neutral in the reference vs source?
 *   - Apply that difference as a curve adjustment.
 */
function buildStyleCurves(srcStyle, refStyle) {
  const zoneNames = ['deepShadow', 'shadow', 'lowMid', 'mid', 'highMid', 'highlight', 'bright'];
  const zoneMidpoints = [13, 45, 83, 128, 172, 210, 243]; // approximate pixel values

  const buildChannelCurve = (channel) => {
    const points = [];

    // Black point
    points.push([0, Math.round(Math.max(0, refStyle.blackFloor * 255))]);

    for (let z = 0; z < zoneNames.length; z++) {
      const name = zoneNames[z];
      const xVal = zoneMidpoints[z];

      const srcCh = srcStyle.channelCurves[name]?.[channel] ?? (xVal / 255);
      const refCh = refStyle.channelCurves[name]?.[channel] ?? (xVal / 255);
      const srcLum = srcStyle.channelCurves[name] ?
        (srcStyle.channelCurves[name].r * 0.299 +
         srcStyle.channelCurves[name].g * 0.587 +
         srcStyle.channelCurves[name].b * 0.114) : (xVal / 255);
      const refLum = refStyle.channelCurves[name] ?
        (refStyle.channelCurves[name].r * 0.299 +
         refStyle.channelCurves[name].g * 0.587 +
         refStyle.channelCurves[name].b * 0.114) : (xVal / 255);

      // Channel deviation from neutral in each image
      const srcDev = srcCh - srcLum;
      const refDev = refCh - refLum;

      // The STYLE difference: how much more/less does this channel
      // deviate from neutral in the reference vs source?
      const devDiff = refDev - srcDev;

      // Apply the deviation difference to the identity curve
      // Scale conservatively to avoid overshooting
      const yVal = xVal + devDiff * 255 * 0.55;

      points.push([xVal, Math.max(0, Math.min(255, Math.round(yVal)))]);
    }

    // White point
    points.push([255, Math.round(Math.min(255, refStyle.whiteCeiling * 255))]);

    // Sort and deduplicate
    const sorted = points.sort((a, b) => a[0] - b[0]);
    const deduped = [sorted[0]];
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i][0] !== deduped[deduped.length - 1][0]) {
        deduped.push(sorted[i]);
      }
    }

    // Ensure monotonically non-decreasing (prevent inversions)
    for (let i = 1; i < deduped.length; i++) {
      if (deduped[i][1] < deduped[i - 1][1]) {
        deduped[i][1] = deduped[i - 1][1];
      }
    }

    return deduped;
  };

  return {
    r: buildChannelCurve('r'),
    g: buildChannelCurve('g'),
    b: buildChannelCurve('b')
  };
}


// ═══════════════════════════════════════════════════════════════════════════════
// SELECTIVE COLOR DETECTION (improved — uses tinting residual)
// ═══════════════════════════════════════════════════════════════════════════════

const HUE_ZONES = [
  { name: 'red', center: 0, halfWidth: 30 },
  { name: 'orange', center: 35, halfWidth: 20 },
  { name: 'yellow', center: 60, halfWidth: 22 },
  { name: 'green', center: 120, halfWidth: 45 },
  { name: 'cyan', center: 180, halfWidth: 22 },
  { name: 'blue', center: 230, halfWidth: 35 },
  { name: 'purple', center: 280, halfWidth: 30 },
  { name: 'magenta', center: 330, halfWidth: 22 },
];

function hueZoneWeight(hue, zone) {
  let dist = Math.abs(hue - zone.center);
  if (dist > 180) dist = 360 - dist;
  if (dist >= zone.halfWidth) return 0;
  return (Math.cos((dist / zone.halfWidth) * Math.PI) + 1) * 0.5;
}

/**
 * Detect selective color by comparing hue-specific characteristics.
 *
 * IMPROVED: Only looks at CHROMATIC pixels (sat > 0.1) and uses
 * per-hue deviation analysis instead of absolute color comparison.
 */
function detectSelectiveColor(srcImageData, refImageData) {
  const buildProfile = (data) => {
    const step = Math.max(1, Math.floor(data.length / (4 * 25000)));
    const zones = {};
    for (const z of HUE_ZONES) {
      zones[z.name] = { hueX: 0, hueY: 0, satSum: 0, lumSum: 0, weight: 0, count: 0 };
    }

    for (let i = 0; i < data.length; i += 4 * step) {
      const r = data[i] / 255, g = data[i + 1] / 255, b = data[i + 2] / 255;
      const max = Math.max(r, g, b), min = Math.min(r, g, b), ch = max - min;
      if (ch < 0.04) continue; // skip near-neutral

      const l = (max + min) / 2;
      const s = l > 0.5 ? ch / (2 - max - min) : ch / (max + min);
      let h;
      if (max === r) h = ((g - b) / ch) % 6;
      else if (max === g) h = (b - r) / ch + 2;
      else h = (r - g) / ch + 4;
      h *= 60; if (h < 0) h += 360;

      const hRad = h / 180 * Math.PI;
      for (const zone of HUE_ZONES) {
        const w = hueZoneWeight(h, zone) * s;
        if (w < 0.01) continue;
        const z = zones[zone.name];
        z.hueX += Math.cos(hRad) * w;
        z.hueY += Math.sin(hRad) * w;
        z.satSum += s * w;
        z.lumSum += l * w;
        z.weight += w;
        z.count++;
      }
    }

    const totalSampled = Math.floor(data.length / (4 * step));
    const profile = {};
    for (const zone of HUE_ZONES) {
      const z = zones[zone.name];
      if (z.weight < 1) {
        profile[zone.name] = { avgHue: zone.center, avgSat: 0, avgLum: 0.5, conf: 0 };
        continue;
      }
      let avgHue = Math.atan2(z.hueY, z.hueX) / Math.PI * 180;
      if (avgHue < 0) avgHue += 360;
      profile[zone.name] = {
        avgHue, avgSat: z.satSum / z.weight, avgLum: z.lumSum / z.weight,
        conf: Math.min(1, z.count / (totalSampled * 0.03))
      };
    }
    return profile;
  };

  const srcP = buildProfile(srcImageData.data);
  const refP = buildProfile(refImageData.data);
  const adj = {};

  for (const zone of HUE_ZONES) {
    const s = srcP[zone.name], r = refP[zone.name];
    if (s.conf < 0.10 || r.conf < 0.10) {
      adj[zone.name] = { hueShift: 0, satShift: 0, lumShift: 0 };
      continue;
    }

    const conf = Math.min(s.conf, r.conf);

    let hd = r.avgHue - s.avgHue;
    if (hd > 180) hd -= 360;
    if (hd < -180) hd += 360;
    // DAMPEN hue shifts heavily — large shifts are usually content differences
    let hueShift = hd * conf * 0.4;
    hueShift = Math.max(-20, Math.min(20, hueShift));

    let satRatio = s.avgSat > 0.01 ? r.avgSat / s.avgSat : 1;
    let satShift = (satRatio - 1) * conf * 0.4;
    satShift = Math.max(-0.5, Math.min(0.5, satShift));

    let lumDiff = (r.avgLum - s.avgLum) * conf * 0.3;
    lumDiff = Math.max(-0.2, Math.min(0.2, lumDiff));

    adj[zone.name] = {
      hueShift: Math.abs(hueShift) < 0.5 ? 0 : hueShift,
      satShift: Math.abs(satShift) < 0.02 ? 0 : satShift,
      lumShift: Math.abs(lumDiff) < 0.01 ? 0 : lumDiff
    };
  }

  return adj;
}


// ═══════════════════════════════════════════════════════════════════════════════
// TEXTURE ANALYSIS (unchanged — already content-independent)
// ═══════════════════════════════════════════════════════════════════════════════

function analyzeGrainTexture(imageData) {
  const { data, width, height } = imageData;
  const lum = new Float32Array(width * height);
  for (let i = 0; i < data.length; i += 4) {
    lum[i / 4] = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) / 255;
  }

  const step = Math.max(1, Math.floor(Math.sqrt(width * height / 20000)));
  let lapSq = 0, smoothCount = 0;

  for (let y = 2; y < height - 2; y += step) {
    for (let x = 2; x < width - 2; x += step) {
      const idx = y * width + x;
      const gx = -lum[idx - width - 1] + lum[idx - width + 1]
        - 2 * lum[idx - 1] + 2 * lum[idx + 1]
        - lum[idx + width - 1] + lum[idx + width + 1];
      const gy = -lum[idx - width - 1] - 2 * lum[idx - width] - lum[idx - width + 1]
        + lum[idx + width - 1] + 2 * lum[idx + width] + lum[idx + width + 1];

      if (Math.sqrt(gx * gx + gy * gy) < 0.04) {
        const lap = 4 * lum[idx] - lum[idx - 1] - lum[idx + 1] - lum[idx - width] - lum[idx + width];
        lapSq += lap * lap;
        smoothCount++;
      }
    }
  }

  if (smoothCount < 20) return { intensity: 0, size: 1.0 };
  const rms = Math.sqrt(lapSq / smoothCount);
  return {
    intensity: Math.min(1.0, rms / 0.032),
    size: Math.max(0.5, Math.min(3.0, 1.0 + rms * 15))
  };
}

function analyzeVignetteProfile(imageData) {
  const { data, width, height } = imageData;
  const cx = width / 2, cy = height / 2;
  const maxDist = Math.sqrt(cx * cx + cy * cy);
  const step = Math.max(1, Math.floor(Math.sqrt(width * height / 12000)));

  const rings = Array.from({ length: 8 }, () => []);
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const idx = (y * width + x) * 4;
      const lum = (data[idx] * 0.299 + data[idx + 1] * 0.587 + data[idx + 2] * 0.114) / 255;
      const ring = Math.min(7, Math.floor(Math.sqrt((x - cx) ** 2 + (y - cy) ** 2) / maxDist * 8));
      rings[ring].push(lum);
    }
  }

  const median = arr => {
    if (!arr.length) return 0;
    arr.sort((a, b) => a - b);
    return arr[Math.floor(arr.length / 2)];
  };

  const meds = rings.map(median);
  const inner = (meds[0] + meds[1]) / 2;
  const outer = (meds[6] + meds[7]) / 2;
  return { intensity: Math.max(0, Math.min(0.7, (inner - outer) / (inner + 0.001) * 1.5)) };
}

function detectClarity(srcImageData, refImageData) {
  const measure = (data, width, height) => {
    const lum = new Float32Array(width * height);
    for (let i = 0; i < data.length; i += 4) {
      lum[i / 4] = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) / 255;
    }
    let gSum = 0, gSq = 0;
    for (let i = 0; i < lum.length; i++) { gSum += lum[i]; gSq += lum[i] * lum[i]; }
    const gStd = Math.sqrt(gSq / lum.length - (gSum / lum.length) ** 2);

    const ps = 32;
    let lSum = 0, lCnt = 0;
    for (let py = 0; py < height - ps; py += ps) {
      for (let px = 0; px < width - ps; px += ps) {
        let s = 0, sq = 0, n = 0;
        for (let dy = 0; dy < ps; dy++) {
          for (let dx = 0; dx < ps; dx++) {
            const v = lum[(py + dy) * width + (px + dx)];
            s += v; sq += v * v; n++;
          }
        }
        lSum += Math.sqrt(Math.max(0, sq / n - (s / n) ** 2));
        lCnt++;
      }
    }
    return { gStd, lRMS: lCnt > 0 ? lSum / lCnt : 0 };
  };

  const s = measure(srcImageData.data, srcImageData.width, srcImageData.height);
  const r = measure(refImageData.data, refImageData.width, refImageData.height);

  const sR = s.gStd > 0.001 ? s.lRMS / s.gStd : 0;
  const rR = r.gStd > 0.001 ? r.lRMS / r.gStd : 0;

  let clarity = (rR - sR) / 0.35;
  clarity *= Math.min(1, (s.gStd + r.gStd) / 0.25);
  return Math.max(-1, Math.min(1, clarity));
}


// ═══════════════════════════════════════════════════════════════════════════════
// MAIN AUTO-MATCH — STYLE EXTRACTION ARCHITECTURE
// ═══════════════════════════════════════════════════════════════════════════════

export function autoMatch(sourceImageData, referenceImageData, options = {}) {
  const {
    matchCurves = true,
    matchColor = true,
    matchGrain = true,
    matchVignette = true
  } = options;

  const t0 = performance.now();
  console.log('[AutoMatch v4] ═══ Style Extraction ═══');

  // ── Step 1: Extract style fingerprints independently ──
  const srcStyle = extractStyleFingerprint(sourceImageData);
  const refStyle = extractStyleFingerprint(referenceImageData);

  console.log('[v4] Source style:', {
    blackFloor: srcStyle.blackFloor.toFixed(3),
    p50: srcStyle.p50.toFixed(3),
    whiteCeiling: srcStyle.whiteCeiling.toFixed(3),
    medianMidSat: srcStyle.medianMidSat.toFixed(3)
  });
  console.log('[v4] Reference style:', {
    blackFloor: refStyle.blackFloor.toFixed(3),
    p50: refStyle.p50.toFixed(3),
    whiteCeiling: refStyle.whiteCeiling.toFixed(3),
    medianMidSat: refStyle.medianMidSat.toFixed(3)
  });

  // Log tinting (the key style marker)
  for (const zone of ['shadow', 'mid', 'highlight']) {
    const rt = refStyle.tinting[zone];
    if (rt && rt.confidence > 0.3) {
      console.log(`[v4] Ref ${zone} tint: R${rt.rShift > 0 ? '+' : ''}${rt.rShift.toFixed(4)} G${rt.gShift > 0 ? '+' : ''}${rt.gShift.toFixed(4)} B${rt.bShift > 0 ? '+' : ''}${rt.bShift.toFixed(4)} (conf=${rt.confidence.toFixed(2)})`);
    }
  }

  // ── Step 2: Compare style fingerprints ──
  const adj = matchColor || matchCurves
    ? computeStyleAdjustments(srcStyle, refStyle)
    : {
        tonal: { exposure: 0, highlights: 0, shadows: 0, brightness: 0, contrast: 0, blackPoint: 0, whitePoint: 1 },
        rMult: 1, gMult: 1, bMult: 1, warmth: 0, greenShift: 0,
        saturation: 1, vibrance: 0,
        toneCurve: { r: [[0,0],[128,128],[255,255]], g: [[0,0],[128,128],[255,255]], b: [[0,0],[128,128],[255,255]] }
      };

  console.log(`[v4] Tonal: EV=${adj.tonal.exposure.toFixed(2)} Hi=${adj.tonal.highlights.toFixed(2)} Sh=${adj.tonal.shadows.toFixed(2)} BP=${adj.tonal.blackPoint.toFixed(3)} WP=${adj.tonal.whitePoint.toFixed(3)}`);
  console.log(`[v4] Color: R=${adj.rMult.toFixed(3)} G=${adj.gMult.toFixed(3)} B=${adj.bMult.toFixed(3)} W=${adj.warmth.toFixed(4)}`);
  console.log(`[v4] Sat=${adj.saturation.toFixed(3)} Vib=${adj.vibrance.toFixed(3)}`);

  // ── Step 3: Selective color (still needs both images) ──
  let selectiveColor = null;
  if (matchColor) {
    const sc = detectSelectiveColor(sourceImageData, referenceImageData);
    const hasAdj = Object.values(sc).some(a =>
      Math.abs(a.hueShift) > 0.5 || Math.abs(a.satShift) > 0.02 || Math.abs(a.lumShift) > 0.01
    );
    selectiveColor = hasAdj ? sc : null;
    if (selectiveColor) {
      for (const [name, a] of Object.entries(selectiveColor)) {
        if (Math.abs(a.hueShift) > 0.5 || Math.abs(a.satShift) > 0.02) {
          console.log(`[v4] SC ${name}: H=${a.hueShift.toFixed(1)}° S=${a.satShift.toFixed(3)}`);
        }
      }
    }
  }

  // ── Step 4: Clarity ──
  let clarity = 0;
  if (matchCurves) {
    clarity = detectClarity(sourceImageData, referenceImageData);
    console.log(`[v4] Clarity=${clarity.toFixed(3)}`);
  }

  // ── Step 5: Grain + Vignette ──
  let grain = { intensity: 0, size: 1.0 };
  if (matchGrain) {
    const rg = analyzeGrainTexture(referenceImageData);
    const sg = analyzeGrainTexture(sourceImageData);
    grain = {
      intensity: Math.min(1, Math.max(0, rg.intensity - sg.intensity * 0.5)),
      size: rg.size
    };
  }

  let vignette = { intensity: 0 };
  if (matchVignette) {
    const rv = analyzeVignetteProfile(referenceImageData);
    const sv = analyzeVignetteProfile(sourceImageData);
    vignette = { intensity: Math.min(0.65, Math.max(0, rv.intensity - sv.intensity * 0.3)) };
  }

  // ── Build description ──
  const traits = [];
  if (adj.tonal.blackPoint > 0.03) traits.push('faded');
  if (adj.tonal.whitePoint < 0.93) traits.push('muted highlights');
  if (adj.tonal.exposure > 0.2) traits.push('bright');
  if (adj.tonal.exposure < -0.2) traits.push('dark');
  if (adj.tonal.shadows > 0.15) traits.push('lifted shadows');
  if (adj.tonal.highlights < -0.15) traits.push('compressed highlights');
  if (adj.tonal.contrast > 0.15) traits.push('punchy');
  if (adj.tonal.contrast < -0.15) traits.push('flat');
  if (clarity < -0.15) traits.push('dreamy');
  if (clarity > 0.2) traits.push('crisp');
  if (adj.vibrance < -0.1) traits.push('muted colors');
  if (adj.warmth > 0.02) traits.push('warm');
  if (adj.warmth < -0.02) traits.push('cool');
  if (grain.intensity > 0.1) traits.push('grainy');

  const sharpen = clarity < -0.2 ? 0.03 : clarity > 0.3 ? 0.22 : 0.12;
  const desc = traits.length > 0 ? traits.join(', ') : 'neutral';
  const elapsed = performance.now() - t0;

  console.log(`[AutoMatch v4] ═══ ${elapsed.toFixed(0)}ms — ${desc} ═══`);

  return {
    id: 'auto-matched-v4',
    name: 'Auto Matched v4',
    description: desc,

    tonal: matchCurves ? adj.tonal : { exposure: 0, highlights: 0, shadows: 0, brightness: 0, contrast: 0, blackPoint: 0, whitePoint: 1 },
    toneCurve: matchCurves ? adj.toneCurve : {
      r: [[0,0],[128,128],[255,255]],
      g: [[0,0],[128,128],[255,255]],
      b: [[0,0],[128,128],[255,255]]
    },

    saturation: matchColor ? adj.saturation : 1,
    vibrance: matchColor ? adj.vibrance : 0,
    rMult: matchColor ? adj.rMult : 1,
    gMult: matchColor ? adj.gMult : 1,
    bMult: matchColor ? adj.bMult : 1,
    warmth: matchColor ? adj.warmth : 0,
    greenShift: matchColor ? adj.greenShift : 0,
    selectiveColor: matchColor ? selectiveColor : null,
    clarity,

    grainIntensity: grain.intensity,
    grainSize: grain.size,
    grainSeed: 42,
    vignetteIntensity: vignette.intensity,
    sharpenAmount: sharpen,

    colorAdjust: {
      rMult: adj.rMult, gMult: adj.gMult, bMult: adj.bMult,
      saturation: adj.saturation, vibrance: adj.vibrance,
      warmth: adj.warmth, greenShift: adj.greenShift
    },
    grain, vignette,
    _diagnostics: {
      tonal: adj.tonal, elapsed, description: desc,
      srcStyle: {
        blackFloor: srcStyle.blackFloor, p50: srcStyle.p50,
        whiteCeiling: srcStyle.whiteCeiling, medianMidSat: srcStyle.medianMidSat
      },
      refStyle: {
        blackFloor: refStyle.blackFloor, p50: refStyle.p50,
        whiteCeiling: refStyle.whiteCeiling, medianMidSat: refStyle.medianMidSat
      }
    }
  };
}
