<div align="center">
  <h1>PulsE Player</h1>
  <p>High-fidelity local audio player with reactive visuals and a built-in parametric EQ.</p>
</div>

## What This App Does

- Load a folder of local audio files (mp3 or any `audio/*`) and build a playlist on the fly—no uploads or accounts.
- Switch between three live visualizers powered by the Web Audio API: Generative Silk, Ribbon Waveform, and Pulse Core.
- Control playback with play/pause, previous/next, shuffle, repeat, seek bar, and volume slider.
- Tweak a 16-band graphic EQ, reset to flat with one click, and adjust playback speed from 0.5x–2x.
- Filter your library with instant search and see animated now-playing states.
- Responsive layout designed for both desktop and touch interactions.

## Getting Started

**Prerequisites**
- Node.js 18+ and npm

**Install and Run**
1) Install dependencies: `npm install`
2) Start the dev server: `npm run dev`
3) Open the printed localhost URL, click **Load Folder**, and pick a directory containing audio files.

## Usage Notes

- Visualizers live in the **Visualizer** tab; audio/EQ tools live in **Audio Engine**; playlist management lives in **Playlist**.
- EQ supports ±15 dB per band; drag points directly on the curve to adjust.
- Playback speed changes apply immediately to the active track.
- Nothing is uploaded—audio stays on your machine and streams from `blob:` URLs.

## Scripts

- `npm run dev` — start Vite dev server on port 3000
- `npm run build` — production build
- `npm run preview` — preview built assets
- `npm run lint` — typecheck via `tsc --noEmit`

## Tech Stack

- React 19 + Vite
- Tailwind CSS v4 for styling
- motion for animations, lucide-react for icons
- Web Audio API + Canvas for visualization

## Deployment

Build with `npm run build` and deploy the `dist` output to any static host (e.g., Vercel, Netlify, S3/CloudFront).
