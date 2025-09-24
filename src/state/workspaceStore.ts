import { create } from 'zustand';
import type {
  MeasurementProbe,
  OxidationSettings,
  PathEntity,
  PathNode,
  ToolId,
  WorkspaceSnapshot,
  WorkspaceState,
} from '../types';
import { createId } from '../utils/ids';
import {
  adaptiveSamplePath,
  accumulateLength,
  evalThickness,
  recomputeNormals,
  smoothSamples,
} from '../geometry';

const defaultOxidation: OxidationSettings = {
  kernelWidth: 18,
  targetThickness: 12,
  baseThickness: 5,
  smoothingIterations: 2,
  smoothingStrength: 0.6,
  evaluationSpacing: 12,
  vonMisesKappa: 5,
  directionalFocus: 8,
  mirrorSymmetry: false,
  directionalWeights: [],
};

const createEmptyState = (): WorkspaceState => ({
  paths: [],
  selectedPathIds: [],
  activeTool: 'pen',
  grid: {
    visible: true,
    snapToGrid: false,
    spacing: 24,
    subdivisions: 4,
  },
  mirror: {
    enabled: false,
    axis: 'y',
    origin: { x: 0, y: 0 },
    livePreview: true,
  },
  oxidationDefaults: { ...defaultOxidation },
  measurements: {
    activeProbe: null,
    history: [],
    snapping: true,
    showHeatmap: true,
  },
  warnings: [],
  history: [],
  future: [],
  dirty: false,
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
  oxidation: { ...path.oxidation },
  meta: { ...path.meta },
});

const captureSnapshot = (state: WorkspaceState): WorkspaceSnapshot => ({
  timestamp: Date.now(),
  paths: state.paths.map(clonePath),
  selectedPathIds: [...state.selectedPathIds],
  activeTool: state.activeTool,
});

type PathUpdater = (nodes: PathNode[]) => PathNode[];

import { createId } from '../utils/ids';
import type {
  DirectionalWeight,
  MeasurementProbe,
  OxidationSettings,
// ...
type WorkspaceActions = {
  setActiveTool: (tool: ToolId) => void;
  addPath: (nodes: PathNode[], overrides?: Partial<PathEntity>) => string;
  updatePath: (id: string, updater: PathUpdater) => void;
  removePath: (id: string) => void;
  setSelected: (ids: string[]) => void;
  updateGrid: (settings: Partial<WorkspaceState['grid']>) => void;
  updateMirror: (settings: Partial<WorkspaceState['mirror']>) => void;
  updateOxidationDefaults: (settings: Partial<OxidationSettings>) => void;
  addDirectionalWeight: () => void;
  updateDirectionalWeight: (
    id: string,
    newWeight: Partial<Omit<DirectionalWeight, 'id'>>,
  ) => void;
  removeDirectionalWeight: (id: string) => void;
  setProbe: (probe: MeasurementProbe | null) => void;
  addProbe: (probe: MeasurementProbe) => void;
  clearProbes: () => void;
  setMeasurementSnapping: (value: boolean) => void;
  setHeatmapVisible: (value: boolean) => void;
  pushWarning: (message: string, level?: 'info' | 'warning' | 'error') => void;
  dismissWarning: (id: string) => void;
  undo: () => void;
  redo: () => void;
  importState: (state: WorkspaceState) => void;
  reset: () => void;
};

export type WorkspaceStore = WorkspaceState & WorkspaceActions;

const runGeometryPipeline = (path: PathEntity): PathEntity => {
  const sampled = adaptiveSamplePath(path, {
    spacing: path.oxidation.evaluationSpacing,
  });
  const normals = recomputeNormals(sampled.samples);
  const smoothed = smoothSamples(
    normals,
    path.oxidation.smoothingIterations,
    path.oxidation.smoothingStrength,
  );
  const withThickness = evalThickness(smoothed, {
    baseThickness: path.oxidation.baseThickness,
    directionalWeights: path.oxidation.directionalWeights,
    directionalFocus: path.oxidation.directionalFocus,
  });
  const length = accumulateLength(withThickness);
  return {
    ...path,
    sampled: {
      id: path.meta.id,
      samples: withThickness,
      length,
    },
  };
};

export const useWorkspaceStore = create<WorkspaceStore>((set, get) => ({
  ...createEmptyState(),
  setActiveTool: (tool) => set({ activeTool: tool }),
  addPath: (nodes, overrides) => {
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
      const newPath: PathEntity = runGeometryPipeline({
        meta,
        nodes,
        oxidation: overrides?.oxidation ? { ...overrides.oxidation } : { ...state.oxidationDefaults },
        sampled: undefined,
      });
      return {
        ...state,
        paths: [...state.paths, newPath],
        selectedPathIds: [newPath.meta.id],
        history,
        future: [],
        dirty: true,
      };
    });
    return id;
  },
  updatePath: (id, updater) => {
    set((state) => {
      const index = state.paths.findIndex((path) => path.meta.id === id);
      if (index === -1) return state;
      const history = [...state.history, captureSnapshot(state)].slice(-50);
      const target = state.paths[index];
      const nodes = updater(target.nodes.map((node) => ({ ...node })));
      const updated = runGeometryPipeline({
        ...target,
        nodes,
        meta: { ...target.meta, updatedAt: Date.now() },
      });
      const nextPaths = [...state.paths];
      nextPaths[index] = updated;
      return {
        ...state,
        paths: nextPaths,
        history,
        future: [],
        dirty: true,
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
        history,
        future: [],
        dirty: true,
      };
    });
  },
  setSelected: (ids) => set({ selectedPathIds: ids }),
  updateGrid: (settings) => set((state) => ({
    grid: { ...state.grid, ...settings },
    dirty: true,
  })),
  updateMirror: (settings) => set((state) => ({
    mirror: { ...state.mirror, ...settings },
    dirty: true,
  })),
  updateOxidationDefaults: (settings) => set((state) => ({
    oxidationDefaults: { ...state.oxidationDefaults, ...settings },
    dirty: true,
  })),
  addDirectionalWeight: () =>
    set((state) => {
      const newWeight: DirectionalWeight = {
        id: createId('dweight'),
        angle: 0,
        strength: 5,
      };
      return {
        oxidationDefaults: {
          ...state.oxidationDefaults,
          directionalWeights: [...state.oxidationDefaults.directionalWeights, newWeight],
        },
        dirty: true,
      };
    }),
  updateDirectionalWeight: (id, newWeight) =>
    set((state) => {
      const index = state.oxidationDefaults.directionalWeights.findIndex((w) => w.id === id);
      if (index === -1) return state;
      const nextWeights = [...state.oxidationDefaults.directionalWeights];
      nextWeights[index] = { ...nextWeights[index], ...newWeight };
      return {
        oxidationDefaults: {
          ...state.oxidationDefaults,
          directionalWeights: nextWeights,
        },
        dirty: true,
      };
    }),
  removeDirectionalWeight: (id) =>
    set((state) => ({
      oxidationDefaults: {
        ...state.oxidationDefaults,
        directionalWeights: state.oxidationDefaults.directionalWeights.filter((w) => w.id !== id),
      },
      dirty: true,
    })),
  setProbe: (probe) => set((state) => ({
    measurements: { ...state.measurements, activeProbe: probe },
  })),
  addProbe: (probe) => set((state) => ({
    measurements: {
      ...state.measurements,
      history: [probe, ...state.measurements.history].slice(0, 12),
      activeProbe: probe,
    },
  })),
  clearProbes: () => set((state) => ({
    measurements: { ...state.measurements, history: [], activeProbe: null },
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
        history: [...state.history, historySnapshot].slice(-50),
        future: remaining,
        dirty: true,
      };
    });
  },
  importState: (payload) => set(() => ({ ...payload, history: [], future: [], dirty: false })),
  reset: () => set(() => createEmptyState()),
}));
