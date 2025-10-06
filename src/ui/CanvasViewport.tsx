import { useEffect, useRef, useState, type PointerEvent, type WheelEvent } from 'react';
import { clsx } from 'clsx';
import { createRenderer } from '../canvas/renderer';
import { useWorkspaceStore } from '../state';
import { createId } from '../utils/ids';
import { distance, toDegrees } from '../utils/math';
import type { PathEntity, SamplePoint, Vec2 } from '../types';
import {
  canvasDistanceToWorld,
  canvasToWorld,
  computeViewTransform,
  type ViewTransform,
} from '../canvas/viewTransform';
import { evalThicknessForAngle } from '../geometry';

type DragTarget =
  | { kind: 'anchor'; pathId: string; nodeId: string }
  | { kind: 'handleIn' | 'handleOut'; pathId: string; nodeId: string };

const nodeHitThresholdPx = 12;
const pathHitThresholdPx = 10;
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 8;
const ZOOM_STEP = 1.1;

const pointSegmentDistance = (p: Vec2, a: Vec2, b: Vec2): number => {
  const ab = { x: b.x - a.x, y: b.y - a.y };
  const ap = { x: p.x - a.x, y: p.y - a.y };
  const abLenSq = ab.x * ab.x + ab.y * ab.y;
  const t = abLenSq === 0 ? 0 : Math.max(0, Math.min(1, (ap.x * ab.x + ap.y * ab.y) / abLenSq));
  const closest = { x: a.x + ab.x * t, y: a.y + ab.y * t };
  return distance(p, closest);
};

const orderPathsBySelection = (paths: PathEntity[], selectedIds: string[]): PathEntity[] => {
  const selectedSet = new Set(selectedIds);
  return [
    ...paths.filter((path) => selectedSet.has(path.meta.id)),
    ...paths.filter((path) => !selectedSet.has(path.meta.id)),
  ];
};

export const CanvasViewport = () => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const activeTool = useWorkspaceStore((state) => state.activeTool);
  const setHoverProbe = useWorkspaceStore((state) => state.setHoverProbe);
  const setPinnedProbe = useWorkspaceStore((state) => state.setPinnedProbe);
  const setDragProbe = useWorkspaceStore((state) => state.setDragProbe);
  const measurements = useWorkspaceStore((state) => state.measurements);
  const setSelected = useWorkspaceStore((state) => state.setSelected);
  const setNodeSelection = useWorkspaceStore((state) => state.setNodeSelection);
  const translatePaths = useWorkspaceStore((state) => state.translatePaths);
  const updatePath = useWorkspaceStore((state) => state.updatePath);
  const addPath = useWorkspaceStore((state) => state.addPath);
  const setPathMeta = useWorkspaceStore((state) => state.setPathMeta);
  const toggleSegmentCurve = useWorkspaceStore((state) => state.toggleSegmentCurve);
  const oxidationProgress = useWorkspaceStore((state) => state.oxidationProgress);
  const setOxidationProgress = useWorkspaceStore((state) => state.setOxidationProgress);
  const zoom = useWorkspaceStore((state) => state.zoom);
  const setZoom = useWorkspaceStore((state) => state.setZoom);
  const zoomBy = useWorkspaceStore((state) => state.zoomBy);
  const pan = useWorkspaceStore((state) => state.pan);
  const panBy = useWorkspaceStore((state) => state.panBy);
  const panelCollapse = useWorkspaceStore((state) => state.panelCollapse);
  const measureStart = useRef<{ origin: Vec2; moved: boolean } | null>(null);
  const dragTarget = useRef<DragTarget | null>(null);
  const selectionDrag = useRef<{ pathIds: string[]; last: Vec2; moved: boolean } | null>(null);
  const panSession = useRef<{ lastCanvas: Vec2 } | null>(null);
  const penDraft = useRef<{ pathId: string; activeEnd: 'start' | 'end' } | null>(null);
  const [cursorHint, setCursorHint] = useState<string | null>(null);

  const canvasWidthClass = panelCollapse.oxidation && panelCollapse.grid
    ? 'max-w-[1080px]'
    : panelCollapse.oxidation || panelCollapse.grid
      ? 'max-w-[920px]'
      : 'max-w-[760px]';

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const renderer = createRenderer(canvas, () => useWorkspaceStore.getState());
    renderer.start();
    return () => renderer.stop();
  }, []);

  const getPointerContext = (event: PointerEvent<HTMLCanvasElement>): {
    world: Vec2;
    canvas: Vec2;
    view: ViewTransform;
  } => {
    const canvas = canvasRef.current;
    if (!canvas) {
      const view = computeViewTransform(1, 1, zoom, pan);
      return { world: { x: 0, y: 0 }, canvas: { x: 0, y: 0 }, view };
    }
    const rect = canvas.getBoundingClientRect();
    const canvasPoint = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
    const view = computeViewTransform(rect.width, rect.height, zoom, pan);
    const world = canvasToWorld(canvasPoint, view);
    return { world, canvas: canvasPoint, view };
  };

  const hitTestNodes = (position: Vec2, view: ViewTransform): DragTarget | null => {
    const state = useWorkspaceStore.getState();
    const ordered = orderPathsBySelection(state.paths, state.selectedPathIds);
    const threshold = canvasDistanceToWorld(nodeHitThresholdPx, view);
    for (const path of ordered) {
      for (const node of path.nodes) {
        if (distance(position, node.point) <= threshold) {
          return { kind: 'anchor', pathId: path.meta.id, nodeId: node.id };
        }
        if (node.handleIn && distance(position, node.handleIn) <= threshold) {
          return { kind: 'handleIn', pathId: path.meta.id, nodeId: node.id };
        }
        if (node.handleOut && distance(position, node.handleOut) <= threshold) {
          return { kind: 'handleOut', pathId: path.meta.id, nodeId: node.id };
        }
      }
    }
    return null;
  };

  const hitTestPath = (position: Vec2, view: ViewTransform): string | null => {
    const state = useWorkspaceStore.getState();
    const threshold = canvasDistanceToWorld(pathHitThresholdPx, view);
    for (const path of state.paths) {
      const samples = path.sampled?.samples ?? [];
      if (samples.length) {
        for (let i = 1; i < samples.length; i += 1) {
          if (pointSegmentDistance(position, samples[i - 1].position, samples[i].position) <= threshold) {
            return path.meta.id;
          }
        }
      } else if (path.nodes.length > 1) {
        for (let i = 1; i < path.nodes.length; i += 1) {
          if (pointSegmentDistance(position, path.nodes[i - 1].point, path.nodes[i].point) <= threshold) {
            return path.meta.id;
          }
        }
      }
    }
    return null;
  };

  const hitTestSegment = (
    position: Vec2,
    view: ViewTransform,
  ): { pathId: string; segmentIndex: number } | null => {
    const state = useWorkspaceStore.getState();
    const threshold = canvasDistanceToWorld(pathHitThresholdPx, view);
    for (const path of state.paths) {
      const { nodes } = path;
      const totalSegments = path.meta.closed ? nodes.length : nodes.length - 1;
      if (totalSegments < 1) continue;
      for (let i = 0; i < totalSegments; i += 1) {
        const a = nodes[i].point;
        const b = nodes[(i + 1) % nodes.length].point;
        if (pointSegmentDistance(position, a, b) <= threshold) {
          return { pathId: path.meta.id, segmentIndex: i };
        }
      }
    }
    return null;
  };

  const sampleGlobalThickness = (angle: number): number => {
    const state = useWorkspaceStore.getState();
    return evalThicknessForAngle(angle, {
      uniformThickness: state.oxidationDefaults.thicknessUniformUm,
      weights: state.oxidationDefaults.thicknessByDirection.items,
      mirrorSymmetry: state.oxidationDefaults.mirrorSymmetry,
      progress: state.oxidationProgress,
    });
  };

  const updateHoverMeasurement = (position: Vec2, view: ViewTransform) => {
    if (measureStart.current) return;
    const state = useWorkspaceStore.getState();
    const threshold = canvasDistanceToWorld(pathHitThresholdPx, view);
    let closest: { sample: SamplePoint; distance: number } | null = null;
    for (const path of state.paths) {
      const samples = path.sampled?.samples ?? [];
      for (const sample of samples) {
        const dist = distance(position, sample.position);
        if (dist <= threshold && (!closest || dist < closest.distance)) {
          closest = { sample, distance: dist };
        }
      }
    }

    if (closest) {
      const sample = closest.sample;
      const offset = {
        x: position.x - sample.position.x,
        y: position.y - sample.position.y,
      };
      const offsetLength = Math.hypot(offset.x, offset.y);
      let orientation = {
        x: -sample.normal.x,
        y: -sample.normal.y,
      };
      let thickness = sample.thickness;

      if (offsetLength > threshold * 0.35) {
        const dir = {
          x: offset.x / offsetLength,
          y: offset.y / offsetLength,
        };
        orientation = { x: -dir.x, y: -dir.y };
        const angle = Math.atan2(orientation.y, orientation.x);
        thickness = sampleGlobalThickness(angle);
      }

      const orientLength = Math.hypot(orientation.x, orientation.y) || 1;
      const unit = {
        x: orientation.x / orientLength,
        y: orientation.y / orientLength,
      };
      const inner = {
        x: sample.position.x + unit.x * thickness,
        y: sample.position.y + unit.y * thickness,
      };
      setHoverProbe({
        id: 'hover',
        a: sample.position,
        b: inner,
        distance: thickness,
        angleDeg: toDegrees(Math.atan2(inner.y - sample.position.y, inner.x - sample.position.x)),
        thicknessA: thickness,
        thicknessB: thickness,
      });
      return;
    }

    for (const path of state.paths) {
      if (path.nodes.length !== 1) continue;
      const center = path.nodes[0].point;
      const delta = {
        x: position.x - center.x,
        y: position.y - center.y,
      };
      const radius = Math.hypot(delta.x, delta.y);
      if (radius <= 1e-3) continue;
      const angle = Math.atan2(delta.y, delta.x);
      const thickness = sampleGlobalThickness(angle);
      if (thickness <= 0) continue;
      if (Math.abs(radius - thickness) > threshold * 1.25) continue;
      const dir = { x: delta.x / radius, y: delta.y / radius };
      const outer = {
        x: center.x + dir.x * thickness,
        y: center.y + dir.y * thickness,
      };
      setHoverProbe({
        id: 'hover',
        a: outer,
        b: { ...center },
        distance: thickness,
        angleDeg: toDegrees(Math.atan2(center.y - outer.y, center.x - outer.x)),
        thicknessA: thickness,
        thicknessB: thickness,
      });
      return;
    }

    setHoverProbe(null);
  };

  const updateGeometryForDrag = (target: DragTarget, position: Vec2) => {
    updatePath(target.pathId, (nodes) =>
      nodes.map((node) => {
        if (node.id !== target.nodeId) return node;
        if (target.kind === 'anchor') {
          return { ...node, point: position };
        }
        if (target.kind === 'handleIn') {
          return { ...node, handleIn: position };
        }
        return { ...node, handleOut: position };
      }),
    );
  };

  const handleLineInput = (position: Vec2, view: ViewTransform, clicks: number) => {
    const state = useWorkspaceStore.getState();
    const threshold = canvasDistanceToWorld(nodeHitThresholdPx, view);
    const closeThreshold = canvasDistanceToWorld(nodeHitThresholdPx + 4, view);
    const segmentHit = hitTestSegment(position, view);
    if (segmentHit) {
      const newNode = {
        id: createId('node'),
        point: position,
        handleIn: null,
        handleOut: null,
      };
      updatePath(segmentHit.pathId, (nodes) => {
        const next = [...nodes];
        next.splice(segmentHit.segmentIndex + 1, 0, newNode);
        return next;
      });
      setSelected([segmentHit.pathId]);
      setNodeSelection({ pathId: segmentHit.pathId, nodeIds: [newNode.id] });
      return;
    }
    if (!penDraft.current) {
      const firstNode = {
        id: createId('node'),
        point: position,
        handleIn: null,
        handleOut: null,
      };
      const pathId = addPath(
        [firstNode],
        {
          meta: {
            id: createId('path'),
            name: 'Sketch',
            closed: false,
            visible: true,
            locked: false,
            color: '#2563eb',
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
        },
      );
      penDraft.current = { pathId, activeEnd: 'end' };
      setSelected([pathId]);
      setNodeSelection({ pathId, nodeIds: [firstNode.id] });
      setCursorHint('Click to add points, double-click first point to close');
      return;
    }
    const path = state.paths.find((entry) => entry.meta.id === penDraft.current?.pathId);
    if (!path) {
      penDraft.current = null;
      setCursorHint(null);
      return;
    }
    const firstNode = path.nodes[0];
    const lastNode = path.nodes[path.nodes.length - 1];
    if (path.nodes.length >= 3 && distance(position, firstNode.point) <= closeThreshold) {
      setPathMeta(path.meta.id, { closed: true });
      penDraft.current = null;
      setCursorHint(null);
      return;
    }
    if (clicks >= 2 && path.nodes.length >= 2) {
      setPathMeta(path.meta.id, { closed: true });
      penDraft.current = null;
      setCursorHint(null);
      return;
    }
    const nearStart = distance(position, firstNode.point) <= threshold;
    const nearEnd = distance(position, lastNode.point) <= threshold;
    if (nearStart) {
      penDraft.current = { pathId: path.meta.id, activeEnd: 'start' };
      setSelected([path.meta.id]);
      setNodeSelection({ pathId: path.meta.id, nodeIds: [firstNode.id] });
      setCursorHint('Extending from starting node');
      return;
    }
    if (nearEnd) {
      penDraft.current = { pathId: path.meta.id, activeEnd: 'end' };
      setSelected([path.meta.id]);
      setNodeSelection({ pathId: path.meta.id, nodeIds: [lastNode.id] });
      setCursorHint('Extending from ending node');
      return;
    }
    const newNode = {
      id: createId('node'),
      point: position,
      handleIn: null,
      handleOut: null,
    };
    if (penDraft.current.activeEnd === 'start') {
      updatePath(path.meta.id, (nodes) => [newNode, ...nodes]);
    } else {
      updatePath(path.meta.id, (nodes) => [...nodes, newNode]);
    }
    setNodeSelection({ pathId: path.meta.id, nodeIds: [newNode.id] });
  };

  const handlePointerDown = (event: PointerEvent<HTMLCanvasElement>) => {
    const { world: position, canvas, view } = getPointerContext(event);
    if (activeTool === 'measure') {
      const dragId = createId('probe');
      measureStart.current = { origin: position, moved: false };
      setDragProbe({
        id: dragId,
        a: position,
        b: position,
        distance: 0,
        angleDeg: 0,
        thicknessA: undefined,
        thicknessB: undefined,
      });
      canvasRef.current?.setPointerCapture(event.pointerId);
      return;
    }
    if (activeTool === 'pan') {
      panSession.current = { lastCanvas: canvas };
      canvasRef.current?.setPointerCapture(event.pointerId);
      return;
    }
    if (activeTool === 'line') {
      handleLineInput(position, view, event.detail);
      canvasRef.current?.setPointerCapture(event.pointerId);
      return;
    }
    if (activeTool === 'dot') {
      const node = {
        id: createId('node'),
        point: position,
        handleIn: null,
        handleOut: null,
      };
      const pathId = addPath([node], {
        meta: {
          id: createId('path'),
          name: 'Dot',
          closed: false,
          visible: true,
          locked: false,
          color: '#2563eb',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      });
      setSelected([pathId]);
      setNodeSelection({ pathId, nodeIds: [node.id] });
      return;
    }
    if (activeTool === 'select') {
      const target = hitTestNodes(position, view);
      if (target) {
        dragTarget.current = target;
        setSelected([target.pathId]);
        setNodeSelection({ pathId: target.pathId, nodeIds: [target.nodeId] });
        updateGeometryForDrag(target, position);
        canvasRef.current?.setPointerCapture(event.pointerId);
        return;
      }
      const segment = hitTestSegment(position, view);
      if (segment && event.detail >= 2) {
        toggleSegmentCurve(segment.pathId, segment.segmentIndex);
        setSelected([segment.pathId]);
        return;
      }
      const pathId = hitTestPath(position, view);
      if (pathId) {
        const state = useWorkspaceStore.getState();
        const path = state.paths.find((entry) => entry.meta.id === pathId);
        const nextSelection = state.selectedPathIds.includes(pathId)
          ? [...state.selectedPathIds]
          : [pathId];
        setSelected(nextSelection);
        setNodeSelection(null);
        if (path && !path.meta.locked) {
          selectionDrag.current = { pathIds: nextSelection, last: position, moved: false };
          canvasRef.current?.setPointerCapture(event.pointerId);
          return;
        }
        return;
      } else if (!event.shiftKey) {
        setSelected([]);
        setNodeSelection(null);
      }
      return;
    }
  };

  const handlePointerMove = (event: PointerEvent<HTMLCanvasElement>) => {
    const { world: position, canvas, view } = getPointerContext(event);
    if (activeTool === 'measure') {
      if (measureStart.current && measurements.dragProbe) {
        const origin = measureStart.current.origin;
        const dx = position.x - origin.x;
        const dy = position.y - origin.y;
        const rawDistance = distance(origin, position);
        const threshold = canvasDistanceToWorld(4, view);
        if (!measureStart.current.moved && rawDistance > threshold) {
          measureStart.current.moved = true;
        }
        const angle = Math.atan2(dy, dx);
        setDragProbe({
          ...measurements.dragProbe,
          b: position,
          distance: rawDistance,
          angleDeg: toDegrees(angle),
          thicknessA: undefined,
          thicknessB: undefined,
        });
      } else {
        updateHoverMeasurement(position, view);
      }
      return;
    }
    if (activeTool === 'pan') {
      if (panSession.current) {
        const last = panSession.current.lastCanvas;
        const deltaCanvas = { x: canvas.x - last.x, y: canvas.y - last.y };
        if (Math.abs(deltaCanvas.x) > 1e-3 || Math.abs(deltaCanvas.y) > 1e-3) {
          const delta = {
            x: canvasDistanceToWorld(deltaCanvas.x, view),
            y: canvasDistanceToWorld(deltaCanvas.y, view),
          };
          panBy({ x: -delta.x, y: -delta.y });
          panSession.current.lastCanvas = canvas;
        }
      }
      return;
    }
    if (activeTool === 'select') {
      if (dragTarget.current) {
        updateGeometryForDrag(dragTarget.current, position);
        return;
      }
      if (selectionDrag.current) {
        const session = selectionDrag.current;
        const delta = { x: position.x - session.last.x, y: position.y - session.last.y };
        if (Math.abs(delta.x) > 1e-6 || Math.abs(delta.y) > 1e-6) {
          translatePaths(session.pathIds, delta);
          const deltaLength = Math.hypot(delta.x, delta.y);
          const moveThreshold = canvasDistanceToWorld(0.75, view);
          if (!session.moved && deltaLength > moveThreshold) {
            session.moved = true;
          }
          session.last = position;
        }
        return;
      }
    }
  };

  const handlePointerUp = (event: PointerEvent<HTMLCanvasElement>) => {
    if (activeTool === 'measure') {
      if (measureStart.current) {
        if (measureStart.current.moved && measurements.dragProbe) {
          const pinnedId = createId('probe');
          setPinnedProbe({
            ...measurements.dragProbe,
            id: pinnedId,
          });
        } else if (measurements.hoverProbe) {
          const pinnedId = createId('probe');
          setPinnedProbe({ ...measurements.hoverProbe, id: pinnedId });
        } else {
          setPinnedProbe(null);
        }
      }
      setDragProbe(null);
      measureStart.current = null;
      if (event.type === 'pointerleave') {
        setHoverProbe(null);
      }
      canvasRef.current?.releasePointerCapture(event.pointerId);
      return;
    }
    selectionDrag.current = null;
    panSession.current = null;
    dragTarget.current = null;
    canvasRef.current?.releasePointerCapture(event.pointerId);
  };

  const handleWheel = (event: WheelEvent<HTMLCanvasElement>) => {
    if (!(event.ctrlKey || event.metaKey)) {
      return;
    }
    event.preventDefault();
    const factor = event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
    zoomBy(factor);
  };

  useEffect(() => {
    if (activeTool !== 'line') {
      penDraft.current = null;
      setCursorHint(null);
    }
  }, [activeTool]);

  useEffect(() => {
    if (activeTool !== 'measure') {
      measureStart.current = null;
      setHoverProbe(null);
      setDragProbe(null);
    }
  }, [activeTool, setDragProbe, setHoverProbe]);

  useEffect(() => {
    if (activeTool !== 'select') {
      selectionDrag.current = null;
      dragTarget.current = null;
    }
    if (activeTool !== 'pan') {
      panSession.current = null;
    }
  }, [activeTool]);

  return (
    <div
      className={clsx(
        'relative aspect-square w-full max-h-[80vh] self-start overflow-hidden rounded-3xl border border-border bg-surface shadow-panel',
        canvasWidthClass,
      )}
    >
      <canvas
        ref={canvasRef}
        className="h-full w-full touch-none"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
        onWheel={handleWheel}
      />
      <div className="pointer-events-none absolute bottom-4 left-1/2 flex -translate-x-1/2 flex-col items-center gap-2 rounded-2xl border border-border bg-white/85 px-4 py-3 shadow">
        <span className="text-[11px] font-semibold uppercase tracking-widest text-muted">Oxidation timeline</span>
        <div className="flex items-center gap-3">
          <span className="text-[11px] text-muted">0%</span>
          <input
            type="range"
            min={0}
            max={100}
            step={0.1}
            value={oxidationProgress * 100}
            className="pointer-events-auto accent-accent"
            onChange={(event) => setOxidationProgress(Number(event.target.value) / 100)}
          />
          <span className="text-[11px] text-muted">100%</span>
        </div>
        <span className="text-[11px] font-semibold text-text">{(oxidationProgress * 100).toFixed(1)}%</span>
      </div>
      {(activeTool === 'measure' || cursorHint) && (
        <div className="pointer-events-none absolute left-4 top-4 rounded-xl bg-white/90 px-3 py-2 text-xs font-medium text-muted shadow">
          {activeTool === 'measure' ? 'Click & drag to measure (μm)' : cursorHint}
        </div>
      )}
      <div className="pointer-events-none absolute bottom-4 right-4 flex flex-col items-end gap-2">
        <div className="pointer-events-auto flex items-center gap-2 rounded-2xl border border-border bg-white/85 px-3 py-2 shadow">
          <button
            type="button"
            className="rounded-full border border-border bg-white px-2 py-1 text-xs font-semibold text-muted hover:bg-muted/10"
            onClick={() => zoomBy(1 / ZOOM_STEP)}
            disabled={zoom <= MIN_ZOOM + 1e-3}
          >
            −
          </button>
          <input
            type="range"
            min={MIN_ZOOM}
            max={MAX_ZOOM}
            step={0.05}
            value={zoom}
            onChange={(event) => setZoom(Number(event.target.value))}
            className="h-1 w-32 accent-accent"
          />
          <button
            type="button"
            className="rounded-full border border-border bg-white px-2 py-1 text-xs font-semibold text-muted hover:bg-muted/10"
            onClick={() => zoomBy(ZOOM_STEP)}
            disabled={zoom >= MAX_ZOOM - 1e-3}
          >
            +
          </button>
        </div>
        <span className="pointer-events-none text-[11px] font-semibold text-text">×{zoom.toFixed(2)}</span>
      </div>
    </div>
  );
};
