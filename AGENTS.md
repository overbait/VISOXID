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

## 2025-10-15 — Normal ray re-projection

- When enforcing the minimum oxide thickness, project each sample along its inward normal until it intersects the dense arc envelope. This raycast distance replaces the old dot-product clamp so sharp corners expand smoothly instead of collapsing to straight chords.
- Keep the polygon reference (`projectionLoop`) in sync with the dense envelope you intend to visualise; the ray projection assumes the polygon is closed and non-degenerate.
- Falling back to the previous per-sample candidate is still allowed, but only after a raycast fails—don’t remove the guard, it maintains backwards compatibility for open paths and degenerate normals.

## 2025-10-16 — Disc-envelope sampling fix _(superseded)_

- `deriveInnerGeometry` previously sampled each oxidation circle directly at adaptive angular steps, discarding directions that pointed outward or became occluded by a neighbour’s disc.
- When a sample contributed no visible arc, we fell back to casting its inward normal through the disc envelope. This strategy has since been replaced—see 2025-10-17 for the current workflow.

## 2025-10-17 — Clipper-led baseline envelope

- `deriveInnerGeometry` now seeds the inner loop from a Clipper “round” inset built with the uniform thickness before re-aligning samples. Keep the `computeOffset(..., { delta: -uniformThickness })` call so sharp corners render as circular fillets instead of collapsing into triangles.
- The inset polygon only serves as the projection reference—the final per-sample points are still obtained by raycasting along each inward normal and clamping to at least the requested (uniform + directional) thickness. Do not remove the `enforceMinimumOffset` raycast.
- Cleaning runs on the projected loop itself; if it self-intersects we resample the dominant polygon back onto the sample indices before re-projecting. Preserve this ordering so measurement probes stay paired with their outer samples.

## 2025-10-18 — SDF iso-contour reconstruction

- `deriveInnerGeometry` now samples an SDF grid of the outer loop (via `sdf-polygon-2d`) and extracts the zero contour of `distance - thickness(angle)` using `marching-squares`. This iso-contour seeds the inner loop prior to smoothing/resampling—keep the march in place so directional weight tweaks immediately affect the field.
- Expand the sampled bounds by the maximum requested thickness plus a small margin tied to `thicknessOptions.resolution`; otherwise the iso loop can clip at the grid edge.
- The marched contour is still re-aligned to the outer samples and pushed through the minimum-thickness raycast. Preserve this enforcement so measurement probes honour the configured oxide floor even if the iso field under-shoots in tight corners.

## 2025-10-19 — SDF outer loop sanitisation

- `deriveInnerGeometry` strips duplicated closing samples and sequential near-duplicates from the outer loop before instantiating `polygonSdf`. Leave this guard intact; zero-length edges from duplicate samples trigger NaNs inside the SDF implementation.
- When sampling the scalar field, non-finite evaluations are clamped to the uniform-thickness floor so the marching-squares pass keeps running instead of crashing the app.
