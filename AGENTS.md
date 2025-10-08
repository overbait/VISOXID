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
- UI and models now clamp oxide inputs to ≤ 10 μm.  Preserve `MAX_THICKNESS_UM` when introducing new entry points or validation. *(Superseded by the 2025-11-20 update removing this ceiling.)*

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

## 2025-10-31 — Circle envelope arc coverage

- `computeCircleEnvelope` now feeds every visible arc segment (post-occlusion) into the dense loop, preferring arcs that face inward on open spans. Keep this sweep intact so the dashed oxide contour reflects contributions from all headings without reintroducing the heavy radial spoke sampling.
- Closed-loop envelopes reject any arc segments that fail the inward-facing check instead of falling back to outward spans. If no inward arc survives the occlusion sweep, the solver reverts to the sample’s baseline normal projection so compass biases stay aligned with the same global heading everywhere on the contour.
- Arc subdivision counts depend on the arc span and current resolution; avoid dropping below two samples per arc or narrow intersections between circles will disappear from the preview.

## 2025-11-01 — Global compass orientation for open paths

- Circle envelopes now evaluate compass radii in world space for open paths instead of mirroring across the inward normal. When tuning the solver, keep `options.restrictToInward` as the switch between inward-only (closed loops) and global headings (open traces) so compass edits stay aligned with the same absolute orientation everywhere.

## 2025-11-02 — Open-path envelope maximises global headings

- Open-path circle envelopes now pick the visible heading with the greatest compass radius instead of clamping to the sample’s inward normal. Preserve this maximisation so straight segments continue to follow the global orientation regardless of their tangent direction.

## 2025-11-03 — Compass dot preview overlay

- The canvas no longer renders the oxide ribbon or dashed inner contour; `drawContours` now only strokes the outer path with a solid line. Keep it this way so the preview stays focused on per-point dots.
- Line oxidation is visualised through `drawOxidationDots`, which drops translated compass patches along each sampled slice. Respect `oxidationDotCount` and the `oxidationVisible` flag when adjusting this overlay.
- The Oxidation panel exposes a “Line preview dots” slider (0–1000). When touching the store, continue to clamp values via `clampDotCount` so undo/redo snapshots remain consistent.

## 2025-11-04 — Canvas pan, collapsible panels & duplication

- Workspace view state now tracks a `pan` vector alongside `zoom`. Use `panBy`/`setPan` when implementing navigation controls and always pass the active pan into `computeViewTransform` so hit-tests and rendering remain aligned.
- The right-hand sidebar reclaiming logic hinges on `panelCollapse.rightSidebar`; preserve the CSS variable `--right-column` that App.tsx sets so the canvas can expand when the sidebar is hidden.
- Dragging with the Select tool translates whole paths via `translatePaths`. The helper skips locked paths and records history—reuse it for future bulk transforms instead of reimplementing per-path loops.
- The Tool panel now offers a Copy action (`duplicateSelectedPaths`, also bound to ⌘/Ctrl+D) that clones the current selection in-place. When introducing new selection tools, make sure they update `selectedPathIds` so duplication remains accurate.
- Measurement drags are unconstrained ruler reads; probes store real endpoint coordinates instead of snapping to oxidation thickness. Hover measurements still sample the oxidation profile—preserve both modes when refining overlays.

## 2025-11-05 — Centered zoom, roaming grid & collapse toggles

- View transforms now keep the 50 μm workspace centred during zoom and apply pan deltas in canvas space. When adjusting navigation, update `computeViewTransform`/`CanvasViewport` together so drag maths stay stable after zooming.
- Grid rendering projects from the current canvas bounds via `canvasToWorld`, so it follows the viewport anywhere. Avoid reintroducing fixed `0…extent` loops or the grid will disappear when panning.
- The right-hand controls now collapse via a shared sidebar toggle. Honour `panelCollapse.rightSidebar` when adjusting layout so `CanvasViewport` width hints stay in sync.

## 2025-11-06 — Unified sidebar collapse & PNG export stub

- `panelCollapse` now only tracks `rightSidebar`; call `setPanelCollapsed(boolean)` to hide or reveal the Oxidation, Grid, and Measurement cards together and update any new UI to respect this global toggle.
- Legacy snapshots may still carry `panelCollapse.oxidation/grid`; reuse `normalizePanelCollapse` when touching history/import logic so they migrate cleanly.
- The compass inspector swaps the old helper text for an “Export PNG” button that currently fires an info toast via `pushWarning`. Wire the actual export routine through this button in future changes.
- App bootstrap now guards the demo circle seeding with a ref so StrictMode’s double effects don’t spawn duplicate geometry. Keep this sentinel in place if you refactor startup flows.

## 2025-11-07 — DXF interchange & reference geometry mode

- Paths now carry a `meta.kind` (`'oxided'` | `'reference'`). Reference paths act as grey, non-oxidised guides: no dots, no thickness evaluation, and no per-node editing. Use `setPathType` to flip modes so undo/redo and geometry recomputation stay in sync.
- Canvas hit-tests skip reference paths for node/segment edits and handles never render for them. They can still be translated as a whole via `translatePaths`.
- `runGeometryPipeline` zeros thickness/inner geometry for reference paths. If you create new entry points, make sure reference mode routes through this same guard before invoking the offset solver.
- DXF import/export lives under `src/utils/dxf.ts`. The importer supports `LINE` and `LWPOLYLINE` entities, recentres everything to the 50 μm workspace, and maps the `REFERENCE` layer to the reference path kind. Keep exports using those same layers so round-trips remain lossless.

## 2025-11-08 — Tool selector memoisation guard

- Components should never subscribe to Zustand selectors that build new arrays or objects on every render; doing so trips React’s external-store guard and bricks the UI with an infinite update loop. Derive filtered selections with `useMemo` (fed by stable store slices) or provide a comparator when you need structural equality.

## 2025-11-09 — Path kind inspector & DXF arc sampling

- The path type selector now lives on the right rail beneath the Oxidation card. Keep its mixed-selection banner and reuse `setPathType` so undo/redo and the geometry pipeline stay consistent when flipping modes.
- DXF import now approximates `ARC` and `CIRCLE` entities into polylines (64 segments for a full circle). Preserve this conversion so guides from AutoCAD round-trip without manual edits, and keep centring the result in the 50 μm workspace before adding paths.
- The canvas centre column no longer hard-limits its width when the sidebar is expanded, ensuring the gap matches the left rail, and zoom tops out at ×4. Honour these bounds when adjusting layout or viewport behaviour.

## 2025-11-10 — Scene snapshots & DXF curve preservation

- Workspace state now persists complete scene snapshots in `scenes`. Use `saveSceneToLibrary`/`loadSceneFromLibrary` for library interactions, and update `captureSceneState` plus the persistence helpers when adding new top-level store fields so saved scenes stay lossless.
- DXF import promotes `CIRCLE`/`ARC` entities into Bézier-based nodes via `buildNodesFromDXFShape` (`createCircleNodes`/`createArcNodes`). Extend that pipeline for additional entity types to keep curvature intact instead of falling back to polylines.
- The Scene panel splits saved scenes and shapes with shared rename/load affordances and exposes a diameter input under “Add reference circle”. Keep the copy control inside the tool grid and maintain the new left/right sidebar card order (grid tools on the left, scene management on the right).

## 2025-11-11 — Multi-node marquee & oxide-edge hover reads

- The Select tool now supports marquee selection by dragging from empty canvas space. Honour the `boxSelection` session in `CanvasViewport` when tweaking pointer handlers and keep Shift-drag additive to the existing node selection.
- Node drags can move multiple anchors at once; grouped updates route through `translateNodeGroup` so handles shift together and history stays consistent. Avoid bypassing this helper when touching group-drag logic.
- Hover measurements recognise hits on the oxidation edge as well as the outer contour. Preserve the combined inner/outer hit-testing so hover probes stay responsive even when pointing at the oxide boundary.

## 2025-11-12 — Oxidation dot clipping masks

- `drawOxidationDots` now clips each rendered dot against its closed contour so the exterior half stays invisible. When touching this overlay, keep the per-variant canvas `clip()` guard so mirrored paths inherit the same masking without leaking across shapes.
- Only closed paths provide a clip polygon; open traces still render the full dot glyph. Preserve this distinction so open-line previews keep showing both sides of the stroke.

## 2025-11-13 — Export overview workspace & measurement palette

- The “Export PNG” placeholder became a full export overview. `openExportView`/`closeExportView` toggle a read-only layout that reuses the canvas in presentation mode, locks the tool to measurement by default, and restores the previous tool on exit. Use these store actions whenever you need to enter or leave the export workspace so the UI stays in sync.
- Export mode renders through `<CanvasViewport variant="export" />`, which suppresses zoom/timeline overlays. Pass the variant instead of cloning the viewport if you need the stripped-down canvas elsewhere.
- Directional headings now expose a summary compass (`ExportView.tsx`) that mirrors the live weights but pins numeric labels around the rim. Keep the label underline colour in sync with `valueToColor` so screenshots remain legible.
- Measurements can be saved for export via `exportView.measurements`. Add entries by calling `addExportMeasurement` with a captured `MeasurementProbe`, update colours through `updateExportMeasurementColor`, and remove with `removeExportMeasurement`. Saved probes clone coordinates and receive fresh ids; avoid mutating them in place.
- Canvas measurement strokes now default to the darker `#1e3a8a` tone to avoid clashing with oxidation dots. Match this hue for any new measurement-related UI to keep styling consistent.

## 2025-11-14 — Export overview layout refinements

- The export compass now renders in a compact 260 px frame with numeric μm labels only. Keep the per-heading underline colours in sync with `valueToColor` and avoid reintroducing compass progress readouts.
- Export overview’s secondary summary collapsed into the dedicated uniform thickness card—surface extra oxidation metadata elsewhere if needed, but leave this screen focused on the single baseline metric.
- `<CanvasViewport variant="export" />` should remain editing-neutral: double-click segment toggles stay disabled and the canvas gets the wider 820 px max width so it dominates the layout. Respect these guards when extending export interactions.

## 2025-11-15 — Export capture polish

- Export mode should omit node anchors and Bézier handles entirely. Guard `drawHandles` so the canvas is free of editing affordances while `exportView.active` is true.
- Compass labels in the export overview must stay on a single line (`value μm`). Preserve the `whitespace-nowrap` styling (or equivalent) when adjusting the markup so right-hand headings don’t wrap.

## 2025-11-16 — Export data capture & scene interchange

- Export overview labels now support directional-only and total (directional + uniform) readouts via a toggle in the compass card. Keep the control present when touching this view so screenshot authors can switch modes.
- Saved export measurements render distance-only callouts on the canvas. When extending measurement drawing, keep export mode hiding labels/angles for saved entries so captures stay clean.
- Scene library entries can be exported/imported as JSON bundles. Use `handleSceneExport`/`importSceneToLibrary` for new entry points so the `{ version: 1, scene }` payload remains consistent and sanitisation stays centralised.

## 2025-11-17 — Dev server helper script

- A `start-dev.sh` script now bootstraps dependencies (if `node_modules` is missing), launches `npm run dev` with overridable `HOST`/`PORT`, waits for the server to respond, and opens the workspace URL in the default browser. It streams logs until you exit; feel free to pass extra Vite flags via `VITE_DEV_ARGS`.

## 2025-11-18 — Canvas backing-store rounding fix

- Canvas resizing now rounds the backing-store dimensions **upwards** (`Math.ceil`) when applying device-pixel ratio scaling. This prevents sub-pixel gutters from accumulating stale frame data along the lower-right edge. Keep using ceiling rounding if you touch `CanvasRenderer.resize()` so the render loop always clears the full visible surface.
- `CanvasRenderer` stores the CSS pixel width/height captured from the `ResizeObserver` and clears the backing store with the identity transform before reapplying DPR scaling each frame. Preserve this two-step clear so fractional CSS sizes map cleanly to device pixels without leaving a ghosted band along the bottom-right edge.

## 2025-11-19 — Bidirectional oxidation toggle & measurement label shift

- `PathMeta` now carries an `oxidationDirection` (`'inward' | 'outward'`) and defaults to `'inward'`. The Path Type panel exposes a toggle whenever the active selection is oxided—call `setOxidationDirection` so undo history and geometry recomputation stay in sync.
- Outward oxidation flips the sampled normals before entering `deriveInnerGeometry` and inverts the dot clip mask using an even-odd pass across the whole canvas. When adding new renders, honour the `oxidationDirection` so exterior previews stay masked correctly.
- Measurement callouts anchor near the probe’s start point with a short along-track offset. If you add new measurement overlays keep the offset away from the handle origin so the glyph doesn’t hide the anchor.

## 2025-11-20 — Compass scaling & oxidation defaults

- The Path Type panel’s inside/outside switch now sits directly under the Oxided button with the compact “inside - outside” label. Keep this placement when adjusting the layout so the toggle stays adjacent to the path mode control.
- Directional thickness inputs no longer clamp at 10 μm; treat every non-negative value as valid and avoid reintroducing hard maximums in the store or compass editor. The preview spokes should continue to grow proportionally beyond the original compass boundary.
- Oxidation preview dots now default to 130 and the Oxidation panel no longer exposes the mirror symmetry checkbox. Leave the new default in place when seeding state or resetting the workspace.

## 2025-11-21 — Compass evaluation ceiling removal

- `evalThickness`/`evalThicknessForAngle` now respect the unlimited directional values. Don’t restore the old 10 μm clamp inside `src/geometry/thickness.ts`; the compass preview and geometry pipeline rely on the full range.


## 2025-11-22 — Scene panel split & compass linking default
- The Scene panel is now two cards: the upper card pairs segment mode toggles with the reference circle/oval controls, and the lower “Stored” card owns naming plus the scene/shape libraries. Keep delete/reset actions in the left rail’s quick-actions card rather than reintroducing them on the right.
- `directionalLinking` defaults to `false` so the compass starts with per-spoke adjustments. When hydrating or resetting workspace state, continue using `false` unless the payload explicitly requests otherwise.
