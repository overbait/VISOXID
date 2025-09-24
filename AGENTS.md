# VISOXID Agent Handbook

This project implements **Oxid Designer**, a Vite + React + TypeScript workbench for editing closed 2D contours, previewing directional oxidation offsets, and exporting results.  The application renders exclusively to an HTML `<canvas>` (no SVG) and uses Zustand for state.  Geometry helpers live under `src/geometry`, canvas drawing primitives under `src/canvas`, and UI panels/controls under `src/ui`.

## Working Expectations

- The oxidation pipeline now derives the inner contour by first carving a uniform baseline offset with Clipper and then layering per-heading expansions along the outward normals.  Preserve this sequence inside `runGeometryPipeline()` so the oxide shell always honours the configured minimum thickness.
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
- Directional weights are edited through the compass card above the Tool panel.  Avoid reintroducing the old slider grid or the canvas overlay; keep this card responsive on narrow viewports.
- Scene management gained a local library persisted to `localStorage`.  Use the helpers in `workspaceStore` when adding export/import features so persistence stays consistent.
- Default geometry comes from `createCircleNodes` (see `src/utils/presets.ts`).  Reuse that helper for any future circular presets to avoid duplicated constants.

## 2024-05-28 — Oxidation synchronisation & contour hygiene

- Oxidation defaults and the active selection stay in lock-step.  Use `updateSelectedOxidation` when adjusting per-path values so the geometry pipeline re-runs and history snapshots remain consistent.
- Segment toggling (line ↔︎ Bézier) is handled in the store via `toggleSegmentCurve`.  Any future editing affordances should reuse that action to keep mirrored/closed path invariants intact.
- Path endpoints auto-close when they approach within ~4 μm and mirror snapping pins points to the configured axes—avoid bypassing `mergeEndpointsIfClose` or `applyMirrorSnapping` when mutating node arrays.
- Inner oxidation silhouettes are now cleaned with Clipper before resampling; if you extend the offset logic, feed new contours back through `cleanAndSimplifyPolygons` so ribbons never self-intersect.
- UI and models now clamp oxide inputs to ≤ 10 μm.  Preserve `MAX_THICKNESS_UM` when introducing new entry points or validation.

## 2024-05-29 — 50 μm viewport, mirrored previews & smarter pen

- The canvas now renders a fixed 50 μm × 50 μm work area.  All canvas drawing helpers accept a `ViewTransform` and must convert world coordinates to screen space via `worldToCanvas`/`computeViewTransform`.
- Pointer interactions operate in micrometre space.  Use `canvasDistanceToWorld` when comparing hit-test radii so behaviour stays consistent after future zoom tweaks.
- Mirror preview draws reflected copies instead of duplicating nodes.  Feed any new render passes the workspace `mirror` settings so reflected geometry stays in sync.
- The pen tool only extends from contour endpoints and honours snaps to existing nodes; re-use `penDraft.activeEnd` when adding new gestural behaviours to avoid spawning duplicate vertices.

## 2024-05-30 — Node editing affordances & measurement overhaul

- Workspace state now tracks `nodeSelection`; canvas hit-tests update this so the Scene panel can expose node-level toggles.  When mutating geometry arrays call `pruneNodeSelection` (or mirror its behaviour) to keep the selection in sync and avoid dangling node ids.
- `setNodeCurveMode` promotes/demotes a node’s adjacent segments between straight and Bézier defaults.  Reuse it from UI rather than crafting handles manually—this helper preserves mirror snapping and history bookkeeping.
- The measurement store no longer keeps a history list.  Hovering the outer contour populates `hoverProbe`, dragging creates `dragProbe`, and the last action pins to `pinnedProbe`.  All renderers read these three fields; don’t reintroduce the old history array.

## 2024-06-01 — Compass spokes, progressive oxidation & baseline offsets

- Directional weights surface as coloured spokes in the compass card (`DirectionalCompass`). Each spoke length & hue encode the μm value; clicking opens a nearby popover with ± nudges and a numeric input. The outer plus button toggles add mode—while active, click the rim to insert a new heading. Keep Delete support for the focused spoke and honour the `directionalLinking` flag when propagating edits.
- Heading data still travels through `DirectionWeight` objects (`id`, `label`, `angleDeg`, `valueUm`). `evalThickness` continues to blend headings with a cosine falloff and the global oxidation progress scalar—pass `progress` everywhere thickness is evaluated so the card, slider, and preview stay synchronised.
- Oxidation preview scaling is controlled by `workspaceStore.setOxidationProgress`. The Canvas viewport renders a bottom slider—leave it functional and ensure future changes clamp values to [0, 1] before re-running `runGeometryPipeline`.
- Inner oxide geometry now combines a Clipper-derived uniform inset with extra directional travel along each sample’s outward normal. Preserve this baseline-before-extras ordering when adjusting the pipeline and continue to sanitise the resulting polygons with `cleanAndSimplifyPolygons`.

## 2024-06-02 — Clipper offset execution fix

- `computeOffset` must call `ClipperOffset.Execute` with an output array to avoid mutating a numeric delta (the JS port mutates the array argument). Reuse the shared helper and don’t reintroduce the old single-argument form—it hard-crashes the app on startup.

## 2025-02-14 — Baseline sample alignment

- Inner oxidation baselines derived from Clipper must stay rotationally aligned with the original fallback baseline before directional growth. When resampling the inset, rotate (and reverse if needed) so `baselineSamples[i]` lines up with the corresponding outer sample.
- Keep the raw fallback array as the ultimate reference; only swap in the aligned inset when its length matches the sample count.
- This alignment ensures directional expansions stay anchored to their intended compass spokes, especially on asymmetric shapes.
