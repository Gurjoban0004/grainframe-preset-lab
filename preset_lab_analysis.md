# Preset Lab Auto-Match Analysis

This document compiles the inner workings of the Preset Lab, detailing the auto-match pipeline between a source ("original") photo and a reference photo. It outlines the imports/exports used and pinpoints functional areas that might be causing problematic results.

## 1. Imports and Exports in the Preset Lab

The architecture separates the UI, the processing pipeline, and the auto-match algorithm into distinct modules.

**In `index.html`:**
*   Imports `processImage` from `./pipeline/index.js` (to apply preset styles onto images).
*   Imports `computeHistograms`, `drawHistogram`, `drawBlended`, `autoMatch`, `extractToneCurves`, `estimateGrain`, `detectVignette` from `./auto-match.js` (for analysis and matching).
*   Imports standard default presets (e.g., `classic-chrome.json`, `portra.json`, etc.) from the `./presets/` directory.

**In `pipeline/index.js`:**
*   **Exports** `processImage` and `isWebGLActive` to the UI front-end.
*   **Imports** the `WebGLRenderer` from `./webgl/renderer.js` to process images fast using GPU.
*   **Imports** fallback Canvas API processors (`applyColor`, `applyVignette`, `buildToneCurveLUTs`, `applyToneCurve`, `applyGrain`, `applySharpen`) from other pipeline files depending on WebGL availability.

**In `auto-match.js`:**
*   **Exports** multiple tools: `computeHistograms`, `computeCDF`, `histogramMatch`, `extractToneCurves`, `estimateGrain`, `detectVignette`, `autoMatch`, `drawHistogram`, `drawBlended`.
*   Contains internal helper logic for Math transformations (sRGB ↔ Linear array conversions, Catmull-Rom LUT generation).

## 2. How the Auto-Match Process Works

When "Match All" is clicked, processing relies heavily on `autoMatch(...)` in `auto-match.js`. The logic attempts a "Grade Extraction" approach rather than raw histogram mapping, broken into these steps:

### A. Grade Analysis (`analyzeGrade()`)
Instead of matching pixel-by-pixel, the tool analyzes both the Source and Reference photos to calculate absolute tonal and color characteristics:
1.  **Luminance & Color Channels:** It loops through every pixel, converts sRGB to Linear, and sums up R, G, B, Luminance, and Chroma to compute the *mean* values.
2.  **Percentiles Generation:** It sorts pixels by brightness to find specific percentiles (e.g., `p2` for shadows, `p50` for midtones, `p98` for highlights).
3.  **Grade Extraction Parameters:** Based on the mean values and percentiles, it infers:
    *   **Shadow Lift:** Based on the `p2` percentile (how high the darkest pixels sit).
    *   **Highlight Rolloff:** Based on `p98` (how highlights are compressed).
    *   **Color Temp & Saturation:** Computed from the R/B ratio and the Mean Chroma / Mean Luminance ratio.
    *   **Channel Balance:** Relative average brightness of Red vs. Green vs. Blue.

### B. Color Solving (`solveColorFromGrades()`)
It compares the target Reference grade vs. the Source grade to determine simple sliders.
*   **Channel Multipliers (`rMult`, `gMult`, `bMult`):** Reference channel balance divided by Source channel balance.
*   **Saturation & Warmth:** Calculated by comparing the specific means and dividing/subtracting them.

### C. Curve Building (`buildGradeCurve()` and `blendLUT()`)
1.  **Grade Curve:** It creates curve control points by tying the Source's percentiles to the Reference's percentiles (e.g., `Point[Source p10, Reference p10]`).
2.  **Histogram Curve:** It completely performs standard scene-dependent histogram mapping (CDF matching).
3.  **Blending:** It takes the scene-independent Grade Curve and blends it with the scene-dependent Histogram Curve, favoring the Grade Curve at a 70% to 30% ratio.
4.  **Refinement Pass:** It applies these blended curves to a mock version of the photo, analyzes it *again*, and slightly tweaks the color sliders to prevent overcorrection.

---

## 3. Where Everything Might Be Going Wrong

Despite shifting to "scene-independent" terminology, the implementation is heavily susceptible to content distortion. Here is where the mathematical approach might be yielding unpromising results:

### A. "Color Temp" and "Channel Balance" are actually Content-Dependent
The algorithm assumes the *mean* color of the photo represents its "color grade" (e.g., warmth). 
*   **The Issue:** If your Reference photo is a picture of a blue ocean under a sunny sky, the mean RGB values will be overwhelmingly blue. The system incorrectly logs this as a "Cool Color Temp Grade". If you apply this to a Source photo of a green forest, it will violently tint the forest blue trying to replicate the "grade."

### B. Curve Mapping by Percentiles (`buildGradeCurve()`)
The tool draws an S-Curve by matching `srcP` arrays to `refP` arrays.
*   **The Issue:** If the Source has a very dark foreground (e.g., night scene: `p50` = 0.1) and the Reference is very bright (e.g., snow scene: `p50` = 0.8), it creates a control point at `[0.1, 0.8]`. This results in an extreme, vertical spike in the resulting Tone Curve, completely crushing and artifacting the midtones of the image. It doesn't extract the "style" of the curve, it just ruthlessly forces the original tonal values to shift to the reference tonal values.

### C. The 30% Histogram Match is Destructive
*   **The Issue:** The script inherently blends classic Histogram Matching (CDF mapping) at a 30% weight (`const blendedR = blendLUT(gradeCurveR, histLutR, 0.7)`). Histogram mapping assumes both photos have the exact same amount of shadows, midtones, and highlights. Any presence of this algorithm ruins photos that do not share the exact same lighting composition.

### D. Saturation Ratio is Dangerous
Saturation is calculated mathematically as: `refGrade.saturation / srcGrade.saturation`. 
*   **The Issue:** If the Source photo is naturally desaturated (e.g., a foggy day) with `saturation = 0.05` and the Reference photo is very colorful (e.g., a neon sign) with `saturation = 0.8`, the division results in a massive multiplier (`16x`), creating deep color clipping and artifacting. The algorithm limits it to `1.5` max, but hard-clamping just makes the results noticeably deficient. 

### E. Mean-Based Green Shift
The script finds green characteristics by evaluating `meanG - (meanR + meanB) / 2`. 
*   **The Issue:** Once again, this relies on what the photo *is* rather than how the photo is *graded*. If you take a reference photo of an emerald ring or a lawn, it immediately detects a massive "Green Bias" and applies a heavy magenta/green shift to your Source photo. 

### Conclusion
The math attempts to mimic professional colorist logic by capturing "shadow lift" and "rolloff", but its method of identifying these traits blindly averages the total pixel grid. This means it essentially cannot separate **"What objects are in the photo"** from **"What color profile was applied to the photo"**, leading to highly unstable color and curve adjustments.


we are still not getting good results out of the preset lab this is the anaylsis doc that my agent made pls have a look and tell me what direction we need to move forward in 