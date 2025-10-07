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
- `npm run build` – type-check and build the production bundle. The resulting `dist/index.html` can be opened directly from the filesystem for offline review.
- `npm run preview` – preview a production build locally.
- `npm run lint` – run ESLint over the source files.
- `npm run electron:start` – build the production bundle and open it inside the desktop shell.
- `npm run electron:package` – build the bundle and produce installable Electron packages in `dist/`.

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

## Running without a local server

To load the workbench from disk without the Vite dev server:

1. Install dependencies with `npm install` (one time).
2. Run `npm run build` to create the production bundle under `dist/`.
3. Open `dist/index.html` in a modern browser. All bundle paths are now relative, so the app runs correctly when launched via the `file://` protocol.
   - Browsers that block `localStorage` for `file://` origins simply disable the scene/shape library instead of crashing, so offline sessions remain usable even without persistence.

## Desktop application build

If you prefer to run Oxid Designer as a standalone desktop app:

1. Install dependencies with `npm install`.
2. Run `npm run electron:start` to generate the production bundle and open it inside the lightweight Electron shell.
   - The command fails if `dist/index.html` is missing, so make sure the build succeeds first.
3. To generate distributable installers, run `npm run electron:package`. Electron Builder places platform-specific artefacts under `dist/` (for example, `.dmg` on macOS or `.exe` on Windows).

The Electron wrapper loads the same offline-friendly `dist/index.html`, so all geometry tooling and oxidation previews behave identically to the browser version.
