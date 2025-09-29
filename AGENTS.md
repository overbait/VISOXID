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

## 2025-02-14 — Multi-loop oxidation alignment rewrite

- `deriveInnerGeometry` now ray-marches each outer sample toward the Clipper inset so multi-lobed baselines keep their own sample groups. Do not short-circuit this cast; directional extras depend on the per-sample hit result.
- Inner candidates are cleaned per inset loop and resampled back onto the original sample indices. If you tweak this, make sure `innerSamples[i]` still pairs with `samples[i]` even when inset polygons split apart.
- The grouped cleaning step may return multiple loops—keep assigning anchors by proximity so stray spokes don’t jump across gaps. If you add new filters, preserve this grouping.

## 2025-09-24 — SDF marching-squares integration fix

- When deriving inner oxidation silhouettes from the SDF march, pass `[0]` as the iso threshold and flatten the resulting `isoLines` nest—newer versions of the library require an array and TypeScript now enforces the signature.
- Immediately feed the marched rings through `cleanAndSimplifyPolygons` and choose the dominant loop via absolute area so self-intersections are scrubbed before resampling against the outer samples.
- The scalar-field gradient must be normalised before looking up directional thickness; keep the `normalize` call so angle lookups remain stable near flat regions.
- A local `sdf-polygon-2d` module declaration lives under `src/types/`; add new ambient types there when bringing in future untyped geometry helpers.

## 2025-09-25 — SDF dependency hygiene

- `sdf-polygon-2d` expects `point-in-big-polygon` at runtime but omits it from its manifest. Keep `point-in-big-polygon` listed in our own dependencies so Vite’s dev server and build pipeline can resolve the require chain without manual patching.

## 2025-10-10 — Variable-radius inner offset

- `deriveInnerGeometry` now builds the oxide interior using a variable-radius power diagram instead of rasterised SDF marching squares. Each boundary sample contributes a circle with its local thickness; visible arcs define the offset envelope.
- The helper filters arcs to the inward half-space so compass headings (“N”, “E”, …) map to the expected directions after evaluating normals.
- A small Laplacian smoothing pass post-processes the sampled loop to remove stair-steps before cleaning/resampling. Preserve this order if you refine the algorithm.

## 2025-10-11 — Normal orientation & adaptive oxide resolution

- `recomputeNormals` now flips averaged normals that point inward on closed loops using a centroid alignment check. Do not remove this guard—directional weights assume outward-facing normals.
- The compass defaults map `E/N/W/S` to `0°/90°/180°/270°` so UI spokes match world-space directions. Keep this ordering when seeding new headings.
- `ThicknessOptions` gained an optional `resolution` that defaults to `min(0.5, uniformThickness / 4)`. `deriveInnerGeometry` uses it for cleaning tolerance and picks between one or two Laplacian smoothing iterations via `laplacianSmooth(..., { closed: true })`.

## 2025-10-12 — Oxide inner loop fidelity guard

- `deriveInnerGeometry` now aligns the smoothed candidate loop back to the fallback normal projection before any cleaning. Only when the loop self-intersects do we route it through `cleanAndSimplifyPolygons`; otherwise we keep the full sample count so the inner contour mirrors the outer geometry.
- The self-intersection test treats adjacent segments as shared vertices—don’t reuse it for open polylines without rethinking the guard.

## 2025-10-13 — Normal-locked oxide floor

- `recomputeNormals` now derives tangents from central differences (with optional smoothing) and normalises per-sample so normals stay perpendicular to the actual path, even through sharp corners. Keep this routine if you tweak sampling—directional weights assume normals never skew off their spokes.
- `deriveInnerGeometry` reprojects all candidates back onto each sample’s inward normal after smoothing/cleaning, clamping travel to at least the requested thickness (uniform + compass weight). Any future adjustments must preserve this minimum-distance enforcement so oxide thickness never drops below the configured floor.

## 2025-10-14 — Arc-sampled oxide envelope

- `deriveInnerGeometry` now builds a dense envelope by sampling the visible arcs of each per-sample oxidation circle (minimum six points per segment) before resampling back to the original sample count. Preserve this arc sampling when tuning offsets so the inner contour keeps circular curvature instead of collapsing to straight chords.
- The dense arc cloud is cleaned separately and exposed through `innerPolygons`; reuse the `closedDenseLoop` helper when exporting or debugging to avoid reintroducing duplicate closing vertices.
- Arc sampling depends on the outer loop orientation; if you change how samples are ordered, recompute the `orientationSign` in lock-step so arc traversal stays consistent.

## 2025-10-15 — Compass polygon weights & point oxidation

- Directional thickness is now evaluated by interpolating the polygon traced by compass spokes (with the centre treated as `0 μm`) instead of cosine falloffs. When mirroring angles, average the mirrored polygon value with the primary before combining with the uniform baseline.
- The compass chain toggle now applies linked edits to every heading by the same delta. Adding a heading while linked seeds it with the mean of the existing spokes so the polygon stays watertight.
- Standalone sample points (paths reduced to a single node) synthesise an oxide patch by sampling the compass polygon into `innerPolygons`. The canvas renderer fills these loops directly for point oxidations—keep this branch intact when reworking contour drawing.
- The default oxide resolution tightened to `min(0.35, uniform/6)` so envelopes retain more geometry before smoothing; preserve this when tuning tolerances to avoid reintroducing faceting at joins.

## 2025-10-16 — Compass preview hull & open-path smoothing

- The directional compass now draws the evaluated oxidation hull (including the uniform baseline) so designers can see the active contour while adjusting spokes. When tweaking these visuals, keep the hull in sync with `evalThicknessForAngle` and respect the current oxidation progress scalar.
- Uniform thickness renders as a dashed ring beneath the hull; leave it in place so users can distinguish baseline thickness from directional spikes.
- Single-node paths rely on a synthetic sample so the geometry pipeline always produces a dense radial patch—preserve this guard when editing `runGeometryPipeline`.
- Open polylines smooth their inner samples with a light Laplacian pass before enforcing the minimum offset. Any future changes must keep the smoothing before the min-distance clamp to avoid kinks returning at sharp bends.

## 2025-10-17 — Global compass inspector & measurement alignment

- The compass card now edits a single global oxidation profile. Updating spokes, uniform thickness, or mirror symmetry must route through `updateOxidationDefaults`, which propagates the merged settings to every path via `applyGlobalOxidation`. Do not reintroduce per-path overrides.
- Compass spokes expose their label, angle, and μm contribution inside the inspector beneath the dial. Preserve the angle collision guard (0.5° minimum separation) when extending these controls.
- Point oxidation loops use the compass orientation directly (`center + cos/sin`). Keep this sign so the canvas profile matches the compass preview.
- Open-path inner samples receive a tangential offset derived from ±90° compass evaluations before smoothing—retain this blend so straight traces bow in response to directional weights.
- The measurement tool now queries the global profile along the drag heading. Keep `sampleGlobalThickness` intact so drags anywhere on the canvas reflect oxidation distance rather than raw Euclidean length.
- Tool ids `pen`/`edit` were replaced with `line`/`dot` (with `dot` spawning a single-node path). Update shortcuts or hit-tests using these ids and leave the square canvas container in place; avoid restoring the old stretched viewport.

## 2025-10-18 — Pointer-oriented probes & open-line envelopes

- Hover measurements now orient toward the pointer direction, sampling the compass contour for that heading and mirroring single-node (dot) paths around their center. Preserve the pointer-driven fallback when tweaking hit-tests so probes appear on any side of a dot.
- Open polylines derive their inner contour from the same circle-envelope union used for closed loops before enforcing the minimum offset. Avoid reinstating the old tangential delta—straight traces should bow to match the compass hull.

## 2025-10-19 — Global zoom & compass-driven open envelopes

- The canvas viewport now stores a `zoom` scalar in workspace state, exposes slider/± controls in the viewport overlay, and honours Ctrl/⌘ + wheel gestures. When using `computeViewTransform`, always pass the current zoom so hit-testing and rendering stay aligned.
- `computeCircleEnvelope` evaluates the compass polygon per arc direction and, for open paths, samples the full 360° envelope. Keep passing the active `ThicknessOptions` so directional edits immediately bend open-line oxidation.
- Minimum-offset enforcement preserves tangential displacement; only push samples along their normal when the travelled distance drops below the required thickness. This keeps globally biased oxidations from snapping back to straight lines.

## 2025-10-20 — Compass envelope orientation floor

- `computeCircleEnvelope` now evaluates arc radii directly from the compass polygon per heading instead of clamping to the sample’s own offset. Leave the min-distance enforcement in `deriveInnerGeometry` to guarantee the requested thickness instead of reintroducing local `Math.max` guards.
- Dense arc sampling pushes every chosen candidate point into the `denseLoop` and bumps the minimum subdivisions to 12 so closed loops keep enough geometry to avoid collapsing when forms are sealed.
