import { create } from 'zustand';
import type {
  DirectionWeight,
  DirKey,
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
  smoothSamples,
} from '../geometry';
import { clamp, distance } from '../utils/math';

const LIBRARY_STORAGE_KEY = 'visoxid:shape-library';

const MAX_THICKNESS_UM = 10;
const ENDPOINT_MERGE_THRESHOLD = 4;
const MIRROR_SNAP_THRESHOLD = 1.5;

const clampThickness = (value: number): number => clamp(value, 0, MAX_THICKNESS_UM);

const DIAGONAL_DEPENDENCIES: Array<{ target: DirKey; a: DirKey; b: DirKey }> = [
  { target: 'NE', a: 'N', b: 'E' },
  { target: 'SE', a: 'S', b: 'E' },
  { target: 'SW', a: 'S', b: 'W' },
  { target: 'NW', a: 'N', b: 'W' },
];

const autoFillDirectionalWeights = (items: DirectionWeight[]): DirectionWeight[] => {
  const byDir: Map<DirKey, DirectionWeight> = new Map();
  items.forEach((item) => {
    byDir.set(item.dir, { ...item, valueUm: clampThickness(item.valueUm) });
  });
  DIAGONAL_DEPENDENCIES.forEach(({ target, a, b }) => {
    const first = byDir.get(a)?.valueUm ?? 0;
    const second = byDir.get(b)?.valueUm ?? 0;
    const average = (first + second) / 2;
    const existing = byDir.get(target);
    if (existing) {
      byDir.set(target, { ...existing, valueUm: average });
    } else {
      byDir.set(target, { dir: target, valueUm: average });
    }
  });
  const directions: DirKey[] = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return directions.map((dir) => byDir.get(dir) ?? { dir, valueUm: 0 });
};

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

const createDefaultDirectionWeights = (): DirectionWeight[] => [
  { dir: 'N', valueUm: 0 },
  { dir: 'NE', valueUm: 0 },
  { dir: 'E', valueUm: 0 },
  { dir: 'SE', valueUm: 0 },
  { dir: 'S', valueUm: 0 },
  { dir: 'SW', valueUm: 0 },
  { dir: 'W', valueUm: 0 },
  { dir: 'NW', valueUm: 0 },
];

const createDefaultOxidation = (): OxidationSettings => ({
  thicknessUniformUm: 5,
  thicknessByDirection: {
    items: createDefaultDirectionWeights(),
    kappa: 4,
  },
  smoothingIterations: 2,
  smoothingStrength: 0.6,
  evaluationSpacing: 12,
  mirrorSymmetry: false,
});

const cloneOxidationSettings = (settings: OxidationSettings): OxidationSettings => ({
  ...settings,
  thicknessByDirection: {
    kappa: settings.thicknessByDirection.kappa,
    items: autoFillDirectionalWeights(settings.thicknessByDirection.items),
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
  if (patch.smoothingIterations !== undefined) {
    merged.smoothingIterations = patch.smoothingIterations;
  }
  if (patch.smoothingStrength !== undefined) {
    merged.smoothingStrength = patch.smoothingStrength;
  }
  if (patch.evaluationSpacing !== undefined) {
    merged.evaluationSpacing = patch.evaluationSpacing;
  }
  if (patch.mirrorSymmetry !== undefined) {
    merged.mirrorSymmetry = patch.mirrorSymmetry;
  }
  if (patch.thicknessByDirection) {
    const { kappa, items } = patch.thicknessByDirection;
    merged.thicknessByDirection = {
      kappa: kappa ?? merged.thicknessByDirection.kappa,
      items: items
        ? items.map((item) => ({ ...item, valueUm: clampThickness(item.valueUm) }))
        : merged.thicknessByDirection.items.map((item) => ({ ...item })),
    };
  }
  merged.thicknessUniformUm = clampThickness(merged.thicknessUniformUm);
  merged.thicknessByDirection.items = autoFillDirectionalWeights(
    merged.thicknessByDirection.items,
  );
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
  const inner = samples.map((sample) => ({
    x: sample.position.x - sample.normal.x * sample.thickness,
    y: sample.position.y - sample.normal.y * sample.thickness,
  }));
  if (!closed || inner.length < 3) {
    return { innerSamples: inner, polygons: closed ? [inner] : [] };
  }
  const polygons = cleanAndSimplifyPolygons(inner);
  if (!polygons.length) {
    return { innerSamples: inner, polygons: [] };
  }
  const primary = polygons.reduce((largest, poly) =>
    Math.abs(polygonArea(poly)) > Math.abs(polygonArea(largest)) ? poly : largest,
  polygons[0]);
  const resampled = resampleClosedPolygon(primary, samples.length);
  const aligned = alignClosedSequence(resampled, inner);
  return { innerSamples: aligned.length ? aligned : inner, polygons };
};

const alignClosedSequence = (source: Vec2[], target: Vec2[]): Vec2[] => {
  if (!source.length || source.length !== target.length) {
    return source;
  }
  const length = source.length;
  const findBestOffset = (points: Vec2[]): number => {
    let bestIndex = 0;
    let bestDist = Number.POSITIVE_INFINITY;
    for (let i = 0; i < length; i += 1) {
      const dx = points[i].x - target[0].x;
      const dy = points[i].y - target[0].y;
      const distSq = dx * dx + dy * dy;
      if (distSq < bestDist) {
        bestDist = distSq;
        bestIndex = i;
      }
    }
    return bestIndex;
  };
  const rotate = (points: Vec2[], offset: number): Vec2[] =>
    points.map((_, idx) => points[(idx + offset) % length]);
  const forwardOffset = findBestOffset(source);
  const forward = rotate(source, forwardOffset);
  const reversedSource = [...source].reverse();
  const reverseOffset = findBestOffset(reversedSource);
  const reversed = rotate(reversedSource, reverseOffset);
  const sampleError = (points: Vec2[]): number => {
    const samples = Math.min(points.length, 24);
    let total = 0;
    for (let i = 0; i < samples; i += 1) {
      const idx = Math.floor((i / samples) * points.length);
      const dx = points[idx].x - target[idx].x;
      const dy = points[idx].y - target[idx].y;
      total += dx * dx + dy * dy;
    }
    return total;
  };
  return sampleError(forward) <= sampleError(reversed) ? forward : reversed;
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

const runGeometryPipeline = (path: PathEntity): PathEntity => {
  const sampled = adaptiveSamplePath(path, {
    spacing: path.oxidation.evaluationSpacing,
  });
  const normals = recomputeNormals(sampled.samples);
  const seeded = normals.map((sample) => ({
    ...sample,
    thickness: path.oxidation.thicknessUniformUm,
  }));
  const smoothed = smoothSamples(
    seeded,
    path.oxidation.smoothingIterations,
    path.oxidation.smoothingStrength,
  );
  const withThickness = evalThickness(smoothed, {
    uniformThickness: path.oxidation.thicknessUniformUm,
    weights: path.oxidation.thicknessByDirection.items,
    kappa: path.oxidation.thicknessByDirection.kappa,
    mirrorSymmetry: path.oxidation.mirrorSymmetry,
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
      const newPath: PathEntity = runGeometryPipeline({
        meta: finalMeta,
        nodes: snapped,
        oxidation: overrides?.oxidation
          ? cloneOxidationSettings(overrides.oxidation)
          : cloneOxidationSettings(state.oxidationDefaults),
        sampled: undefined,
      });
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
      const updated = runGeometryPipeline({
        ...target,
        nodes: snapped,
        meta: {
          ...target.meta,
          closed: target.meta.closed || closed,
          updatedAt: Date.now(),
        },
      });
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
      const updated = runGeometryPipeline({
        ...path,
        nodes: snapped,
        meta: { ...path.meta, closed: finalClosed, updatedAt: Date.now() },
      });
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
      const updated = runGeometryPipeline({
        ...path,
        nodes: snapped,
        meta: { ...path.meta, closed: path.meta.closed || closed, updatedAt: Date.now() },
      });
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
        return runGeometryPipeline({
          ...path,
          oxidation,
          meta: { ...path.meta, updatedAt: Date.now() },
        });
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
      };
    });
  },
  importState: (payload) =>
    set((state) => ({
      ...createEmptyState(state.library.map(cloneStoredShape)),
      ...payload,
      oxidationVisible: payload.oxidationVisible ?? true,
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
      const updated = runGeometryPipeline({
        ...path,
        nodes: snapped,
        meta: { ...path.meta, updatedAt: Date.now() },
      });
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
