# Grainframe Preset Lab

A standalone developer tool for creating and auto-matching Grainframe presets.

## What it does

- Load your photo + a reference photo
- Click **Match All** to auto-generate a preset that transforms your photo to match the reference's color grade
- Fine-tune with sliders and the curve editor
- Export as JSON → drop into `grainframe/src/presets/`

## How to run

```bash
npm install
npm run dev
```

Then open `http://localhost:5173`

## Auto-match algorithm

Uses grade extraction (not histogram matching) — analyzes the reference photo's absolute tonal and color characteristics (shadow lift, highlight rolloff, color temperature, saturation) and builds a preset that imposes those characteristics on the source photo. Scene-independent.

## Files

- `index.html` — the full lab UI + JS
- `auto-match.js` — the matching engine
- `pipeline/` — Grainframe pipeline (copied from main app)
- `presets/` — all built-in presets
