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
  samplePathWithUniformSubdivisions,
} from '../geometry';
import { laplacianSmooth } from '../geometry/smoothing';
import { alignLoop, clamp, distance, dot, sub } from '../utils/math';

const LIBRARY_STORAGE_KEY = 'visoxid:shape-library';

const MAX_THICKNESS_UM = 10;
const MIRROR_SNAP_THRESHOLD = 1.5;
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 8;

const clampThickness = (value: number): number => clamp(value, 0, MAX_THICKNESS_UM);
const clampZoom = (value: number): number => clamp(value, MIN_ZOOM, MAX_ZOOM);

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
const OPEN_SEGMENT_SUBDIVISIONS = 300;

const sampleCompassPatch = (
  center: Vec2,
  options: ThicknessOptions,
  resolution: number,
): Vec2[] => {
  const segments = Math.max(160, options.weights.length * 16, 200);
  const points: Vec2[] = [];
  const minSpacing = Math.max(resolution * 0.5, 0.002);
  let previous: Vec2 | null = null;
  for (let i = 0; i < segments; i += 1) {
    const theta = (i / segments) * TAU;
    const radius = Math.max(evalThicknessForAngle(theta, options), 0);
    if (radius <= EPS) continue;
    const candidate: Vec2 = {
      x: center.x + Math.cos(theta) * radius,
      y: center.y + Math.sin(theta) * radius,
    };
    if (!previous || distance(previous, candidate) >= minSpacing) {
      points.push(candidate);
      previous = candidate;
    }
  }
  if (points.length >= 3) {
    const first = points[0];
    const last = points.at(-1)!;
    if (distance(first, last) < minSpacing) {
      points.pop();
    }
  }
  return points;
};

type Arc = { start: number; end: number };

interface Circle {
  center: Vec2;
  radius: number;
  normal: Vec2;
}

interface CircleEnvelopeContext {
  circles: Circle[];
  inwardAngles: number[];
  radiusForAngle: (angle: number) => number;
}

const prepareCircleEnvelope = (
  samples: SamplePoint[],
  thicknessOptions: ThicknessOptions,
): CircleEnvelopeContext => {
  const inwardAngles: number[] = [];
  const radiusForAngle = (angle: number): number =>
    Math.max(evalThicknessForAngle(wrapAngle(angle), thicknessOptions), 0);
  const circles = samples.map((sample) => {
    const inwardAngle = wrapAngle(Math.atan2(-sample.normal.y, -sample.normal.x));
    inwardAngles.push(inwardAngle);
    const baselineRadius = radiusForAngle(inwardAngle);
    return {
      center: sample.position,
      radius: baselineRadius,
      normal: sample.normal,
    };
  });
  return { circles, inwardAngles, radiusForAngle };
};

const wrapAngle = (angle: number): number => {
  let wrapped = angle % TAU;
  if (wrapped < 0) {
    wrapped += TAU;
  }
  return wrapped;
};

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

const computeCircleTangents = (a: Circle, b: Circle): { a: Vec2; b: Vec2 }[] => {
  const result: { a: Vec2; b: Vec2 }[] = [];
  const dx = b.center.x - a.center.x;
  const dy = b.center.y - a.center.y;
  const d2 = dx * dx + dy * dy;
  if (d2 <= EPS * EPS) {
    return result;
  }

  const resolveTangents = (inner: boolean): void => {
    const r1 = a.radius;
    let r2 = b.radius;
    if (inner) {
      r2 = -r2;
    }
    const dr = r1 - r2;
    const h2 = d2 - dr * dr;
    if (h2 < -EPS) {
      return;
    }
    const h = Math.sqrt(Math.max(0, h2));
    for (const sign of [-1, 1]) {
      const vx = (dx * dr - dy * h * sign) / d2;
      const vy = (dy * dr + dx * h * sign) / d2;
      result.push({
        a: {
          x: a.center.x + vx * r1,
          y: a.center.y + vy * r1,
        },
        b: {
          x: b.center.x + vx * r2,
          y: b.center.y + vy * r2,
        },
      });
    }
  };

  resolveTangents(false);
  return result;
};

const inwardDistanceAlongNormal = (sample: SamplePoint, point: Vec2): number =>
  -dot(sub(point, sample.position), sample.normal);

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
  allowCrossSegmentOcclusion: boolean;
}

const computeCircleEnvelope = (
  samples: SamplePoint[],
  fallbackInner: Vec2[],
  options: EnvelopeOptions,
  thicknessOptions: ThicknessOptions,
  context?: CircleEnvelopeContext,
): { candidates: Vec2[]; denseLoop: Vec2[]; profiles: Vec2[][] } => {
  const { circles, inwardAngles, radiusForAngle } =
    context ?? prepareCircleEnvelope(samples, thicknessOptions);

  const denseLoop: Vec2[] = [];
  const profiles: Vec2[][] = samples.map(() => []);

  const appendToDenseLoop = (points: Vec2[]): void => {
    for (const point of points) {
      const last = denseLoop.at(-1);
      if (!last || distance(last, point) > Math.max(options.resolution * 0.25, 0.001)) {
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
      if (!options.allowCrossSegmentOcclusion) {
        const segment = sample.segmentIndex;
        const otherSegment = samples[j]?.segmentIndex;
        if (
          segment !== undefined &&
          otherSegment !== undefined &&
          otherSegment !== segment
        ) {
          continue;
        }
      }
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

    const profilePoints = profiles[index];
    const arcsForProfile = arcs.length ? arcs : [{ start: 0, end: TAU }];
    const profileSegments = Math.max(96, thicknessOptions.weights.length * 24, 120);
    const profileSpacing = Math.max(options.resolution * 0.25, 0.0005);
    let previousProfilePoint: Vec2 | null = null;
    for (let step = 0; step < profileSegments; step += 1) {
      const angle = wrapAngle((step / profileSegments) * TAU);
      if (
        arcsForProfile.length &&
        !arcsForProfile.some((arc) => angleInArc(angle, arc))
      ) {
        continue;
      }
      const radius = radiusForAngle(angle);
      if (radius <= EPS) {
        continue;
      }
      const point = toPointOnCircle(circle, angle, radius);
      if (!allowAllAngles) {
        const direction = sub(point, sample.position);
        if (dot(direction, sample.normal) >= -EPS) {
          continue;
        }
      }
      if (
        !previousProfilePoint ||
        distance(previousProfilePoint, point) > profileSpacing
      ) {
        profilePoints.push(point);
        previousProfilePoint = point;
      }
    }
    if (profilePoints.length) {
      appendToDenseLoop(profilePoints);
    }

    const arcCandidates = arcs.filter((arc) => {
      const mid = wrapAngle(arc.start + (arc.end - arc.start) / 2);
      const radius = radiusForAngle(mid);
      if (radius <= EPS) return false;
      if (allowAllAngles) return true;
      const midPoint = toPointOnCircle(circle, mid, radius);
      const direction = sub(midPoint, sample.position);
      return dot(direction, sample.normal) < -EPS;
    });

    const availableArcs = arcCandidates.length ? arcCandidates : arcs;

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

    const seenArcs = new Set<string>();
    const arcKey = (arc: Arc): string => `${arc.start.toFixed(6)}:${arc.end.toFixed(6)}`;
    const markSeen = (arc: Arc): void => {
      seenArcs.add(arcKey(arc));
    };
    const isSeen = (arc: Arc): boolean => seenArcs.has(arcKey(arc));

    const queue: Arc[] = [];
    if (selectedArc) {
      queue.push(selectedArc);
    }
    for (const arc of availableArcs) {
      if (selectedArc && Math.abs(arc.start - selectedArc.start) <= 1e-6 && Math.abs(arc.end - selectedArc.end) <= 1e-6) {
        continue;
      }
      queue.push(arc);
    }
    if (!queue.length) {
      queue.push(...arcs);
    }

    let bestCandidate: { angle: number; point: Vec2; distance: number } | null = null;

    const evaluateArc = (arc: Arc): void => {
      if (isSeen(arc)) return;
      markSeen(arc);
      const span = arc.end - arc.start;
      if (span <= EPS) {
        return;
      }
      const stepBase = Math.max(options.resolution * 0.5, 0.0005);
      const radiusStart = radiusForAngle(arc.start);
      const radiusEnd = radiusForAngle(arc.end);
      const approxRadius = Math.max(baselineRadius, radiusStart, radiusEnd);
      const approxLength = Math.max(approxRadius * span, stepBase);
      const subdivisions = Math.max(24, Math.ceil(approxLength / stepBase));
      const arcPoints: Vec2[] = [];
      for (let step = 0; step <= subdivisions; step += 1) {
        const t = subdivisions <= 0 ? 0 : step / subdivisions;
        const rawAngle =
          options.orientationSign >= 0
            ? arc.start + span * t
            : arc.end - span * t;
        const angle = wrapAngle(rawAngle);
        const radius = radiusForAngle(angle);
        if (radius <= EPS) {
          continue;
        }
        const point = toPointOnCircle(circle, angle, radius);
        arcPoints.push(point);
        const travel = inwardDistanceAlongNormal(sample, point);
        if (!Number.isFinite(travel) || travel <= 0) {
          continue;
        }
        if (!bestCandidate || travel > bestCandidate.distance + 1e-5) {
          bestCandidate = { angle, point, distance: travel };
        }
      }
      if (arcPoints.length) {
        appendToDenseLoop(arcPoints);
      }
    };

    for (const arc of queue) {
      evaluateArc(arc);
    }

    if (!bestCandidate) {
      for (const arc of arcs) {
        evaluateArc(arc);
      }
    }

    if (!bestCandidate) {
      appendToDenseLoop([fallback]);
      return fallback;
    }

    appendToDenseLoop([bestCandidate.point]);
    return bestCandidate.point;
  });

  const dense = (() => {
    if (denseLoop.length < 3) return denseLoop;
    const first = denseLoop[0];
    const last = denseLoop.at(-1)!;
    if (distance(first, last) <= Math.max(options.resolution * 0.5, 0.002)) {
      return denseLoop.slice(0, -1);
    }
    return denseLoop;
  })();

  return { candidates, denseLoop: dense, profiles };
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
  const resolution = Math.max(0.0035, thicknessOptions.resolution ?? defaultResolution);

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
      const loop = sampleCompassPatch(center, thicknessOptions, resolution);
      return { innerSamples: [{ ...center }], polygons: loop.length >= 3 ? [loop] : [] };
    }
    if (!samples.length) {
      return { innerSamples: [], polygons: [] };
    }

    const context = prepareCircleEnvelope(samples, thicknessOptions);
    const { candidates, profiles } = computeCircleEnvelope(
      samples,
      fallbackInner,
      {
        orientationSign: 1,
        resolution,
        restrictToInward: false,
        allowCrossSegmentOcclusion: false,
      },
      thicknessOptions,
      context,
    );

    const bestPoints = candidates.map((candidate, index) => {
      const base = candidate ?? fallbackInner[index];
      return { x: base.x, y: base.y };
    });
    const bestDistances = bestPoints.map((point, index) => {
      const distance = inwardDistanceAlongNormal(samples[index], point);
      if (!Number.isFinite(distance) || distance <= 0) {
        return 0;
      }
      return distance;
    });

    const tryUpdate = (index: number, point: Vec2): void => {
      const inward = inwardDistanceAlongNormal(samples[index], point);
      if (!Number.isFinite(inward) || inward <= 0) {
        return;
      }
      if (inward > bestDistances[index] + 1e-5) {
        bestDistances[index] = inward;
        bestPoints[index] = { x: point.x, y: point.y };
      }
    };

    if (profiles.length === samples.length) {
      profiles.forEach((anchors, index) => {
        for (const point of anchors) {
          tryUpdate(index, point);
        }
      });
    }

    const projectTangent = (
      index: number,
      circle: Circle,
      sample: SamplePoint,
      tangentPoint: Vec2,
    ): void => {
      const angle = Math.atan2(tangentPoint.y - circle.center.y, tangentPoint.x - circle.center.x);
      const radius = context.radiusForAngle(angle);
      if (radius <= EPS) {
        return;
      }
      const refined = toPointOnCircle(circle, angle, radius);
      if (dot(sub(refined, sample.position), sample.normal) < -EPS) {
        tryUpdate(index, refined);
      }
    };

    let start = 0;
    while (start < samples.length) {
      const segmentIndex = samples[start].segmentIndex;
      if (segmentIndex === undefined) {
        start += 1;
        continue;
      }
      let end = start + 1;
      while (end < samples.length && samples[end].segmentIndex === segmentIndex) {
        end += 1;
      }

      for (let i = start; i < end; i += 1) {
        for (let j = i + 1; j < end; j += 1) {
          const circleA = context.circles[i];
          const circleB = context.circles[j];
          if (!circleA || !circleB) {
            continue;
          }
          const tangents = computeCircleTangents(circleA, circleB);
          for (const tangent of tangents) {
            projectTangent(i, circleA, samples[i], tangent.a);
            projectTangent(j, circleB, samples[j], tangent.b);
          }
        }
      }

      start = end;
    }

    const enforced = enforceMinimumOffset(bestPoints);
    const endpointPolygons = [samples[0], samples.at(-1)!]
      .map((sample) => sampleCompassPatch(sample.position, thicknessOptions, resolution))
      .filter((loop) => loop.length >= 3);
    return { innerSamples: enforced, polygons: endpointPolygons };
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
      allowCrossSegmentOcclusion: true,
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
  zoom: 1,
  pan: { x: 0, y: 0 },
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
  zoom: state.zoom,
  pan: { ...state.pan },
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
  setZoom: (zoom: number) => void;
  zoomBy: (delta: number) => void;
  setPan: (pan: Vec2) => void;
  panBy: (delta: Vec2) => void;
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
  let sampled = path.meta.closed
    ? adaptiveSamplePath(path, {
        spacing: path.oxidation.evaluationSpacing,
      })
    : samplePathWithUniformSubdivisions(path, OPEN_SEGMENT_SUBDIVISIONS);
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
          segmentIndex: 0,
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
  setZoom: (zoom) => set((state) => ({ ...state, zoom: clampZoom(zoom) })),
  zoomBy: (delta) =>
    set((state) => ({
      ...state,
      zoom: clampZoom(state.zoom * delta),
    })),
  setPan: (pan) =>
    set((state) => ({
      ...state,
      pan: { x: pan.x, y: pan.y },
    })),
  panBy: (delta) =>
    set((state) => ({
      ...state,
      pan: { x: state.pan.x + delta.x, y: state.pan.y + delta.y },
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
      const snapped = applyMirrorSnapping(clonedNodes, mirror);
      const finalMeta = { ...meta };
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
      const snapped = applyMirrorSnapping(nodes, mirror);
      const updated = runGeometryPipeline(
        {
          ...target,
          nodes: snapped,
          meta: {
            ...target.meta,
            closed: target.meta.closed,
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
      const snapped = applyMirrorSnapping(remainingNodes, state.mirror);
      const finalClosed = path.meta.closed && snapped.length >= 3;
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
      const snapped = applyMirrorSnapping(nodes, mirror);
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
        zoom: previous.zoom,
        pan: { ...previous.pan },
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
        zoom: snapshot.zoom,
        pan: { ...snapshot.pan },
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
      zoom: clampZoom(payload.zoom ?? 1),
      pan: payload.pan ? { ...payload.pan } : { x: 0, y: 0 },
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
      const snapped = applyMirrorSnapping(nodes, mirror);
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
