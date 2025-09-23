import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { createRenderer } from '../canvas/renderer';
import { useWorkspaceStore } from '../state';
import { createId } from '../utils/ids';
import { distance, toDegrees } from '../utils/math';
import type { PathEntity, Vec2 } from '../types';
import { DirectionalCompass } from './DirectionalCompass';

type DragTarget =
  | { kind: 'anchor'; pathId: string; nodeId: string }
  | { kind: 'handleIn' | 'handleOut'; pathId: string; nodeId: string };

const nodeHitThreshold = 12;
const pathHitThreshold = 10;

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
  const setProbe = useWorkspaceStore((state) => state.setProbe);
  const addProbe = useWorkspaceStore((state) => state.addProbe);
  const measurements = useWorkspaceStore((state) => state.measurements);
  const setSelected = useWorkspaceStore((state) => state.setSelected);
  const updatePath = useWorkspaceStore((state) => state.updatePath);
  const addPath = useWorkspaceStore((state) => state.addPath);
  const setPathMeta = useWorkspaceStore((state) => state.setPathMeta);
  const toggleSegmentCurve = useWorkspaceStore((state) => state.toggleSegmentCurve);
  const measureStart = useRef<Vec2 | null>(null);
  const dragTarget = useRef<DragTarget | null>(null);
  const penDraft = useRef<{ pathId: string } | null>(null);
  const [cursorHint, setCursorHint] = useState<string | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const renderer = createRenderer(canvas, () => useWorkspaceStore.getState());
    renderer.start();
    return () => renderer.stop();
  }, []);

  const getPointerPos = (event: PointerEvent<HTMLCanvasElement>): Vec2 => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
  };

  const hitTestNodes = (position: Vec2): DragTarget | null => {
    const state = useWorkspaceStore.getState();
    const ordered = orderPathsBySelection(state.paths, state.selectedPathIds);
    for (const path of ordered) {
      for (const node of path.nodes) {
        if (distance(position, node.point) <= nodeHitThreshold) {
          return { kind: 'anchor', pathId: path.meta.id, nodeId: node.id };
        }
        if (node.handleIn && distance(position, node.handleIn) <= nodeHitThreshold) {
          return { kind: 'handleIn', pathId: path.meta.id, nodeId: node.id };
        }
        if (node.handleOut && distance(position, node.handleOut) <= nodeHitThreshold) {
          return { kind: 'handleOut', pathId: path.meta.id, nodeId: node.id };
        }
      }
    }
    return null;
  };

  const hitTestPath = (position: Vec2): string | null => {
    const state = useWorkspaceStore.getState();
    for (const path of state.paths) {
      const samples = path.sampled?.samples ?? [];
      if (samples.length) {
        for (let i = 1; i < samples.length; i += 1) {
          if (pointSegmentDistance(position, samples[i - 1].position, samples[i].position) <= pathHitThreshold) {
            return path.meta.id;
          }
        }
      } else if (path.nodes.length > 1) {
        for (let i = 1; i < path.nodes.length; i += 1) {
          if (pointSegmentDistance(position, path.nodes[i - 1].point, path.nodes[i].point) <= pathHitThreshold) {
            return path.meta.id;
          }
        }
      }
    }
    return null;
  };

  const hitTestSegment = (
    position: Vec2,
  ): { pathId: string; segmentIndex: number } | null => {
    const state = useWorkspaceStore.getState();
    for (const path of state.paths) {
      const { nodes } = path;
      const totalSegments = path.meta.closed ? nodes.length : nodes.length - 1;
      if (totalSegments < 1) continue;
      for (let i = 0; i < totalSegments; i += 1) {
        const a = nodes[i].point;
        const b = nodes[(i + 1) % nodes.length].point;
        if (pointSegmentDistance(position, a, b) <= pathHitThreshold) {
          return { pathId: path.meta.id, segmentIndex: i };
        }
      }
    }
    return null;
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

  const handlePenInput = (position: Vec2, clicks: number) => {
    const state = useWorkspaceStore.getState();
    if (!penDraft.current) {
      const pathId = addPath(
        [
          {
            id: createId('node'),
            point: position,
            handleIn: null,
            handleOut: null,
          },
        ],
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
      penDraft.current = { pathId };
      setSelected([pathId]);
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
    if (path.nodes.length >= 3 && distance(position, firstNode.point) < nodeHitThreshold + 4) {
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
    updatePath(path.meta.id, (nodes) => [
      ...nodes,
      {
        id: createId('node'),
        point: position,
        handleIn: null,
        handleOut: null,
      },
    ]);
  };

  const handlePointerDown = (event: PointerEvent<HTMLCanvasElement>) => {
    const position = getPointerPos(event);
    if (activeTool === 'measure') {
      const probe = {
        id: createId('probe'),
        a: position,
        b: position,
        distance: 0,
        angleDeg: 0,
      };
      measureStart.current = position;
      setProbe(probe);
      canvasRef.current?.setPointerCapture(event.pointerId);
      return;
    }
    if (activeTool === 'pen') {
      handlePenInput(position, event.detail);
      canvasRef.current?.setPointerCapture(event.pointerId);
      return;
    }
    if (activeTool === 'select' || activeTool === 'edit') {
      const target = hitTestNodes(position);
      if (target) {
        dragTarget.current = target;
        setSelected([target.pathId]);
        updateGeometryForDrag(target, position);
        canvasRef.current?.setPointerCapture(event.pointerId);
        return;
      }
      if (activeTool === 'edit') {
        const segment = hitTestSegment(position);
        if (segment && event.detail >= 2) {
          toggleSegmentCurve(segment.pathId, segment.segmentIndex);
          setSelected([segment.pathId]);
          return;
        }
        if (segment) {
          setSelected([segment.pathId]);
          return;
        }
      }
      const pathId = hitTestPath(position);
      if (pathId) {
        setSelected([pathId]);
      } else if (!event.shiftKey) {
        setSelected([]);
      }
      return;
    }
  };

  const handlePointerMove = (event: PointerEvent<HTMLCanvasElement>) => {
    const position = getPointerPos(event);
    if (activeTool === 'measure' && measureStart.current && measurements.activeProbe) {
      const dist = distance(measureStart.current, position);
      const angle = toDegrees(Math.atan2(position.y - measureStart.current.y, position.x - measureStart.current.x));
      setProbe({
        ...measurements.activeProbe,
        b: position,
        distance: dist,
        angleDeg: angle,
      });
      return;
    }
    if ((activeTool === 'select' || activeTool === 'edit') && dragTarget.current) {
      updateGeometryForDrag(dragTarget.current, position);
    }
  };

  const handlePointerUp = (event: PointerEvent<HTMLCanvasElement>) => {
    if (activeTool === 'measure' && measurements.activeProbe) {
      addProbe(measurements.activeProbe);
      measureStart.current = null;
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
