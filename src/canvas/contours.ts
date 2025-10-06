import type { DirectionWeight, MirrorSettings, PathEntity, SamplePoint, Vec2 } from '../types';
import { evalThicknessForAngle } from '../geometry';
import { distance } from '../utils/math';
import { worldToCanvas, type ViewTransform } from './viewTransform';

const moveToPoint = (ctx: CanvasRenderingContext2D, x: number, y: number) => {
  ctx.beginPath();
  ctx.moveTo(x, y);
};

const strokePolyline = (
  ctx: CanvasRenderingContext2D,
  points: Array<{ x: number; y: number }>,
  closed: boolean,
) => {
  if (!points.length) return;
  moveToPoint(ctx, points[0].x, points[0].y);
  for (let i = 1; i < points.length; i += 1) {
    ctx.lineTo(points[i].x, points[i].y);
  }
  if (closed && points.length > 2) {
    ctx.closePath();
  }
  ctx.stroke();
};

const createMirrorTransforms = (mirror?: MirrorSettings): Array<((point: Vec2) => Vec2)> => {
  if (!mirror?.enabled) return [];
  const transforms: Array<((point: Vec2) => Vec2)> = [];
  const { axis, origin } = mirror;

  if (axis === 'y' || axis === 'xy') {
    transforms.push((point) => ({
      x: origin.x - (point.x - origin.x),
      y: point.y,
    }));
  }
  if (axis === 'x' || axis === 'xy') {
    transforms.push((point) => ({
      x: point.x,
      y: origin.y - (point.y - origin.y),
    }));
  }
  if (axis === 'xy') {
    transforms.push((point) => ({
      x: origin.x - (point.x - origin.x),
      y: origin.y - (point.y - origin.y),
    }));
  }

  return transforms;
};

export const drawContours = (
  ctx: CanvasRenderingContext2D,
  path: PathEntity,
  selected: boolean,
  view: ViewTransform,
  mirror?: MirrorSettings,
): void => {
  const outerWorld =
    path.sampled?.samples?.map((sample) => sample.position) ??
    path.nodes.map((node) => node.point);

  if (!outerWorld.length) {
    return;
  }

  const isReference = path.meta.kind === 'reference';
  const strokeColor = selected
    ? '#2563eb'
    : isReference
      ? '#94a3b8'
      : path.meta.color;

  const drawVariant = (points: Vec2[], emphasize: boolean) => {
    if (!points.length) return;
    const screenPoints = points.map((point) => worldToCanvas(point, view));
    if (!screenPoints.length) return;
    ctx.save();
    ctx.globalAlpha = emphasize ? 1 : isReference ? 0.35 : 0.45;
    ctx.lineWidth = isReference ? 1.5 : 1.8;
    ctx.strokeStyle = strokeColor;
    ctx.setLineDash([]);
    strokePolyline(ctx, screenPoints, path.meta.closed);
    ctx.restore();
  };

  const transforms = createMirrorTransforms(mirror);
  transforms.forEach((transform) => {
    const variant = outerWorld.map(transform);
    if (variant.length) {
      drawVariant(variant, false);
    }
  });

  drawVariant(outerWorld, true);
};

const TAU = Math.PI * 2;
const DOT_POLYGON_MIN_SEGMENTS = 96;
const LENGTH_EPS = 1e-6;

const computeDotPolygon = (options: {
  uniformThickness: number;
  weights: DirectionWeight[];
  mirrorSymmetry: boolean;
  progress: number;
}): Vec2[] => {
  const segments = Math.max(DOT_POLYGON_MIN_SEGMENTS, options.weights.length * 16);
  const polygon: Vec2[] = [];
  let maxRadius = 0;
  for (let i = 0; i < segments; i += 1) {
    const theta = (i / segments) * TAU;
    const radius = Math.max(evalThicknessForAngle(theta, options), 0);
    maxRadius = Math.max(maxRadius, radius);
    polygon.push({
      x: Math.cos(theta) * radius,
      y: Math.sin(theta) * radius,
    });
  }
  if (maxRadius <= LENGTH_EPS) {
    return [];
  }
  return polygon;
};

const collectDotCenters = (
  samples: SamplePoint[],
  closed: boolean,
  requestedCount: number,
): Vec2[] => {
  if (!samples.length) return [];
  if (samples.length === 1) {
    return [samples[0].position];
  }

  const count = Math.max(0, Math.floor(requestedCount));
  if (count === 0) {
    return [];
  }

  const positions = samples.map((sample) => sample.position);
  const segments: Array<{ start: Vec2; end: Vec2; length: number }> = [];
  for (let i = 1; i < positions.length; i += 1) {
    const start = positions[i - 1];
    const end = positions[i];
    const length = distance(start, end);
    if (length > LENGTH_EPS) {
      segments.push({ start, end, length });
    }
  }
  if (closed && positions.length > 1) {
    const start = positions[positions.length - 1];
    const end = positions[0];
    const length = distance(start, end);
    if (length > LENGTH_EPS) {
      segments.push({ start, end, length });
    }
  }

  const totalLength = segments.reduce((sum, segment) => sum + segment.length, 0);
  if (totalLength <= LENGTH_EPS) {
    return [positions[0]];
  }

  const targets: number[] = [];
  if (closed) {
    const step = totalLength / count;
    for (let i = 0; i < count; i += 1) {
      targets.push(step * i);
    }
  } else if (count === 1) {
    targets.push(0);
  } else {
    const step = totalLength / (count - 1);
    for (let i = 0; i < count; i += 1) {
      targets.push(step * i);
    }
  }

  const centers: Vec2[] = [];
  targets.forEach((target) => {
    let remaining = target;
    for (let i = 0; i < segments.length; i += 1) {
      const segment = segments[i];
      if (remaining <= segment.length || i === segments.length - 1) {
        const length = segment.length <= LENGTH_EPS ? 0 : segment.length;
        const t = length <= LENGTH_EPS ? 0 : Math.min(Math.max(remaining / length, 0), 1);
        centers.push({
          x: segment.start.x + (segment.end.x - segment.start.x) * t,
          y: segment.start.y + (segment.end.y - segment.start.y) * t,
        });
        break;
      }
      remaining -= segment.length;
    }
  });

  return centers;
};

const translatePolygon = (polygon: Vec2[], center: Vec2): Vec2[] =>
  polygon.map((offset) => ({ x: center.x + offset.x, y: center.y + offset.y }));

export const drawOxidationDots = (
  ctx: CanvasRenderingContext2D,
  path: PathEntity,
  selected: boolean,
  dotCount: number,
  progress: number,
  view: ViewTransform,
  mirror: MirrorSettings | undefined,
  visible: boolean,
): void => {
  if (!visible || path.meta.kind === 'reference') return;
  const samples = path.sampled?.samples;
  if (!samples?.length) return;

  const centers = collectDotCenters(samples, path.meta.closed, dotCount);
  if (!centers.length) return;

  const thicknessOptions = {
    uniformThickness: path.oxidation.thicknessUniformUm,
    weights: path.oxidation.thicknessByDirection.items,
    mirrorSymmetry: path.oxidation.mirrorSymmetry,
    progress,
  };

  const dotPolygon = computeDotPolygon(thicknessOptions);
  if (dotPolygon.length < 3) return;

  const transforms = createMirrorTransforms(mirror);

  const drawWorldPolygon = (points: Vec2[]) => {
    const screenPoints = points.map((point) => worldToCanvas(point, view));
    if (screenPoints.length < 3) return;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(screenPoints[0].x, screenPoints[0].y);
    for (let i = 1; i < screenPoints.length; i += 1) {
      ctx.lineTo(screenPoints[i].x, screenPoints[i].y);
    }
    ctx.closePath();
    ctx.fillStyle = path.meta.color;
    ctx.strokeStyle = path.meta.color;
    ctx.globalAlpha = selected ? 0.55 : 0.4;
    ctx.fill();
    ctx.globalAlpha = selected ? 0.9 : 0.7;
    ctx.lineWidth = 0.6;
    ctx.stroke();
    ctx.restore();
  };

  centers.forEach((center) => {
    const basePolygon = translatePolygon(dotPolygon, center);
    drawWorldPolygon(basePolygon);
    transforms.forEach((transform) => {
      drawWorldPolygon(basePolygon.map(transform));
    });
  });
};
