# VISOXID Workbench

An oxidation-aware contour planning sandbox built with Vite, React, TypeScript, Tailwind CSS, and Zustand.

## Getting Started

```bash
npm install
npm run dev
```

The development server runs on <http://localhost:5173> by default.

## Available Scripts

- `npm run dev` – start the Vite development server.
- `npm run build` – type-check and build the production bundle.
- `npm run preview` – preview a production build locally.
- `npm run lint` – run ESLint over the source files.

## Project Structure

- `src/types.ts` – core data model shared across the app.
- `src/state/` – Zustand stores for paths, tools, grid, mirror, oxidation, and measurement data.
- `src/geometry/` – sampling, smoothing, thickness evaluation, and offset helpers.
- `src/canvas/` – immediate-mode canvas renderer modules running at 60 FPS.
- `src/ui/` – React components for the light themed control panels and canvas viewport.
- `src/utils/` – shared math helpers, ID generation, and import/export utilities.

## Styling

Tailwind CSS powers the light, minimalist UI theme. Global styles live in `src/index.css` with reusable panel/button utility classes.

## Import / Export

Use the Project panel within the app to export or import JSON project files. PNG and SVG export buttons currently provide informative stubs for future integrations.
