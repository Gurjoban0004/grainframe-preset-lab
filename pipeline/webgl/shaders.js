// Shared vertex shader — fullscreen quad with texture coordinates
export const vertexShader = `#version 300 es
layout(location = 0) in vec2 a_position;
layout(location = 1) in vec2 a_texCoord;

out vec2 v_uv;

void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
  // Pass UVs unchanged. _readPixels flips rows when reading back,
  // which is the single conversion from WebGL (Y=0 bottom) to
  // ImageData (Y=0 top). One flip only.
  v_uv = a_texCoord;
}
`;

// ==================================================
// PASS 1: Main color pipeline
// Matches the Canvas pipeline stage order exactly:
//   applyColor (linear light) → applyVignette (linear light)
//   → applyToneCurve (sRGB) → applyGrain (sRGB) → applySharpen (sRGB)
//
// Preset fields are FLAT (e.g. preset.saturation, preset.vignetteIntensity)
// matching the actual JSON structure.
// ==================================================
export const colorFragmentShader = `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_image;
uniform sampler2D u_lutR;
uniform sampler2D u_lutG;
uniform sampler2D u_lutB;
uniform sampler2D u_grain;

// Color adjust (flat preset fields)
uniform float u_saturation;      // preset.saturation
uniform float u_rMult;           // preset.rMult
uniform float u_gMult;           // preset.gMult
uniform float u_bMult;           // preset.bMult
uniform float u_warmth;          // preset.warmth
uniform float u_greenShift;      // preset.greenShift

// Vignette
uniform float u_vignetteIntensity; // preset.vignetteIntensity

// Grain
uniform float u_grainIntensity;  // preset.grainIntensity
uniform float u_grainSize;       // preset.grainSize
uniform vec2  u_grainOffset;
uniform vec2  u_resolution;

// sRGB → linear light (matches colorspace.js srgbToLinearLUT)
vec3 srgbToLinear(vec3 c) {
  vec3 lo = c / 12.92;
  vec3 hi = pow((c + 0.055) / 1.055, vec3(2.4));
  return mix(lo, hi, step(vec3(0.04045), c));
}

// linear light → sRGB (matches colorspace.js linearToSrgbLUT)
vec3 linearToSrgb(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  vec3 lo = c * 12.92;
  vec3 hi = 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055;
  return mix(lo, hi, step(vec3(0.0031308), c));
}

// RGB → HSL (matches color.js rgbToHsl)
vec3 rgbToHsl(vec3 c) {
  float maxC = max(c.r, max(c.g, c.b));
  float minC = min(c.r, min(c.g, c.b));
  float l = (maxC + minC) * 0.5;
  float d = maxC - minC;
  if (d < 0.00001) return vec3(0.0, 0.0, l);
  float s = l > 0.5 ? d / (2.0 - maxC - minC) : d / (maxC + minC);
  float h;
  if (maxC == c.r) {
    h = (c.g - c.b) / d + (c.g < c.b ? 6.0 : 0.0);
  } else if (maxC == c.g) {
    h = (c.b - c.r) / d + 2.0;
  } else {
    h = (c.r - c.g) / d + 4.0;
  }
  h /= 6.0;
  return vec3(h * 360.0, s, l);
}

float hue2rgb(float p, float q, float t) {
  if (t < 0.0) t += 1.0;
  if (t > 1.0) t -= 1.0;
  if (t < 1.0/6.0) return p + (q - p) * 6.0 * t;
  if (t < 0.5)     return q;
  if (t < 2.0/3.0) return p + (q - p) * (2.0/3.0 - t) * 6.0;
  return p;
}

// HSL → RGB (matches color.js hslToRgb)
vec3 hslToRgb(vec3 hsl) {
  float h = hsl.x / 360.0;
  float s = hsl.y;
  float l = hsl.z;
  if (s < 0.00001) return vec3(l);
  float q = l < 0.5 ? l * (1.0 + s) : l + s - l * s;
  float p = 2.0 * l - q;
  return vec3(
    hue2rgb(p, q, h + 1.0/3.0),
    hue2rgb(p, q, h),
    hue2rgb(p, q, h - 1.0/3.0)
  );
}

void main() {
  vec4 texel = texture(u_image, v_uv);
  vec3 rgb = texel.rgb;

  // === STAGE 1 (applyColor): linear light color transform ===
  vec3 lin = srgbToLinear(rgb);

  // Channel multipliers (same order as color.js)
  lin *= vec3(u_rMult, u_gMult, u_bMult);

  // Saturation via HSL (matches color.js exactly)
  vec3 hsl = rgbToHsl(lin);
  hsl.y = clamp(hsl.y * u_saturation, 0.0, 1.0);
  lin = hslToRgb(hsl);

  // Warmth (matches color.js: r += warmth, b -= warmth, in linear)
  lin.r += u_warmth;
  lin.b -= u_warmth;
  lin = clamp(lin, 0.0, 1.0);

  // === Green-to-olive hue shift ===
  // Selectively shifts green-dominant pixels toward yellow/olive.
  // Only affects pixels where green is the dominant channel.
  // Skin tones (red-dominant) are not affected.
  if (u_greenShift > 0.001) {
    float maxC = max(max(lin.r, lin.g), lin.b);
    float minC = min(min(lin.r, lin.g), lin.b);
    float chroma = maxC - minC;

    if (chroma > 0.01) {
      float greenness = (lin.g - max(lin.r, lin.b)) / chroma;
      float shift = max(0.0, greenness) * u_greenShift;

      lin.r += shift * chroma * 0.5;
      lin.b -= shift * chroma * 0.3;

      // Slightly desaturate the shifted greens to avoid neon olive
      float lumAfter = dot(lin, vec3(0.2126, 0.7152, 0.0722));
      lin = mix(lin, vec3(lumAfter), shift * 0.15);
    }
  }

  // Back to sRGB after color stage
  vec3 srgb = linearToSrgb(lin);

  // === STAGE 2 (applyVignette): radial vignette in linear light ===
  // Matches vignette.js: innerR = shorter*0.5, outerR = longer*0.75
  // intensity capped so corners are max 25% dark
  if (u_vignetteIntensity > 0.0) {
    float w = u_resolution.x;
    float h = u_resolution.y;
    float shorter = min(w, h);
    float longer  = max(w, h);
    float innerR  = shorter * 0.5;
    float outerR  = longer  * 0.75;
    float range   = outerR - innerR;

    // Corner distance for cap calculation
    float cx = w * 0.5;
    float cy = h * 0.5;
    float cornerDist = length(vec2(cx, cy));
    float rawCorner  = clamp((cornerDist - innerR) / range, 0.0, 1.0);
    float effectiveIntensity = u_vignetteIntensity;

    // Pixel distance from center (in actual pixels, not UV)
    vec2 pixelPos = v_uv * vec2(w, h);
    float dx = pixelPos.x - cx;
    float dy = pixelPos.y - cy;
    float dist = length(vec2(dx, dy));

    float falloff = clamp((dist - innerR) / range, 0.0, 1.0);
    float mul = 1.0 - effectiveIntensity * falloff;

    // Apply in linear light (matches vignette.js)
    vec3 linV = srgbToLinear(srgb);
    linV *= mul;
    srgb = linearToSrgb(linV);
  }

  // === STAGE 3 (applyToneCurve): LUT lookup in sRGB ===
  // Sample at srgb value directly — LINEAR filter + CLAMP_TO_EDGE
  // maps [0,1] to [texel0, texel255] correctly.
  float lutR = texture(u_lutR, vec2(srgb.r, 0.5)).r;
  float lutG = texture(u_lutG, vec2(srgb.g, 0.5)).r;
  float lutB = texture(u_lutB, vec2(srgb.b, 0.5)).r;
  srgb = vec3(lutR, lutG, lutB);

  // === STAGE 4 (applyGrain): film grain in sRGB ===
  if (u_grainIntensity > 0.001) {
    float luminance = dot(srgb, vec3(0.299, 0.587, 0.114));
    float grainFactor = u_grainIntensity * (1.0 - luminance * 0.6);

    vec2 grainUV = v_uv * u_resolution / (u_grainSize * 64.0) + u_grainOffset;
    float noise = texture(u_grain, grainUV).r - 0.5;

    // Monochrome grain when saturation is 0 (matches grain.js)
    float monoMask = step(u_saturation, 0.05);
    vec3 monoGrain  = vec3(noise * grainFactor);
    vec3 colorGrain = vec3(
      noise * grainFactor * 1.1,
      noise * grainFactor * 0.9,
      noise * grainFactor * 1.1
    );
    srgb += mix(colorGrain, monoGrain, monoMask);
  }

  fragColor = vec4(clamp(srgb, 0.0, 1.0), texel.a);
}
`;

// ==================================================
// PASS 2/3: Gaussian blur (separable, 9-tap)
// Direction controlled by u_direction uniform
// ==================================================
export const blurFragmentShader = `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_image;
uniform vec2 u_resolution;
uniform vec2 u_direction;

void main() {
  vec2 texelSize = 1.0 / u_resolution;
  vec2 step = texelSize * u_direction;

  // 9-tap Gaussian kernel (sigma ≈ 1.0)
  vec3 sum = vec3(0.0);
  sum += texture(u_image, v_uv - 4.0 * step).rgb * 0.0162;
  sum += texture(u_image, v_uv - 3.0 * step).rgb * 0.0540;
  sum += texture(u_image, v_uv - 2.0 * step).rgb * 0.1216;
  sum += texture(u_image, v_uv - 1.0 * step).rgb * 0.1933;
  sum += texture(u_image, v_uv              ).rgb * 0.2108;
  sum += texture(u_image, v_uv + 1.0 * step).rgb * 0.1933;
  sum += texture(u_image, v_uv + 2.0 * step).rgb * 0.1216;
  sum += texture(u_image, v_uv + 3.0 * step).rgb * 0.0540;
  sum += texture(u_image, v_uv + 4.0 * step).rgb * 0.0162;

  fragColor = vec4(sum, 1.0);
}
`;

// ==================================================
// PASS 4: Sharpen (unsharp mask)
// output = original + (original - blurred) * amount
// ==================================================
export const sharpenFragmentShader = `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_original;
uniform sampler2D u_blurred;
uniform float u_amount;

void main() {
  vec3 orig = texture(u_original, v_uv).rgb;
  vec3 blur = texture(u_blurred, v_uv).rgb;

  vec3 edge = orig - blur;
  vec3 result = orig + edge * u_amount;

  fragColor = vec4(clamp(result, 0.0, 1.0), 1.0);
}
`;

// ==================================================
// Passthrough — copy texture to output
// ==================================================
export const passthroughFragmentShader = `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_image;

void main() {
  fragColor = texture(u_image, v_uv);
}
`;
