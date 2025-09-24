import { create } from 'zustand';
import type {
  DirectionWeight,
  MeasurementProbe,
  NodeSelection,
  OxidationSettings,
  PathEntity,
  PathMeta,
  PathNode,
  SamplePoint,
  Vec2,
  StoredShape,
  ToolId,
  WorkspaceSnapshot,
  WorkspaceState,
} from '../types';
import { createId } from '../utils/ids';
import {
  adaptiveSamplePath,
  accumulateLength,
  cleanAndSimplifyPolygons,
  evalThickness,
  polygonArea,
  recomputeNormals,
  resampleClosedPolygon,
} from '../geometry';
import { add, alignLoop, clamp, distance, dot, sub } from '../utils/math';

const LIBRARY_STORAGE_KEY = 'visoxid:shape-library';

const MAX_THICKNESS_UM = 10;
const ENDPOINT_MERGE_THRESHOLD = 4;
const MIRROR_SNAP_THRESHOLD = 1.5;

const clampThickness = (value: number): number => clamp(value, 0, MAX_THICKNESS_UM);

const clampAngleDeg = (angleDeg: number): number => {
  let wrapped = angleDeg % 360;
  if (wrapped < 0) {
    wrapped += 360;
  }
  return wrapped;
};

const normalizeLabel = (label: string | undefined): string => {
  const trimmed = label?.trim();
  if (!trimmed) return '?';
  return trimmed.slice(0, 2).toUpperCase();
};

const sanitizeDirectionalWeights = (items: DirectionWeight[]): DirectionWeight[] => {
  const seen = new Set<string>();
  const sanitized = items.map((item) => {
    const candidateId = item.id ?? createId('dir');
    const id = seen.has(candidateId) ? createId('dir') : candidateId;
    seen.add(id);
    return {
      id,
      label: normalizeLabel(item.label),
      angleDeg: clampAngleDeg(item.angleDeg),
      valueUm: clampThickness(item.valueUm),
    };
  });
  return sanitized.sort((a, b) => a.angleDeg - b.angleDeg);
};

const createDirectionalWeight = (label: string, angleDeg: number, valueUm = 0): DirectionWeight => ({
  id: createId('dir'),
  label: normalizeLabel(label),
  angleDeg: clampAngleDeg(angleDeg),
  valueUm: clampThickness(valueUm),
});

const loadLibrary = (): StoredShape[] => {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(LIBRARY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as StoredShape[];
    return parsed.map((shape) => ({
      ...shape,
      nodes: shape.nodes.map((node) => ({ ...node })),
      oxidation: cloneOxidationSettings(shape.oxidation),
    }));
  } catch (error) {
    console.warn('Failed to load stored shape library', error);
    return [];
  }
};

const persistLibrary = (library: StoredShape[]): void => {
  if (typeof window === 'undefined') return;
  try {
    const serialisable = library.map((shape) => ({
      ...shape,
      nodes: shape.nodes.map((node) => ({ ...node })),
      oxidation: cloneOxidationSettings(shape.oxidation),
    }));
    window.localStorage.setItem(LIBRARY_STORAGE_KEY, JSON.stringify(serialisable));
  } catch (error) {
    console.warn('Failed to persist shape library', error);
  }
};

const createDefaultDirectionWeights = (): DirectionWeight[] =>
  sanitizeDirectionalWeights([
    createDirectionalWeight('N', 270),
    createDirectionalWeight('NE', 315),
    createDirectionalWeight('E', 0),
    createDirectionalWeight('SE', 45),
    createDirectionalWeight('S', 90),
    createDirectionalWeight('SW', 135),
    createDirectionalWeight('W', 180),
    createDirectionalWeight('NW', 225),
  ]);

const createDefaultOxidation = (): OxidationSettings => ({
  thicknessUniformUm: 5,
  thicknessByDirection: {
    items: createDefaultDirectionWeights(),
  },
  evaluationSpacing: 12,
  mirrorSymmetry: false,
});

const cloneOxidationSettings = (settings: OxidationSettings): OxidationSettings => ({
  ...settings,
  thicknessByDirection: {
    items: sanitizeDirectionalWeights(settings.thicknessByDirection.items),
  },
});

const mergeOxidationSettings = (
  base: OxidationSettings,
  patch: Partial<OxidationSettings>,
): OxidationSettings => {
  const merged = cloneOxidationSettings(base);
  if (patch.thicknessUniformUm !== undefined) {
    merged.thicknessUniformUm = clampThickness(patch.thicknessUniformUm);
  }
  if (patch.evaluationSpacing !== undefined) {
    merged.evaluationSpacing = patch.evaluationSpacing;
  }
  if (patch.mirrorSymmetry !== undefined) {
    merged.mirrorSymmetry = patch.mirrorSymmetry;
  }
  if (patch.thicknessByDirection) {
    const { items } = patch.thicknessByDirection;
    merged.thicknessByDirection = {
      items: items
        ? sanitizeDirectionalWeights(items)
        : merged.thicknessByDirection.items.map((item) => ({ ...item })),
    };
  } else {
    merged.thicknessByDirection.items = sanitizeDirectionalWeights(
      merged.thicknessByDirection.items,
    );
  }
  merged.thicknessUniformUm = clampThickness(merged.thicknessUniformUm);
  return merged;
};

const shiftNode = (node: PathNode, x: number, y: number): PathNode => {
  const dx = x - node.point.x;
  const dy = y - node.point.y;
  return {
    ...node,
    point: { x, y },
    handleIn: node.handleIn
      ? { x: node.handleIn.x + dx, y: node.handleIn.y + dy }
      : node.handleIn ?? null,
    handleOut: node.handleOut
      ? { x: node.handleOut.x + dx, y: node.handleOut.y + dy }
      : node.handleOut ?? null,
  };
};

const mergeEndpointsIfClose = (
  nodes: PathNode[],
  alreadyClosed: boolean,
): { nodes: PathNode[]; closed: boolean } => {
  if (nodes.length < 2 || alreadyClosed) {
    return { nodes, closed: alreadyClosed };
  }
  const first = nodes[0];
  const lastIndex = nodes.length - 1;
  const last = nodes[lastIndex];
  if (distance(first.point, last.point) > ENDPOINT_MERGE_THRESHOLD) {
    return { nodes, closed: false };
  }
  const mergedX = (first.point.x + last.point.x) / 2;
  const mergedY = (first.point.y + last.point.y) / 2;
  const mergedNodes = [...nodes];
  mergedNodes[0] = shiftNode(first, mergedX, mergedY);
  mergedNodes[lastIndex] = shiftNode(last, mergedX, mergedY);
  return { nodes: mergedNodes, closed: true };
};

const applyMirrorSnapping = (nodes: PathNode[], mirror: WorkspaceState['mirror']): PathNode[] => {
  if (!mirror.enabled) return nodes;
  return nodes.map((node) => {
    let next = node;
    if ((mirror.axis === 'y' || mirror.axis === 'xy') && Math.abs(node.point.x - mirror.origin.x) <= MIRROR_SNAP_THRESHOLD) {
      next = shiftNode(next, mirror.origin.x, next.point.y);
    }
    if ((mirror.axis === 'x' || mirror.axis === 'xy') && Math.abs(node.point.y - mirror.origin.y) <= MIRROR_SNAP_THRESHOLD) {
      next = shiftNode(next, next.point.x, mirror.origin.y);
    }
    return next;
  });
};

const deriveInnerGeometry = (
  samples: SamplePoint[],
  closed: boolean,
): { innerSamples: Vec2[]; polygons: Vec2[][] } => {
  const fallbackInner = samples.map((sample) => ({
    x: sample.position.x - sample.normal.x * sample.thickness,
    y: sample.position.y - sample.normal.y * sample.thickness,
  }));

  if (!closed || samples.length < 3) {
    return { innerSamples: fallbackInner, polygons: [] };
  }

  const TAU = Math.PI * 2;
  const EPS = 1e-6;

  type Arc = { start: number; end: number };

  interface Circle {
    center: Vec2;
    radius: number;
    normal: Vec2;
  }

  const wrapAngle = (angle: number): number => {
    let wrapped = angle % TAU;
    if (wrapped < 0) {
      wrapped += TAU;
    }
    return wrapped;
  };

  const arcLength = (arc: Arc): number => arc.end - arc.start;

  const pushArc = (arcs: Arc[], start: number, end: number): void => {
    if (end - start <= EPS) return;
    arcs.push({ start, end });
  };

  const normaliseInterval = (start: number, end: number): Arc[] => {
    const span = end - start;
    if (span >= TAU - EPS) {
      return [{ start: 0, end: TAU }];
    }
    const s = wrapAngle(start);
    const e = wrapAngle(end);
    if (s <= e) {
      return [{ start: s, end: e }];
    }
    return [
      { start: 0, end: e },
      { start: s, end: TAU },
    ];
  };

  const subtractInterval = (arcs: Arc[], interval: Arc): Arc[] => {
    const result: Arc[] = [];
    for (const arc of arcs) {
      if (interval.end <= arc.start + EPS || interval.start >= arc.end - EPS) {
        result.push(arc);
        continue;
      }
      if (interval.start > arc.start + EPS) {
        pushArc(result, arc.start, Math.min(interval.start, arc.end));
      }
      if (interval.end < arc.end - EPS) {
        pushArc(result, Math.max(interval.end, arc.start), arc.end);
      }
    }
    return result;
  };

  const subtractIntervals = (arcs: Arc[], intervals: Arc[]): Arc[] => {
    let current = arcs;
    for (const interval of intervals) {
      current = subtractInterval(current, interval);
      if (!current.length) break;
    }
    return current;
  };

  const computeOcclusionIntervals = (a: Circle, b: Circle): Arc[] => {
    if (b.radius <= EPS) return [];
    const centerDist = distance(a.center, b.center);
    if (centerDist <= EPS) {
      if (b.radius >= a.radius - EPS) {
        return [{ start: 0, end: TAU }];
      }
      return [];
    }
    if (centerDist >= a.radius + b.radius - EPS) {
      return [];
    }
    if (centerDist <= Math.abs(a.radius - b.radius) - EPS) {
      if (b.radius >= a.radius) {
        return [{ start: 0, end: TAU }];
      }
      return [];
    }

    const angleToB = Math.atan2(b.center.y - a.center.y, b.center.x - a.center.x);
    const cosPhi = Math.min(
      1,
      Math.max(-1, (a.radius * a.radius + centerDist * centerDist - b.radius * b.radius) / (2 * a.radius * centerDist)),
    );
    const phi = Math.acos(cosPhi);
    return normaliseInterval(angleToB - phi, angleToB + phi);
  };

  const angleInArc = (angle: number, arc: Arc): boolean => angle >= arc.start - EPS && angle <= arc.end + EPS;

  const clampAngleToArc = (angle: number, arc: Arc): number => {
    const length = arcLength(arc);
    if (length <= EPS * 4) {
      return wrapAngle(arc.start + length / 2);
    }
    if (angle <= arc.start) {
      return arc.start + EPS;
    }
    if (angle >= arc.end) {
      return arc.end - EPS;
    }
    return angle;
  };

  const angularDistance = (a: number, b: number): number => {
    let delta = Math.abs(a - b);
    if (delta > Math.PI) {
      delta = TAU - delta;
    }
    return delta;
  };

  const toPointOnCircle = (circle: Circle, angle: number): Vec2 => ({
    x: circle.center.x + circle.radius * Math.cos(angle),
    y: circle.center.y + circle.radius * Math.sin(angle),
  });

  const circles: Circle[] = samples.map((sample) => ({
    center: sample.position,
    radius: Math.max(sample.thickness, 0),
    normal: sample.normal,
  }));

  const candidateInner: Vec2[] = samples.map((sample, index) => {
    const circle = circles[index];
    if (circle.radius <= EPS) {
      return fallbackInner[index];
    }

    let arcs: Arc[] = [{ start: 0, end: TAU }];
    for (let j = 0; j < circles.length; j += 1) {
      if (j === index) continue;
      const other = circles[j];
      if (other.radius <= EPS) continue;
      const occluded = computeOcclusionIntervals(circle, other);
      arcs = subtractIntervals(arcs, occluded);
      if (!arcs.length) break;
    }

    arcs = arcs
      .filter((arc) => arc.end - arc.start > EPS)
      .map((arc) => ({
        start: Math.max(0, Math.min(arc.start, TAU)),
        end: Math.max(0, Math.min(arc.end, TAU)),
      }))
      .filter((arc) => arc.end - arc.start > EPS)
      .sort((a, b) => a.start - b.start);

    const inwardAngle = wrapAngle(Math.atan2(-sample.normal.y, -sample.normal.x));
    const inwardArc = arcs.find((arc) => angleInArc(inwardAngle, arc));
    let chosenAngle: number | null = null;

    const inwardCandidate = inwardArc ? clampAngleToArc(inwardAngle, inwardArc) : null;

    const arcCandidates = arcs.filter((arc) => {
      const mid = wrapAngle(arc.start + (arc.end - arc.start) / 2);
      const midPoint = toPointOnCircle(circle, mid);
      const direction = sub(midPoint, sample.position);
      return dot(direction, sample.normal) < -EPS;
    });

    const availableArcs = arcCandidates.length ? arcCandidates : arcs;

    if (inwardCandidate !== null) {
      const preview = toPointOnCircle(circle, inwardCandidate);
      const direction = sub(preview, sample.position);
      if (dot(direction, sample.normal) < -EPS) {
        chosenAngle = inwardCandidate;
      }
    }

    if (chosenAngle === null && availableArcs.length) {
      let bestArc = availableArcs[0];
      let bestScore = Infinity;
      for (const arc of availableArcs) {
        const mid = wrapAngle(arc.start + (arc.end - arc.start) / 2);
        const score = angularDistance(mid, inwardAngle);
        if (score < bestScore) {
          bestScore = score;
          bestArc = arc;
        }
      }
      chosenAngle = clampAngleToArc(inwardAngle, bestArc);
    }

    if (chosenAngle === null) {
      return fallbackInner[index];
    }

    const candidate = toPointOnCircle(circle, chosenAngle);
    const direction = sub(candidate, sample.position);
    if (dot(direction, sample.normal) >= -EPS) {
      return fallbackInner[index];
    }

    return candidate;
  });

  const laplacianSmooth = (points: Vec2[], iterations = 3, lambda = 0.25): Vec2[] => {
    if (points.length < 3) return points;
    let current = points.map((p) => ({ ...p }));
    for (let iter = 0; iter < iterations; iter += 1) {
      const next = current.map((point, i) => {
        const prev = current[(i - 1 + current.length) % current.length];
        const nextPoint = current[(i + 1) % current.length];
        const laplace = add(prev, nextPoint);
        return {
          x: point.x + lambda * (laplace.x / 2 - point.x),
          y: point.y + lambda * (laplace.y / 2 - point.y),
        };
      });
      current = next;
    }
    return current;
  };

  const smoothed = laplacianSmooth(candidateInner);

  let polygons: Vec2[][] = [];
  if (smoothed.length >= 3) {
    polygons = cleanAndSimplifyPolygons(smoothed);
  }
  if (!polygons.length && smoothed.length >= 3) {
    polygons = [smoothed];
  }

  let innerSamples = smoothed;

  if (polygons.length) {
    const primary = polygons.reduce((largest, poly) =>
      Math.abs(polygonArea(poly)) > Math.abs(polygonArea(largest)) ? poly : largest,
    polygons[0]);
    if (primary.length >= 3) {
      const resampled = resampleClosedPolygon(primary, samples.length);
      if (resampled.length === samples.length) {
        innerSamples = alignLoop(resampled, fallbackInner);
      }
    }
  }

  return { innerSamples, polygons };
};


const pruneNodeSelection = (
  selection: NodeSelection | null,
  pathId: string,
  nodes: PathNode[],
): NodeSelection | null => {
  if (!selection || selection.pathId !== pathId) {
    return selection;
  }
  const available = new Set(nodes.map((node) => node.id));
  const retained = selection.nodeIds.filter((id) => available.has(id));
  return retained.length ? { pathId, nodeIds: retained } : null;
};

const createEmptyState = (library: StoredShape[] = []): WorkspaceState => ({
  paths: [],
  selectedPathIds: [],
  nodeSelection: null,
  activeTool: 'pen',
  grid: {
    visible: true,
    snapToGrid: false,
    spacing: 5,
    subdivisions: 5,
  },
  mirror: {
    enabled: false,
    axis: 'y',
    origin: { x: 25, y: 25 },
    livePreview: true,
  },
  oxidationDefaults: createDefaultOxidation(),
  measurements: {
    hoverProbe: null,
    pinnedProbe: null,
    dragProbe: null,
    snapping: true,
    showHeatmap: true,
  },
  warnings: [],
  history: [],
  future: [],
  dirty: false,
  oxidationVisible: true,
  oxidationProgress: 1,
  directionalLinking: true,
  bootstrapped: false,
  library,
});

const clonePath = (path: PathEntity): PathEntity => ({
  ...path,
  nodes: path.nodes.map((node) => ({ ...node })),
  sampled: path.sampled
    ? {
        ...path.sampled,
        samples: path.sampled.samples.map((sample) => ({ ...sample })),
      }
    : undefined,
  oxidation: cloneOxidationSettings(path.oxidation),
  meta: { ...path.meta },
});

const cloneStoredShape = (shape: StoredShape): StoredShape => ({
  ...shape,
  nodes: shape.nodes.map((node) => ({ ...node })),
  oxidation: cloneOxidationSettings(shape.oxidation),
});

const captureSnapshot = (state: WorkspaceState): WorkspaceSnapshot => ({
  timestamp: Date.now(),
  paths: state.paths.map(clonePath),
  selectedPathIds: [...state.selectedPathIds],
  activeTool: state.activeTool,
  nodeSelection: state.nodeSelection
    ? { pathId: state.nodeSelection.pathId, nodeIds: [...state.nodeSelection.nodeIds] }
    : null,
  oxidationProgress: state.oxidationProgress,
});

type PathUpdater = (nodes: PathNode[]) => PathNode[];

type WorkspaceActions = {
  setActiveTool: (tool: ToolId) => void;
  addPath: (nodes: PathNode[], overrides?: Partial<PathEntity>) => string;
  updatePath: (id: string, updater: PathUpdater) => void;
  removePath: (id: string) => void;
  setSelected: (ids: string[]) => void;
  setNodeSelection: (selection: NodeSelection | null) => void;
  deleteSelectedNodes: () => void;
  setNodeCurveMode: (pathId: string, nodeId: string, mode: 'line' | 'bezier') => void;
  updateGrid: (settings: Partial<WorkspaceState['grid']>) => void;
  updateMirror: (settings: Partial<WorkspaceState['mirror']>) => void;
  updateOxidationDefaults: (settings: Partial<OxidationSettings>) => void;
  updateSelectedOxidation: (settings: Partial<OxidationSettings>) => void;
  setDirectionalLinking: (value: boolean) => void;
  setOxidationProgress: (value: number) => void;
  setPathMeta: (id: string, patch: Partial<PathMeta>) => void;
  setHoverProbe: (probe: MeasurementProbe | null) => void;
  setPinnedProbe: (probe: MeasurementProbe | null) => void;
  setDragProbe: (probe: MeasurementProbe | null) => void;
  setMeasurementSnapping: (value: boolean) => void;
  setHeatmapVisible: (value: boolean) => void;
  pushWarning: (message: string, level?: 'info' | 'warning' | 'error') => void;
  dismissWarning: (id: string) => void;
  toggleOxidationVisible: (value: boolean) => void;
  markBootstrapped: () => void;
  saveShapeToLibrary: (pathId: string, name: string) => void;
  removeShapeFromLibrary: (shapeId: string) => void;
  renameShapeInLibrary: (shapeId: string, name: string) => void;
  loadShapeFromLibrary: (shapeId: string) => void;
  resetScene: () => void;
  undo: () => void;
  redo: () => void;
  importState: (state: WorkspaceState) => void;
  reset: () => void;
  toggleSegmentCurve: (pathId: string, segmentIndex: number) => void;
};

export type WorkspaceStore = WorkspaceState & WorkspaceActions;

const runGeometryPipeline = (path: PathEntity, progress: number): PathEntity => {
  const sampled = adaptiveSamplePath(path, {
    spacing: path.oxidation.evaluationSpacing,
  });
  const normals = recomputeNormals(sampled.samples);
  const withThickness = evalThickness(normals, {
    uniformThickness: path.oxidation.thicknessUniformUm,
    weights: path.oxidation.thicknessByDirection.items,
    mirrorSymmetry: path.oxidation.mirrorSymmetry,
    progress,
  });

  const { innerSamples, polygons } = deriveInnerGeometry(withThickness, path.meta.closed);
  const length = accumulateLength(withThickness);
  return {
    ...path,
    sampled: {
      id: path.meta.id,
      samples: withThickness,
      length,
      innerSamples,
      innerPolygons: polygons,
    },
  };
};

const initialLibrary = loadLibrary();

export const useWorkspaceStore = create<WorkspaceStore>((set, get) => ({
  ...createEmptyState(initialLibrary),
  setActiveTool: (tool) => set({ activeTool: tool }),
  addPath: (nodes, overrides) => {
    const mirror = get().mirror;
    const id = overrides?.meta?.id ?? createId('path');
    set((state) => {
      const history = [...state.history, captureSnapshot(state)].slice(-50);
      const meta = overrides?.meta ?? {
        id,
        name: `Path ${state.paths.length + 1}`,
        closed: overrides?.meta?.closed ?? false,
        visible: true,
        locked: false,
        color: overrides?.meta?.color ?? '#2563eb',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      const clonedNodes = nodes.map((node) => ({ ...node }));
      const { nodes: mergedNodes, closed } = mergeEndpointsIfClose(
        clonedNodes,
        meta.closed,
      );
      const snapped = applyMirrorSnapping(mergedNodes, mirror);
      const finalMeta = { ...meta, closed: meta.closed || closed };
      const newPath: PathEntity = runGeometryPipeline(
        {
          meta: finalMeta,
          nodes: snapped,
          oxidation: overrides?.oxidation
            ? cloneOxidationSettings(overrides.oxidation)
            : cloneOxidationSettings(state.oxidationDefaults),
          sampled: undefined,
        },
        state.oxidationProgress,
      );
      return {
        ...state,
        paths: [...state.paths, newPath],
        selectedPathIds: [newPath.meta.id],
        nodeSelection: null,
        history,
        future: [],
        dirty: true,
        bootstrapped: true,
      };
    });
    return id;
  },
  updatePath: (id, updater) => {
    const mirror = get().mirror;
    set((state) => {
      const index = state.paths.findIndex((path) => path.meta.id === id);
      if (index === -1) return state;
      const history = [...state.history, captureSnapshot(state)].slice(-50);
      const target = state.paths[index];
      const nodes = updater(target.nodes.map((node) => ({ ...node })));
      const { nodes: mergedNodes, closed } = mergeEndpointsIfClose(nodes, target.meta.closed);
      const snapped = applyMirrorSnapping(mergedNodes, mirror);
      const updated = runGeometryPipeline(
        {
          ...target,
          nodes: snapped,
          meta: {
            ...target.meta,
            closed: target.meta.closed || closed,
            updatedAt: Date.now(),
          },
        },
        state.oxidationProgress,
      );
      const nextPaths = [...state.paths];
      nextPaths[index] = updated;
      return {
        ...state,
        paths: nextPaths,
        history,
        future: [],
        dirty: true,
        nodeSelection: pruneNodeSelection(state.nodeSelection, updated.meta.id, updated.nodes),
      };
    });
  },
  removePath: (id) => {
    set((state) => {
      if (!state.paths.some((path) => path.meta.id === id)) return state;
      const history = [...state.history, captureSnapshot(state)].slice(-50);
      return {
        ...state,
        paths: state.paths.filter((path) => path.meta.id !== id),
        selectedPathIds: state.selectedPathIds.filter((pid) => pid !== id),
        nodeSelection:
          state.nodeSelection && state.nodeSelection.pathId === id
            ? null
            : state.nodeSelection,
        history,
        future: [],
        dirty: true,
      };
    });
  },
  setSelected: (ids) =>
    set((state) => ({
      selectedPathIds: ids,
      nodeSelection:
        state.nodeSelection && ids.includes(state.nodeSelection.pathId)
          ? state.nodeSelection
          : null,
    })),
  setNodeSelection: (selection) =>
    set(() => ({
      nodeSelection: selection
        ? { pathId: selection.pathId, nodeIds: [...selection.nodeIds] }
        : null,
    })),
  deleteSelectedNodes: () =>
    set((state) => {
      const selection = state.nodeSelection;
      if (!selection) return state;
      const pathIndex = state.paths.findIndex((path) => path.meta.id === selection.pathId);
      if (pathIndex === -1) return state;
      const path = state.paths[pathIndex];
      const remainingNodes = path.nodes.filter((node) => !selection.nodeIds.includes(node.id));
      if (remainingNodes.length === path.nodes.length) {
        return state;
      }
      const history = [...state.history, captureSnapshot(state)].slice(-50);
      const { nodes: mergedNodes, closed } = mergeEndpointsIfClose(remainingNodes, path.meta.closed);
      const snapped = applyMirrorSnapping(mergedNodes, state.mirror);
      const finalClosed = snapped.length >= 3 && closed;
      const updated = runGeometryPipeline(
        {
          ...path,
          nodes: snapped,
          meta: { ...path.meta, closed: finalClosed, updatedAt: Date.now() },
        },
        state.oxidationProgress,
      );
      const nextPaths = [...state.paths];
      nextPaths[pathIndex] = updated;
      return {
        ...state,
        paths: nextPaths,
        nodeSelection: null,
        history,
        future: [],
        dirty: true,
      };
    }),
  setNodeCurveMode: (pathId, nodeId, mode) => {
    const mirror = get().mirror;
    set((state) => {
      const pathIndex = state.paths.findIndex((path) => path.meta.id === pathId);
      if (pathIndex === -1) return state;
      const path = state.paths[pathIndex];
      const nodeIndex = path.nodes.findIndex((node) => node.id === nodeId);
      if (nodeIndex === -1) return state;
      const history = [...state.history, captureSnapshot(state)].slice(-50);
      const nodes = path.nodes.map((node) => ({ ...node }));
      const applyHandles = (fromIndex: number, toIndex: number) => {
        const from = nodes[fromIndex];
        const to = nodes[toIndex];
        const vx = to.point.x - from.point.x;
        const vy = to.point.y - from.point.y;
        const length = Math.hypot(vx, vy) || 1;
        const scale = length / 3;
        const nx = vx / length;
        const ny = vy / length;
        nodes[fromIndex] = {
          ...from,
          handleOut: {
            x: from.point.x + nx * scale,
            y: from.point.y + ny * scale,
          },
        };
        nodes[toIndex] = {
          ...to,
          handleIn: {
            x: to.point.x - nx * scale,
            y: to.point.y - ny * scale,
          },
        };
      };
      const clearHandles = (fromIndex: number, toIndex: number) => {
        nodes[fromIndex] = { ...nodes[fromIndex], handleOut: null };
        nodes[toIndex] = { ...nodes[toIndex], handleIn: null };
      };
      const prevIndex = nodeIndex === 0 ? nodes.length - 1 : nodeIndex - 1;
      const nextIndex = (nodeIndex + 1) % nodes.length;
      const isClosed = path.meta.closed;
      if (mode === 'line') {
        if (isClosed || nodeIndex > 0) {
          clearHandles(prevIndex, nodeIndex);
        }
        if (isClosed || nodeIndex < nodes.length - 1) {
          clearHandles(nodeIndex, nextIndex);
        }
      } else {
        if ((isClosed || nodeIndex > 0) && nodes.length > 1) {
          applyHandles(prevIndex, nodeIndex);
        }
        if ((isClosed || nodeIndex < nodes.length - 1) && nodes.length > 1) {
          applyHandles(nodeIndex, nextIndex);
        }
      }
      const { nodes: mergedNodes, closed } = mergeEndpointsIfClose(nodes, path.meta.closed);
      const snapped = applyMirrorSnapping(mergedNodes, mirror);
      const updated = runGeometryPipeline(
        {
          ...path,
          nodes: snapped,
          meta: { ...path.meta, closed: path.meta.closed || closed, updatedAt: Date.now() },
        },
        state.oxidationProgress,
      );
      const nextPaths = [...state.paths];
      nextPaths[pathIndex] = updated;
      return {
        ...state,
        paths: nextPaths,
        history,
        future: [],
        dirty: true,
        nodeSelection: pruneNodeSelection(state.nodeSelection, pathId, updated.nodes),
      };
    });
  },
  updateGrid: (settings) => set((state) => ({
    grid: { ...state.grid, ...settings },
    dirty: true,
  })),
  updateMirror: (settings) => set((state) => ({
    mirror: { ...state.mirror, ...settings },
    dirty: true,
  })),
  setDirectionalLinking: (value) => set({ directionalLinking: value }),
  setOxidationProgress: (value) =>
    set((state) => {
      const clampedValue = clamp(value, 0, 1);
      if (Math.abs(state.oxidationProgress - clampedValue) < 1e-4) {
        return state;
      }
      const nextPaths = state.paths.map((path) => runGeometryPipeline(path, clampedValue));
      return {
        ...state,
        paths: nextPaths,
        oxidationProgress: clampedValue,
        dirty: true,
        future: [],
      };
    }),
  updateOxidationDefaults: (settings) =>
    set((state) => ({
      oxidationDefaults: mergeOxidationSettings(state.oxidationDefaults, settings),
      dirty: true,
    })),
  updateSelectedOxidation: (settings) =>
    set((state) => {
      if (!state.selectedPathIds.length) return state;
      const history = [...state.history, captureSnapshot(state)].slice(-50);
      const selected = new Set(state.selectedPathIds);
      const nextPaths = state.paths.map((path) => {
        if (!selected.has(path.meta.id)) return path;
        const oxidation = mergeOxidationSettings(path.oxidation, settings);
        return runGeometryPipeline(
          {
            ...path,
            oxidation,
            meta: { ...path.meta, updatedAt: Date.now() },
          },
          state.oxidationProgress,
        );
      });
      return {
        ...state,
        paths: nextPaths,
        history,
        future: [],
        dirty: true,
      };
    }),
  setPathMeta: (id, patch) =>
    set((state) => {
      const index = state.paths.findIndex((path) => path.meta.id === id);
      if (index === -1) return state;
      const nextPaths = [...state.paths];
      nextPaths[index] = {
        ...nextPaths[index],
        meta: { ...nextPaths[index].meta, ...patch, updatedAt: Date.now() },
      };
      return { ...state, paths: nextPaths, dirty: true };
    }),
  setHoverProbe: (probe) =>
    set((state) => ({
      measurements: { ...state.measurements, hoverProbe: probe },
    })),
  setPinnedProbe: (probe) =>
    set((state) => ({
      measurements: { ...state.measurements, pinnedProbe: probe },
    })),
  setDragProbe: (probe) =>
    set((state) => ({
      measurements: { ...state.measurements, dragProbe: probe },
    })),
  setMeasurementSnapping: (value) => set((state) => ({
    measurements: { ...state.measurements, snapping: value },
  })),
  setHeatmapVisible: (value) => set((state) => ({
    measurements: { ...state.measurements, showHeatmap: value },
  })),
  pushWarning: (message, level = 'warning') => set((state) => ({
    warnings: [
      ...state.warnings,
      {
        id: createId('warn'),
        level,
        message,
        createdAt: Date.now(),
      },
    ],
  })),
  dismissWarning: (id) => set((state) => ({
    warnings: state.warnings.filter((warning) => warning.id !== id),
  })),
  toggleOxidationVisible: (value) => set({ oxidationVisible: value }),
  markBootstrapped: () => set({ bootstrapped: true }),
  saveShapeToLibrary: (pathId, name) =>
    set((state) => {
      const path = state.paths.find((entry) => entry.meta.id === pathId);
      if (!path) return state;
      const shape: StoredShape = {
        id: createId('shape'),
        name: name.trim() || path.meta.name,
        nodes: path.nodes.map((node) => ({ ...node })),
        oxidation: cloneOxidationSettings(path.oxidation),
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      const library = [shape, ...state.library];
      persistLibrary(library);
      return { ...state, library };
    }),
  removeShapeFromLibrary: (shapeId) =>
    set((state) => {
      const library = state.library.filter((shape) => shape.id !== shapeId);
      persistLibrary(library);
      return { ...state, library };
    }),
  renameShapeInLibrary: (shapeId, name) =>
    set((state) => {
      const library = state.library.map((shape) =>
        shape.id === shapeId
          ? { ...shape, name: name.trim() || shape.name, updatedAt: Date.now() }
          : shape,
      );
      persistLibrary(library);
      return { ...state, library };
    }),
  loadShapeFromLibrary: (shapeId) => {
    const shape = get().library.find((entry) => entry.id === shapeId);
    if (!shape) return;
    const cloned = cloneStoredShape(shape);
    get().addPath(cloned.nodes, {
      oxidation: cloned.oxidation,
      meta: {
        id: createId('path'),
        name: cloned.name,
        closed: true,
        visible: true,
        locked: false,
        color: '#2563eb',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    });
  },
  resetScene: () =>
    set((state) => ({
      ...state,
      paths: [],
      selectedPathIds: [],
      nodeSelection: null,
      measurements: {
        ...state.measurements,
        hoverProbe: null,
        pinnedProbe: null,
        dragProbe: null,
      },
      history: [],
      future: [],
      dirty: true,
      bootstrapped: true,
    })),
  undo: () => {
    const { history } = get();
    if (!history.length) return;
    set((state) => {
      const previous = history[history.length - 1];
      const nextHistory = history.slice(0, -1);
      const futureSnapshot = captureSnapshot(state);
      return {
        ...state,
        paths: previous.paths.map(clonePath),
        selectedPathIds: [...previous.selectedPathIds],
        activeTool: previous.activeTool,
        nodeSelection: previous.nodeSelection
          ? { pathId: previous.nodeSelection.pathId, nodeIds: [...previous.nodeSelection.nodeIds] }
          : null,
        history: nextHistory,
        future: [...state.future, futureSnapshot].slice(-50),
        dirty: true,
        oxidationProgress: previous.oxidationProgress,
      };
    });
  },
  redo: () => {
    const { future } = get();
    if (!future.length) return;
    set((state) => {
      const snapshot = future[future.length - 1];
      const remaining = future.slice(0, -1);
      const historySnapshot = captureSnapshot(state);
      return {
        ...state,
        paths: snapshot.paths.map(clonePath),
        selectedPathIds: [...snapshot.selectedPathIds],
        activeTool: snapshot.activeTool,
        nodeSelection: snapshot.nodeSelection
          ? { pathId: snapshot.nodeSelection.pathId, nodeIds: [...snapshot.nodeSelection.nodeIds] }
          : null,
        history: [...state.history, historySnapshot].slice(-50),
        future: remaining,
        dirty: true,
        oxidationProgress: snapshot.oxidationProgress,
      };
    });
  },
  importState: (payload) =>
    set((state) => ({
      ...createEmptyState(state.library.map(cloneStoredShape)),
      ...payload,
      oxidationVisible: payload.oxidationVisible ?? true,
      oxidationProgress: payload.oxidationProgress ?? 1,
      directionalLinking: payload.directionalLinking ?? true,
      bootstrapped: payload.bootstrapped ?? true,
      library: state.library.map(cloneStoredShape),
      history: [],
      future: [],
      dirty: false,
    })),
  reset: () =>
    set((state) => ({
      ...createEmptyState(state.library.map(cloneStoredShape)),
      library: state.library.map(cloneStoredShape),
    })),
  toggleSegmentCurve: (pathId, segmentIndex) => {
    const mirror = get().mirror;
    set((state) => {
      const pathIndex = state.paths.findIndex((path) => path.meta.id === pathId);
      if (pathIndex === -1) return state;
      const path = state.paths[pathIndex];
      const totalSegments = path.meta.closed ? path.nodes.length : path.nodes.length - 1;
      if (segmentIndex < 0 || segmentIndex >= totalSegments) {
        return state;
      }
      const history = [...state.history, captureSnapshot(state)].slice(-50);
      const nodes = path.nodes.map((node) => ({ ...node }));
      const currentIndex = segmentIndex;
      const nextIndex = (segmentIndex + 1) % nodes.length;
      const current = nodes[currentIndex];
      const next = nodes[nextIndex];
      const hasHandles = Boolean(current.handleOut) || Boolean(next.handleIn);
      if (hasHandles) {
        nodes[currentIndex] = { ...current, handleOut: null };
        nodes[nextIndex] = { ...next, handleIn: null };
      } else {
        const vx = next.point.x - current.point.x;
        const vy = next.point.y - current.point.y;
        const length = Math.hypot(vx, vy) || 1;
        const scale = length / 3;
        const nx = vx / length;
        const ny = vy / length;
        nodes[currentIndex] = {
          ...current,
          handleOut: {
            x: current.point.x + nx * scale,
            y: current.point.y + ny * scale,
          },
        };
        nodes[nextIndex] = {
          ...next,
          handleIn: {
            x: next.point.x - nx * scale,
            y: next.point.y - ny * scale,
          },
        };
      }
      const { nodes: mergedNodes } = mergeEndpointsIfClose(nodes, path.meta.closed);
      const snapped = applyMirrorSnapping(mergedNodes, mirror);
      const updated = runGeometryPipeline(
        {
          ...path,
          nodes: snapped,
          meta: { ...path.meta, updatedAt: Date.now() },
        },
        state.oxidationProgress,
      );
      const nextPaths = [...state.paths];
      nextPaths[pathIndex] = updated;
      return {
        ...state,
        paths: nextPaths,
        history,
        future: [],
        dirty: true,
        nodeSelection: pruneNodeSelection(state.nodeSelection, pathId, updated.nodes),
      };
    });
  },
}));
