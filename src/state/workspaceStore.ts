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
import { clamp, distance, normalize, alignLoop } from '../utils/math';
import createSDF from 'sdf-polygon-2d';
import { isoLines } from 'marching-squares';
import { evalThicknessForAngle, type ThicknessOptions } from '../geometry/thickness';

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
  thicknessOptions: ThicknessOptions,
): { innerSamples: Vec2[]; polygons: Vec2[][] } => {
  if (!closed || samples.length < 3) {
    const innerSamples = samples.map((sample) => ({
      x: sample.position.x - sample.normal.x * sample.thickness,
      y: sample.position.y - sample.normal.y * sample.thickness,
    }));
    return { innerSamples, polygons: [] };
  }

  const padding = 15;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const sample of samples) {
    minX = Math.min(minX, sample.position.x);
    minY = Math.min(minY, sample.position.y);
    maxX = Math.max(maxX, sample.position.x);
    maxY = Math.max(maxY, sample.position.y);
  }
  minX -= padding;
  minY -= padding;
  maxX += padding;
  maxY += padding;

  const outerPolygon = samples.map((s) => [s.position.x, s.position.y]);
  const sdf = createSDF([outerPolygon]);

  const resolution = 0.5;
  const gridWidth = Math.ceil((maxX - minX) / resolution);
  const gridHeight = Math.ceil((maxY - minY) / resolution);
  const scalarField: number[][] = Array.from({ length: gridHeight }, () => Array(gridWidth).fill(0));

  const h = 0.5;

  for (let gy = 0; gy < gridHeight; gy++) {
    for (let gx = 0; gx < gridWidth; gx++) {
      const worldX = minX + gx * resolution;
      const worldY = minY + gy * resolution;

      const sdfValue = sdf(worldX, worldY);

      const gradX = sdf(worldX + h, worldY) - sdf(worldX - h, worldY);
      const gradY = sdf(worldX, worldY + h) - sdf(worldX, worldY - h);
      const gradient = normalize({ x: gradX, y: gradY });
      const normalAngle = Math.atan2(gradient.y, gradient.x);

      const inwardNormalAngle = normalAngle + Math.PI;
      const targetThickness = evalThicknessForAngle(inwardNormalAngle, thicknessOptions);

      scalarField[gy][gx] = sdfValue + targetThickness;
    }
  }

  const rawContours = isoLines(scalarField, [0], { noQuadTree: true })[0] ?? [];

  const toWorld = ([px, py]: [number, number]): Vec2 => ({
    x: minX + px * resolution,
    y: minY + py * resolution,
  });

  const polygons = rawContours.flatMap((ring) => {
    const worldRing = ring.map(toWorld);
    const cleaned = cleanAndSimplifyPolygons(worldRing);
    return cleaned.length ? cleaned : [worldRing];
  });

  if (!polygons.length) {
    return { innerSamples: [], polygons: [] };
  }

  const primaryPolygon = polygons.reduce((largest, poly) =>
    Math.abs(polygonArea(poly)) > Math.abs(polygonArea(largest)) ? poly : largest,
  polygons[0]);

  if (primaryPolygon.length < 3) {
    return { innerSamples: [], polygons: polygons };
  }

  const rawInnerPoints = samples.map((sample) => ({
    x: sample.position.x - sample.normal.x * sample.thickness,
    y: sample.position.y - sample.normal.y * sample.thickness,
  }));

  const resampled = resampleClosedPolygon(primaryPolygon, samples.length);
  const innerSamples = alignLoop(resampled, rawInnerPoints);

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

  const thicknessOptions = {
    uniformThickness: path.oxidation.thicknessUniformUm,
    weights: path.oxidation.thicknessByDirection.items,
    mirrorSymmetry: path.oxidation.mirrorSymmetry,
    progress,
  };

  const { innerSamples, polygons } = deriveInnerGeometry(
    withThickness,
    path.meta.closed,
    thicknessOptions,
  );
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
