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
import type { ThicknessOptions } from '../geometry/thickness';
import { createId } from '../utils/ids';
import {
  adaptiveSamplePath,
  accumulateLength,
  cleanAndSimplifyPolygons,
  evalThickness,
  evalThicknessForAngle,
  polygonArea,
  recomputeNormals,
  resampleClosedPolygon,
} from '../geometry';
import { laplacianSmooth } from '../geometry/smoothing';
import { alignLoop, clamp, distance, dot, sub } from '../utils/math';

const LIBRARY_STORAGE_KEY = 'visoxid:shape-library';

const MAX_THICKNESS_UM = 10;
const ENDPOINT_MERGE_THRESHOLD = 4;
const MIRROR_SNAP_THRESHOLD = 1.5;
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 8;
const MAX_DOT_COUNT = 1000;
const DEFAULT_DOT_COUNT = 240;

const clampThickness = (value: number): number => clamp(value, 0, MAX_THICKNESS_UM);
const clampZoom = (value: number): number => clamp(value, MIN_ZOOM, MAX_ZOOM);

const clampDotCount = (value: number | undefined): number => {
  if (!Number.isFinite(value ?? DEFAULT_DOT_COUNT)) {
    return DEFAULT_DOT_COUNT;
  }
  const rounded = Math.round(value ?? DEFAULT_DOT_COUNT);
  return clamp(rounded, 0, MAX_DOT_COUNT);
};

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
    createDirectionalWeight('E', 0),
    createDirectionalWeight('NE', 45),
    createDirectionalWeight('N', 90),
    createDirectionalWeight('NW', 135),
    createDirectionalWeight('W', 180),
    createDirectionalWeight('SW', 225),
    createDirectionalWeight('S', 270),
    createDirectionalWeight('SE', 315),
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

const angularDistance = (a: number, b: number): number => {
  let delta = Math.abs(a - b);
  if (delta > Math.PI) {
    delta = TAU - delta;
  }
  return delta;
};

const angleInArc = (angle: number, arc: Arc): boolean =>
  angle >= arc.start - EPS && angle <= arc.end + EPS;

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

const toPointOnCircle = (circle: Circle, angle: number, radiusOverride?: number): Vec2 => {
  const radius = radiusOverride ?? circle.radius;
  return {
    x: circle.center.x + radius * Math.cos(angle),
    y: circle.center.y + radius * Math.sin(angle),
  };
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

const orientation = (a: Vec2, b: Vec2, c: Vec2): number =>
  (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);

const onSegment = (a: Vec2, b: Vec2, c: Vec2): boolean =>
  Math.min(a.x, b.x) - EPS <= c.x &&
  c.x <= Math.max(a.x, b.x) + EPS &&
  Math.min(a.y, b.y) - EPS <= c.y &&
  c.y <= Math.max(a.y, b.y) + EPS;

const segmentsIntersect = (a1: Vec2, a2: Vec2, b1: Vec2, b2: Vec2): boolean => {
  const o1 = orientation(a1, a2, b1);
  const o2 = orientation(a1, a2, b2);
  const o3 = orientation(b1, b2, a1);
  const o4 = orientation(b1, b2, a2);

  const s1 = o1 * o2;
  const s2 = o3 * o4;

  if (s1 < -EPS && s2 < -EPS) {
    return true;
  }

  if (Math.abs(o1) <= EPS && onSegment(a1, a2, b1)) return true;
  if (Math.abs(o2) <= EPS && onSegment(a1, a2, b2)) return true;
  if (Math.abs(o3) <= EPS && onSegment(b1, b2, a1)) return true;
  if (Math.abs(o4) <= EPS && onSegment(b1, b2, a2)) return true;

  return false;
};

interface EnvelopeOptions {
  orientationSign: number;
  resolution: number;
  restrictToInward: boolean;
}

const computeCircleEnvelope = (
  samples: SamplePoint[],
  fallbackInner: Vec2[],
  options: EnvelopeOptions,
  thicknessOptions: ThicknessOptions,
): { candidates: Vec2[]; denseLoop: Vec2[] } => {
  const inwardAngles: number[] = [];

  const radiusForAngle = (angle: number): number => {
    const queryAngle = options.restrictToInward
      ? wrapAngle(angle + Math.PI)
      : wrapAngle(angle);
    return Math.max(evalThicknessForAngle(queryAngle, thicknessOptions), 0);
  };

  const circles: Circle[] = samples.map((sample) => {
    const inwardAngle = wrapAngle(Math.atan2(-sample.normal.y, -sample.normal.x));
    inwardAngles.push(inwardAngle);
    const baselineRadius = radiusForAngle(inwardAngle);
    return {
      center: sample.position,
      radius: baselineRadius,
      normal: sample.normal,
    };
  });

  const denseLoop: Vec2[] = [];

  const appendToDenseLoop = (points: Vec2[]): void => {
    for (const point of points) {
      const last = denseLoop.at(-1);
      if (!last || distance(last, point) > Math.max(options.resolution * 0.25, 0.01)) {
        denseLoop.push(point);
      }
    }
  };

  const candidates = samples.map((sample, index) => {
    const circle = circles[index];
    const fallback = fallbackInner[index] ?? sample.position;
    const inwardAngle = inwardAngles[index] ?? wrapAngle(Math.atan2(-sample.normal.y, -sample.normal.x));
    const baselineRadius = radiusForAngle(inwardAngle);
    if (baselineRadius <= EPS) {
      appendToDenseLoop([fallback]);
      return fallback;
    }

    let arcs: Arc[] = [{ start: 0, end: TAU }];
    for (let j = 0; j < circles.length; j += 1) {
      if (j === index) continue;
      const other = circles[j];
      if (other.radius <= EPS) continue;
      const occluded = computeOcclusionIntervals(circle, other);
      if (occluded.length) {
        arcs = subtractIntervals(arcs, occluded);
        if (!arcs.length) break;
      }
    }

    arcs = arcs
      .filter((arc) => arc.end - arc.start > EPS)
      .map((arc) => ({
        start: Math.max(0, Math.min(arc.start, TAU)),
        end: Math.max(0, Math.min(arc.end, TAU)),
      }))
      .filter((arc) => arc.end - arc.start > EPS)
      .sort((a, b) => a.start - b.start);

    const inwardArc = arcs.find((arc) => angleInArc(inwardAngle, arc));
    const allowAllAngles = !options.restrictToInward;

    const arcCandidates = arcs.filter((arc) => {
      const mid = wrapAngle(arc.start + (arc.end - arc.start) / 2);
      const radius = radiusForAngle(mid);
      if (radius <= EPS) return false;
      if (allowAllAngles) return true;
      const midPoint = toPointOnCircle(circle, mid, radius);
      const direction = sub(midPoint, sample.position);
      return dot(direction, sample.normal) < -EPS;
    });

    const arcsForDenseLoop = allowAllAngles ? arcs : arcCandidates;

    if (!allowAllAngles && !arcCandidates.length) {
      appendToDenseLoop([fallback]);
      return fallback;
    }

    let bestOpenAngle: number | null = null;
    let bestOpenRadius = -Infinity;

    for (const arc of arcsForDenseLoop) {
      const span = arc.end - arc.start;
      if (span <= EPS) {
        continue;
      }
      const approxLength = Math.max(baselineRadius, options.resolution) * span;
      const subdivisions = Math.max(2, Math.ceil(approxLength / Math.max(options.resolution, 0.02)));
      const arcPoints: Vec2[] = [];
      for (let step = 0; step < subdivisions; step += 1) {
        const t = subdivisions <= 1 ? 0 : step / (subdivisions - 1);
        const angle =
          options.orientationSign >= 0
            ? arc.start + span * t
            : arc.end - span * t;
        const radius = radiusForAngle(angle);
        if (radius > EPS) {
          arcPoints.push(toPointOnCircle(circle, angle, radius));
          if (allowAllAngles && radius > bestOpenRadius) {
            bestOpenRadius = radius;
            bestOpenAngle = angle;
          }
        }
      }
      appendToDenseLoop(arcPoints);
    }

    const availableArcs = allowAllAngles ? arcs : arcCandidates;

    let selectedArc: Arc | null = null;
    if (inwardArc) {
      const mid = wrapAngle(inwardArc.start + (inwardArc.end - inwardArc.start) / 2);
      const preview = toPointOnCircle(circle, mid, radiusForAngle(mid));
      if (allowAllAngles || dot(sub(preview, sample.position), sample.normal) < -EPS) {
        selectedArc = inwardArc;
      }
    }

    if (!selectedArc && availableArcs.length) {
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
      selectedArc = bestArc;
    }

    let chosenAngle: number | null = null;
    if (allowAllAngles && bestOpenAngle !== null && bestOpenRadius > EPS) {
      chosenAngle = bestOpenAngle;
    } else if (selectedArc) {
      chosenAngle = clampAngleToArc(inwardAngle, selectedArc);
    }

    if (chosenAngle === null) {
      appendToDenseLoop([fallback]);
      return fallback;
    }

    const candidateRadius = radiusForAngle(chosenAngle);
    if (candidateRadius <= EPS) {
      appendToDenseLoop([fallback]);
      return fallback;
    }
    const candidate = toPointOnCircle(circle, chosenAngle, candidateRadius);
    appendToDenseLoop([candidate]);
    const direction = sub(candidate, sample.position);
    if (!allowAllAngles && dot(direction, sample.normal) >= -EPS) {
      appendToDenseLoop([fallback]);
      return fallback;
    }

    return candidate;
  });

  const dense = (() => {
    if (denseLoop.length < 3) return denseLoop;
    const first = denseLoop[0];
    const last = denseLoop.at(-1)!;
    if (distance(first, last) <= Math.max(options.resolution * 0.5, 0.02)) {
      return denseLoop.slice(0, -1);
    }
    return denseLoop;
  })();

  return { candidates, denseLoop: dense };
};

const deriveInnerGeometry = (
  samples: SamplePoint[],
  closed: boolean,
  thicknessOptions: ThicknessOptions,
): { innerSamples: Vec2[]; polygons: Vec2[][] } => {
  const fallbackInner = samples.map((sample) => ({
    x: sample.position.x - sample.normal.x * sample.thickness,
    y: sample.position.y - sample.normal.y * sample.thickness,
  }));

  const defaultResolution = Math.min(0.35, thicknessOptions.uniformThickness / 6);
  const resolution = Math.max(0.035, thicknessOptions.resolution ?? defaultResolution);

  const enforceMinimumOffset = (loop: Vec2[]): Vec2[] => {
    if (loop.length !== samples.length) {
      return loop;
    }

    return loop.map((point, index) => {
      const sample = samples[index];
      const fallback = fallbackInner[index];
      const toPoint = sub(point, sample.position);
      const inwardDistance = -dot(toPoint, sample.normal);
      const minTravel = Math.max(sample.thickness, 0);
      if (!Number.isFinite(inwardDistance)) {
        return fallback;
      }
      if (inwardDistance <= 0) {
        return {
          x: sample.position.x - sample.normal.x * minTravel,
          y: sample.position.y - sample.normal.y * minTravel,
        };
      }
      if (inwardDistance + 1e-5 < minTravel) {
        const correction = minTravel - inwardDistance;
        return {
          x: point.x - sample.normal.x * correction,
          y: point.y - sample.normal.y * correction,
        };
      }
      return point;
    });
  };

  if (!closed || samples.length < 3) {
    if (samples.length === 1) {
      const center = samples[0].position;
      const segments = Math.max(160, thicknessOptions.weights.length * 16, 200);
      const loop: Vec2[] = [];
      for (let i = 0; i < segments; i += 1) {
        const theta = (i / segments) * TAU;
        const radius = Math.max(evalThicknessForAngle(theta, thicknessOptions), 0);
        loop.push({
          x: center.x + Math.cos(theta) * radius,
          y: center.y + Math.sin(theta) * radius,
        });
      }
      return { innerSamples: [{ ...center }], polygons: loop.length >= 3 ? [loop] : [] };
    }
    if (!samples.length) {
      return { innerSamples: [], polygons: [] };
    }

    const { candidates, denseLoop } = computeCircleEnvelope(
      samples,
      fallbackInner,
      {
        orientationSign: 1,
        resolution,
        restrictToInward: false,
      },
      thicknessOptions,
    );

    const smoothingIterations = Math.min(3, Math.max(1, Math.round(samples.length / 12)));
    const smoothed = laplacianSmooth(candidates, 0.38, smoothingIterations, { closed: false });
    const enforced = enforceMinimumOffset(smoothed);
    return { innerSamples: enforced, polygons: denseLoop.length >= 3 ? [denseLoop] : [] };
  }

  const outerLoop = samples.map((sample) => sample.position);
  const outerArea = polygonArea(outerLoop);
  const orientationSign = outerArea >= 0 ? 1 : -1;

  const { candidates, denseLoop } = computeCircleEnvelope(
    samples,
    fallbackInner,
    {
      orientationSign,
      resolution,
      restrictToInward: true,
    },
    thicknessOptions,
  );

  let seededLoop: Vec2[] = candidates;
  const closedDenseLoop = denseLoop;

  if (closedDenseLoop.length >= 3 && samples.length >= 3) {
    const resampled = resampleClosedPolygon(closedDenseLoop, samples.length);
    if (resampled.length === samples.length) {
      const realigned = alignLoop(resampled, fallbackInner);
      seededLoop = enforceMinimumOffset(realigned);
    }
  }

  const smoothingIterations = samples.length > 120 ? 2 : 1;
  const smoothingAlpha = samples.length > 200 ? 0.3 : 0.42;
  const smoothed = laplacianSmooth(seededLoop, smoothingAlpha, smoothingIterations, {
    closed: true,
  });
  const enforced = enforceMinimumOffset(smoothed);

  const hasSelfIntersections = (loop: Vec2[]): boolean => {
    if (loop.length < 4) {
      return false;
    }
    for (let i = 0; i < loop.length; i += 1) {
      const a1 = loop[i];
      const a2 = loop[(i + 1) % loop.length];
      for (let j = i + 2; j < loop.length; j += 1) {
        if (!closed && ((i === 0 && j === loop.length - 1) || j === i + 1)) {
          continue;
        }
        const b1 = loop[j];
        const b2 = loop[(j + 1) % loop.length];
        if (segmentsIntersect(a1, a2, b1, b2)) {
          return true;
        }
      }
    }
    return false;
  };

  const needsCleaning = hasSelfIntersections(enforced);

  let polygons: Vec2[][] = [];
  if (closedDenseLoop.length >= 3) {
    const cleaningTolerance = Math.max(resolution, 0.01);
    polygons = cleanAndSimplifyPolygons(closedDenseLoop, cleaningTolerance);
  }
  if (!polygons.length && enforced.length >= 3) {
    polygons = [enforced];
  }

  let innerSamples = enforced;

  if (needsCleaning && polygons.length) {
    const primary = polygons.reduce((largest, poly) =>
      Math.abs(polygonArea(poly)) > Math.abs(polygonArea(largest)) ? poly : largest,
    polygons[0]);
    if (primary.length >= 3) {
      const resampled = resampleClosedPolygon(primary, samples.length);
      if (resampled.length === samples.length) {
        const realigned = alignLoop(resampled, fallbackInner);
        innerSamples = enforceMinimumOffset(realigned);
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
  activeTool: 'line',
  pan: { x: 0, y: 0 },
  zoom: 1,
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
  oxidationDotCount: DEFAULT_DOT_COUNT,
  directionalLinking: true,
  bootstrapped: false,
  library,
  panelCollapse: {
    oxidation: false,
    grid: false,
  },
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
  oxidationDotCount: state.oxidationDotCount,
  zoom: state.zoom,
  pan: { ...state.pan },
  panelCollapse: { ...state.panelCollapse },
});

type PathUpdater = (nodes: PathNode[]) => PathNode[];

type WorkspaceActions = {
  setActiveTool: (tool: ToolId) => void;
  setPan: (pan: Vec2) => void;
  panBy: (delta: Vec2) => void;
  addPath: (nodes: PathNode[], overrides?: Partial<PathEntity>) => string;
  updatePath: (id: string, updater: PathUpdater) => void;
  removePath: (id: string) => void;
  setSelected: (ids: string[]) => void;
  setNodeSelection: (selection: NodeSelection | null) => void;
  translatePaths: (pathIds: string[], delta: Vec2) => void;
  deleteSelectedNodes: () => void;
  setNodeCurveMode: (pathId: string, nodeId: string, mode: 'line' | 'bezier') => void;
  updateGrid: (settings: Partial<WorkspaceState['grid']>) => void;
  updateMirror: (settings: Partial<WorkspaceState['mirror']>) => void;
  updateOxidationDefaults: (settings: Partial<OxidationSettings>) => void;
  updateSelectedOxidation: (settings: Partial<OxidationSettings>) => void;
  setDirectionalLinking: (value: boolean) => void;
  setOxidationProgress: (value: number) => void;
  setZoom: (zoom: number) => void;
  zoomBy: (delta: number) => void;
  duplicateSelectedPaths: () => void;
  setPathMeta: (id: string, patch: Partial<PathMeta>) => void;
  setHoverProbe: (probe: MeasurementProbe | null) => void;
  setPinnedProbe: (probe: MeasurementProbe | null) => void;
  setDragProbe: (probe: MeasurementProbe | null) => void;
  setMeasurementSnapping: (value: boolean) => void;
  setHeatmapVisible: (value: boolean) => void;
  pushWarning: (message: string, level?: 'info' | 'warning' | 'error') => void;
  dismissWarning: (id: string) => void;
  toggleOxidationVisible: (value: boolean) => void;
  setOxidationDotCount: (value: number) => void;
  markBootstrapped: () => void;
  setPanelCollapsed: (panel: keyof WorkspaceState['panelCollapse'], collapsed: boolean) => void;
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
  let sampled = adaptiveSamplePath(path, {
    spacing: path.oxidation.evaluationSpacing,
  });
  if (path.nodes.length === 1) {
    const node = path.nodes[0];
    sampled = {
      samples: [
        {
          position: { ...node.point },
          tangent: { x: 1, y: 0 },
          normal: { x: 0, y: -1 },
          thickness: 0,
          curvature: 0,
          parameter: 0,
        },
      ],
      length: 0,
    };
  }
  const normals = recomputeNormals(sampled.samples);
  const thicknessOptions: ThicknessOptions = {
    uniformThickness: path.oxidation.thicknessUniformUm,
    weights: path.oxidation.thicknessByDirection.items,
    mirrorSymmetry: path.oxidation.mirrorSymmetry,
    progress,
  };
  const withThickness = evalThickness(normals, thicknessOptions);

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

const applyGlobalOxidation = (
  state: WorkspaceState,
  settings: Partial<OxidationSettings>,
): WorkspaceState => {
  const merged = mergeOxidationSettings(state.oxidationDefaults, settings);
  const now = Date.now();
  const nextPaths = state.paths.map((path) =>
    runGeometryPipeline(
      {
        ...path,
        oxidation: cloneOxidationSettings(merged),
        meta: { ...path.meta, updatedAt: now },
      },
      state.oxidationProgress,
    ),
  );
  return {
    ...state,
    oxidationDefaults: merged,
    paths: nextPaths,
    dirty: true,
    future: [],
  };
};

const initialLibrary = loadLibrary();

export const useWorkspaceStore = create<WorkspaceStore>((set, get) => ({
  ...createEmptyState(initialLibrary),
  setActiveTool: (tool) => set({ activeTool: tool }),
  setPan: (pan) => set((state) => ({ ...state, pan })),
  panBy: (delta) =>
    set((state) => ({
      ...state,
      pan: { x: state.pan.x + delta.x, y: state.pan.y + delta.y },
    })),
  setZoom: (zoom) => set((state) => ({ ...state, zoom: clampZoom(zoom) })),
  zoomBy: (delta) =>
    set((state) => ({
      ...state,
      zoom: clampZoom(state.zoom * delta),
    })),
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
  translatePaths: (pathIds, delta) =>
    set((state) => {
      if (!pathIds.length) return state;
      if (Math.abs(delta.x) < 1e-6 && Math.abs(delta.y) < 1e-6) return state;
      const ids = new Set(pathIds);
      let moved = false;
      const history = [...state.history, captureSnapshot(state)].slice(-50);
      const shiftHandle = (handle: Vec2 | null | undefined): Vec2 | null | undefined => {
        if (handle === null || handle === undefined) return handle;
        return { x: handle.x + delta.x, y: handle.y + delta.y };
      };
      const nextPaths = state.paths.map((path) => {
        if (!ids.has(path.meta.id) || path.meta.locked) {
          return path;
        }
        moved = true;
        const movedNodes = path.nodes.map((node) => ({
          ...node,
          point: { x: node.point.x + delta.x, y: node.point.y + delta.y },
          handleIn: shiftHandle(node.handleIn),
          handleOut: shiftHandle(node.handleOut),
        }));
        return runGeometryPipeline(
          {
            ...path,
            nodes: movedNodes,
            meta: { ...path.meta, updatedAt: Date.now() },
          },
          state.oxidationProgress,
        );
      });
      if (!moved) {
        return state;
      }
      return {
        ...state,
        paths: nextPaths,
        history,
        future: [],
        dirty: true,
      };
    }),
  duplicateSelectedPaths: () =>
    set((state) => {
      if (!state.selectedPathIds.length) return state;
      const history = [...state.history, captureSnapshot(state)].slice(-50);
      const selected = new Set(state.selectedPathIds);
      const now = Date.now();
      const newPaths: PathEntity[] = [];
      const newSelection: string[] = [];
      state.paths.forEach((path) => {
        if (!selected.has(path.meta.id)) return;
        const newId = createId('path');
        const cloneHandle = (handle: Vec2 | null | undefined): Vec2 | null | undefined => {
          if (handle === null || handle === undefined) return handle;
          return { ...handle };
        };
        const clonedNodes = path.nodes.map((node) => ({
          ...node,
          id: createId('node'),
          point: { ...node.point },
          handleIn: cloneHandle(node.handleIn),
          handleOut: cloneHandle(node.handleOut),
        }));
        const meta: PathMeta = {
          ...path.meta,
          id: newId,
          name: `${path.meta.name} copy`,
          createdAt: now,
          updatedAt: now,
        };
        const duplicated = runGeometryPipeline(
          {
            meta,
            nodes: clonedNodes,
            oxidation: cloneOxidationSettings(path.oxidation),
            sampled: undefined,
          },
          state.oxidationProgress,
        );
        newPaths.push(duplicated);
        newSelection.push(newId);
      });
      if (!newPaths.length) {
        return state;
      }
      return {
        ...state,
        paths: [...state.paths, ...newPaths],
        selectedPathIds: newSelection,
        nodeSelection: null,
        history,
        future: [],
        dirty: true,
      };
    }),
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
    set((state) => {
      const history = [...state.history, captureSnapshot(state)].slice(-50);
      const updated = applyGlobalOxidation(state, settings);
      return { ...updated, history };
    }),
  updateSelectedOxidation: (settings) =>
    set((state) => {
      const history = [...state.history, captureSnapshot(state)].slice(-50);
      const updated = applyGlobalOxidation(state, settings);
      return { ...updated, history };
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
  setOxidationDotCount: (value) => set({ oxidationDotCount: clampDotCount(value) }),
  markBootstrapped: () => set({ bootstrapped: true }),
  setPanelCollapsed: (panel, collapsed) =>
    set((state) => ({
      panelCollapse: { ...state.panelCollapse, [panel]: collapsed },
    })),
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
      oxidationDotCount: DEFAULT_DOT_COUNT,
      pan: { x: 0, y: 0 },
      panelCollapse: { oxidation: false, grid: false },
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
        oxidationDotCount: previous.oxidationDotCount,
        zoom: previous.zoom,
        pan: { ...previous.pan },
        panelCollapse: { ...previous.panelCollapse },
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
        oxidationDotCount: snapshot.oxidationDotCount,
        zoom: snapshot.zoom,
        pan: { ...snapshot.pan },
        panelCollapse: { ...snapshot.panelCollapse },
      };
    });
  },
  importState: (payload) =>
    set((state) => ({
      ...createEmptyState(state.library.map(cloneStoredShape)),
      ...payload,
      oxidationVisible: payload.oxidationVisible ?? true,
      oxidationProgress: payload.oxidationProgress ?? 1,
      oxidationDotCount: clampDotCount(payload.oxidationDotCount ?? DEFAULT_DOT_COUNT),
      directionalLinking: payload.directionalLinking ?? true,
      bootstrapped: payload.bootstrapped ?? true,
      library: state.library.map(cloneStoredShape),
      history: [],
      future: [],
      dirty: false,
      zoom: clampZoom(payload.zoom ?? 1),
      pan: payload.pan ?? { x: 0, y: 0 },
      panelCollapse: payload.panelCollapse ?? { oxidation: false, grid: false },
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
