# VISOXID Agent Handbook

This project implements **Oxid Designer**, a Vite + React + TypeScript workbench for editing closed 2D contours, previewing directional oxidation offsets, and exporting results.  The application renders exclusively to an HTML `<canvas>` (no SVG) and uses Zustand for state.  Geometry helpers live under `src/geometry`, canvas drawing primitives under `src/canvas`, and UI panels/controls under `src/ui`.

## Working Expectations

- Keep the directional oxidation model intact.  Thickness is evaluated with a von Mises blend across the eight compass directions plus a uniform base term.  Geometry sampling, normals, smoothing, and offset visualisation flow through `workspaceStore.runGeometryPipeline()`.
- Canvas interactions must respect the active tool in state (`select`, `pen`, `edit`, `measure`, etc.).  Selections, node manipulation, and measurement overlays are driven from `CanvasViewport` using store actions.
- Units inside the UI are **micrometres (μm)**.  Never reintroduce raw pixel units in UI strings or overlays.
- The oxide preview is drawn inside the canvas renderer.  Do not remove the gradient fill between the external contour and the oxidised inner contour unless a spec change requires it.

## Documentation Discipline

Whenever you make a material change (new feature, bug fix, behavioural tweak, schema change, etc.) you **must** update this handbook with:

- A short description of the change and the rationale/bug it addresses.
- Any new invariants or gotchas future agents need to respect.
- Follow-up chores or tech debt created by the change.

Think of this file as the living design history.  Out-of-date instructions cause regressions, so keep it synchronised with the codebase.

## 2024-05-27 — Interactive editor & library overhaul

- Canvas interactions now cover node dragging (select/edit), pen-based contour sketching, and measurement in μm.  Do not regress pointer-capture logic inside `CanvasViewport`—other tools depend on it.
- Oxidation rendering draws a ribbon gradient between the base contour and the inner oxide preview.  Respect the `oxidationVisible` flag when adding new render passes.
- Directional weights are edited through the on-canvas compass (`DirectionalCompass`).  Avoid reintroducing the old slider grid; keep this overlay responsive.
- Scene management gained a local library persisted to `localStorage`.  Use the helpers in `workspaceStore` when adding export/import features so persistence stays consistent.
- Default geometry comes from `createCircleNodes` (see `src/utils/presets.ts`).  Reuse that helper for any future circular presets to avoid duplicated constants.
