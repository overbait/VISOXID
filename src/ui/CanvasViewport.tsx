import { useEffect, useRef, useState, type PointerEvent } from 'react';
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
import { DirectionalCompass } from './DirectionalCompass';

type DragTarget =
  | { kind: 'anchor'; pathId: string; nodeId: string }
  | { kind: 'handleIn' | 'handleOut'; pathId: string; nodeId: string };

const nodeHitThresholdPx = 12;
const pathHitThresholdPx = 10;

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
  const updatePath = useWorkspaceStore((state) => state.updatePath);
  const addPath = useWorkspaceStore((state) => state.addPath);
  const setPathMeta = useWorkspaceStore((state) => state.setPathMeta);
  const toggleSegmentCurve = useWorkspaceStore((state) => state.toggleSegmentCurve);
  const measureStart = useRef<{ origin: Vec2; moved: boolean } | null>(null);
  const dragTarget = useRef<DragTarget | null>(null);
  const penDraft = useRef<{ pathId: string; activeEnd: 'start' | 'end' } | null>(null);
  const [cursorHint, setCursorHint] = useState<string | null>(null);

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
      const view = computeViewTransform(1, 1);
      return { world: { x: 0, y: 0 }, canvas: { x: 0, y: 0 }, view };
    }
    const rect = canvas.getBoundingClientRect();
    const canvasPoint = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
    const view = computeViewTransform(rect.width, rect.height);
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
      const inner = {
        x: sample.position.x - sample.normal.x * sample.thickness,
        y: sample.position.y - sample.normal.y * sample.thickness,
      };
      setHoverProbe({
        id: 'hover',
        a: sample.position,
        b: inner,
        distance: sample.thickness,
        angleDeg: toDegrees(Math.atan2(inner.y - sample.position.y, inner.x - sample.position.x)),
        thicknessA: sample.thickness,
        thicknessB: sample.thickness,
      });
    } else {
      setHoverProbe(null);
    }
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

  const handlePenInput = (position: Vec2, view: ViewTransform, clicks: number) => {
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
    const { world: position, view } = getPointerContext(event);
    if (activeTool === 'measure') {
      const dragId = createId('probe');
      measureStart.current = { origin: position, moved: false };
      setDragProbe({
        id: dragId,
        a: position,
        b: position,
        distance: 0,
        angleDeg: 0,
      });
      canvasRef.current?.setPointerCapture(event.pointerId);
      return;
    }
    if (activeTool === 'pen') {
      handlePenInput(position, view, event.detail);
      canvasRef.current?.setPointerCapture(event.pointerId);
      return;
    }
    if (activeTool === 'select' || activeTool === 'edit') {
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
      if (activeTool === 'edit' && segment) {
        setSelected([segment.pathId]);
        return;
      }
      const pathId = hitTestPath(position, view);
      if (pathId) {
        setSelected([pathId]);
        setNodeSelection(null);
      } else if (!event.shiftKey) {
        setSelected([]);
        setNodeSelection(null);
      }
      return;
    }
  };

  const handlePointerMove = (event: PointerEvent<HTMLCanvasElement>) => {
    const { world: position, view } = getPointerContext(event);
    if (activeTool === 'measure') {
      if (measureStart.current && measurements.dragProbe) {
        const dist = distance(measureStart.current.origin, position);
        const angle = toDegrees(
          Math.atan2(position.y - measureStart.current.origin.y, position.x - measureStart.current.origin.x),
        );
        const threshold = canvasDistanceToWorld(4, view);
        if (!measureStart.current.moved && dist > threshold) {
          measureStart.current.moved = true;
        }
        setDragProbe({
          ...measurements.dragProbe,
          b: position,
          distance: dist,
          angleDeg: angle,
        });
      } else {
        updateHoverMeasurement(position, view);
      }
      return;
    }
    if ((activeTool === 'select' || activeTool === 'edit') && dragTarget.current) {
      updateGeometryForDrag(dragTarget.current, position);
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
    dragTarget.current = null;
    canvasRef.current?.releasePointerCapture(event.pointerId);
  };

  useEffect(() => {
    if (activeTool !== 'pen') {
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

  return (
    <div className="relative h-full min-h-[420px] w-full overflow-hidden rounded-3xl border border-border bg-surface shadow-panel">
      <canvas
        ref={canvasRef}
        className="h-full w-full touch-none"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
      />
      <DirectionalCompass />
      {(activeTool === 'measure' || cursorHint) && (
        <div className="pointer-events-none absolute left-4 top-4 rounded-xl bg-white/90 px-3 py-2 text-xs font-medium text-muted shadow">
          {activeTool === 'measure' ? 'Click & drag to measure (μm)' : cursorHint}
        </div>
      )}
    </div>
  );
};
