export type ToolId =
  | 'select'
  | 'line'
  | 'dot'
  | 'measure'
  | 'oxidize'
  | 'pan'
  | 'erase';

export interface Vec2 {
  x: number;
  y: number;
}

export interface PathNode {
  id: string;
  point: Vec2;
  handleIn?: Vec2 | null;
  handleOut?: Vec2 | null;
  pressure?: number;
  timestamp?: number;
}

export interface DirectionWeight {
  id: string;
  label: string;
  angleDeg: number;
  valueUm: number;
}

export interface WeightsByDirection {
  items: DirectionWeight[];
}

export interface PathMeta {
  id: string;
  name: string;
  closed: boolean;
  visible: boolean;
  locked: boolean;
  color: string;
  createdAt: number;
  updatedAt: number;
}

export interface SamplePoint {
  position: Vec2;
  tangent: Vec2;
  normal: Vec2;
  thickness: number;
  curvature: number;
  parameter: number;
  segmentIndex?: number;
}

export interface SampledPath {
  id: string;
  samples: SamplePoint[];
  length: number;
  innerSamples?: Vec2[];
  innerPolygons?: Vec2[][];
}

export interface OxidationSettings {
  thicknessUniformUm: number;
  thicknessByDirection: WeightsByDirection;
  evaluationSpacing: number;
  mirrorSymmetry: boolean;
}

export interface OxidationPreset {
  id: string;
  label: string;
  settings: OxidationSettings;
}

export interface StoredShape {
  id: string;
  name: string;
  nodes: PathNode[];
  oxidation: OxidationSettings;
  createdAt: number;
  updatedAt: number;
}

export interface GridSettings {
  visible: boolean;
  snapToGrid: boolean;
  spacing: number;
  subdivisions: number;
}

export interface MirrorSettings {
  enabled: boolean;
  axis: 'x' | 'y' | 'xy';
  origin: Vec2;
  livePreview: boolean;
}

export interface MeasurementProbe {
  id: string;
  a: Vec2;
  b: Vec2;
  distance: number;
  angleDeg: number;
  thicknessA?: number;
  thicknessB?: number;
}

export interface MeasurementState {
  hoverProbe: MeasurementProbe | null;
  pinnedProbe: MeasurementProbe | null;
  dragProbe: MeasurementProbe | null;
  snapping: boolean;
  showHeatmap: boolean;
}

export interface NodeSelection {
  pathId: string;
  nodeIds: string[];
}

export interface PathEntity {
  meta: PathMeta;
  nodes: PathNode[];
  oxidation: OxidationSettings;
  sampled?: SampledPath;
}

export interface WorkspaceWarning {
  id: string;
  level: 'info' | 'warning' | 'error';
  message: string;
  createdAt: number;
}

export interface WorkspaceSnapshot {
  timestamp: number;
  paths: PathEntity[];
  selectedPathIds: string[];
  activeTool: ToolId;
  nodeSelection: NodeSelection | null;
  oxidationProgress: number;
  zoom: number;
  pan: Vec2;
}

export interface WorkspaceState {
  paths: PathEntity[];
  selectedPathIds: string[];
  nodeSelection: NodeSelection | null;
  activeTool: ToolId;
  grid: GridSettings;
  mirror: MirrorSettings;
  oxidationDefaults: OxidationSettings;
  measurements: MeasurementState;
  warnings: WorkspaceWarning[];
  history: WorkspaceSnapshot[];
  future: WorkspaceSnapshot[];
  dirty: boolean;
  oxidationVisible: boolean;
  oxidationProgress: number;
  directionalLinking: boolean;
  bootstrapped: boolean;
  library: StoredShape[];
  zoom: number;
  pan: Vec2;
}

export interface ExportedProject {
  version: 1;
  metadata: {
    name: string;
    exportedAt: string;
  };
  payload: WorkspaceState;
}

export type JsonProject = ExportedProject;
