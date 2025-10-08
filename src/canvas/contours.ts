import type { DirectionWeight, MirrorSettings, PathEntity, SamplePoint, Vec2 } from '../types';
import { evalThicknessForAngle } from '../geometry';
import { directionalValueToColor } from '../utils/directionalColor';
import { distance, lerp, normalize } from '../utils/math';
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

interface DotCenter {
  position: Vec2;
  angle: number;
}

const collectDotCenters = (
  samples: SamplePoint[],
  closed: boolean,
  requestedCount: number,
): DotCenter[] => {
  if (!samples.length) return [];
  if (samples.length === 1) {
    const normal = normalize(samples[0].normal);
    return [
      {
        position: samples[0].position,
        angle: Math.atan2(normal.y, normal.x),
      },
    ];
  }

  const count = Math.max(0, Math.floor(requestedCount));
  if (count === 0) {
    return [];
  }

  const segments: Array<{
    start: SamplePoint;
    end: SamplePoint;
    length: number;
  }> = [];
  for (let i = 1; i < samples.length; i += 1) {
    const start = samples[i - 1];
    const end = samples[i];
    const length = distance(start.position, end.position);
    if (length > LENGTH_EPS) {
      segments.push({ start, end, length });
    }
  }
  if (closed && samples.length > 1) {
    const start = samples[samples.length - 1];
    const end = samples[0];
    const length = distance(start.position, end.position);
    if (length > LENGTH_EPS) {
      segments.push({ start, end, length });
    }
  }

  const totalLength = segments.reduce((sum, segment) => sum + segment.length, 0);
  if (totalLength <= LENGTH_EPS) {
    const normal = normalize(samples[0].normal);
    return [
      {
        position: samples[0].position,
        angle: Math.atan2(normal.y, normal.x),
      },
    ];
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

  const centers: DotCenter[] = [];
  targets.forEach((target) => {
    let remaining = target;
    for (let i = 0; i < segments.length; i += 1) {
      const segment = segments[i];
      if (remaining <= segment.length || i === segments.length - 1) {
        const length = segment.length <= LENGTH_EPS ? 0 : segment.length;
        const t = length <= LENGTH_EPS ? 0 : Math.min(Math.max(remaining / length, 0), 1);
        const position = {
          x: segment.start.position.x + (segment.end.position.x - segment.start.position.x) * t,
          y: segment.start.position.y + (segment.end.position.y - segment.start.position.y) * t,
        };
        const interpolatedNormal = normalize(
          lerp(segment.start.normal, segment.end.normal, t),
        );
        centers.push({
          position,
          angle: Math.atan2(interpolatedNormal.y, interpolatedNormal.x),
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

  const directionalColorOptions = {
    uniformThickness: 0,
    weights: thicknessOptions.weights,
    mirrorSymmetry: thicknessOptions.mirrorSymmetry,
    progress: 1,
  } as const;

  const dotPolygon = computeDotPolygon(thicknessOptions);
  if (dotPolygon.length < 3) return;

  const transforms = createMirrorTransforms(mirror);
  const direction = path.meta.oxidationDirection ?? 'inward';

  const drawWorldPolygon = (points: Vec2[], color: string, clipScreen?: Vec2[]) => {
    const screenPoints = points.map((point) => worldToCanvas(point, view));
    if (screenPoints.length < 3) return;
    ctx.save();
    if (clipScreen && clipScreen.length >= 3) {
      ctx.beginPath();
      if (direction === 'outward') {
        const matrix = ctx.getTransform();
        const scaleX = matrix.a || 1;
        const scaleY = matrix.d || 1;
        const width = ctx.canvas.width / scaleX;
        const height = ctx.canvas.height / scaleY;
        const pad = Math.max(width, height);
        ctx.rect(-pad, -pad, width + pad * 2, height + pad * 2);
      }
      ctx.moveTo(clipScreen[0].x, clipScreen[0].y);
      for (let i = 1; i < clipScreen.length; i += 1) {
        ctx.lineTo(clipScreen[i].x, clipScreen[i].y);
      }
      ctx.closePath();
      ctx.clip(direction === 'outward' ? 'evenodd' : 'nonzero');
    }
    ctx.beginPath();
    ctx.moveTo(screenPoints[0].x, screenPoints[0].y);
    for (let i = 1; i < screenPoints.length; i += 1) {
      ctx.lineTo(screenPoints[i].x, screenPoints[i].y);
    }
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    ctx.globalAlpha = selected ? 0.55 : 0.4;
    ctx.fill();
    ctx.globalAlpha = selected ? 0.9 : 0.7;
    ctx.lineWidth = 0.6;
    ctx.stroke();
    ctx.restore();
  };

  const clipWorld = path.meta.closed
    ? path.sampled?.samples?.map((sample) => sample.position) ??
      path.nodes.map((node) => node.point)
    : undefined;
  let baseClipScreen: Vec2[] | undefined;
  let mirrorClipScreens: Vec2[][] = [];
  if (clipWorld && clipWorld.length >= 3) {
    baseClipScreen = clipWorld.map((point) => worldToCanvas(point, view));
    mirrorClipScreens = transforms.map((transform) =>
      clipWorld.map((point) => worldToCanvas(transform(point), view)),
    );
  }

  const variants: Array<{
    apply: (points: Vec2[]) => Vec2[];
    clipScreen?: Vec2[];
  }> = [
    {
      apply: (points) => points,
      clipScreen: baseClipScreen,
    },
    ...transforms.map((transform, index) => ({
      apply: (points: Vec2[]) => points.map(transform),
      clipScreen: mirrorClipScreens[index],
    })),
  ];

  centers.forEach((center) => {
    const basePolygon = translatePolygon(dotPolygon, center.position);
    const directionalThickness = thicknessOptions.weights.length
      ? evalThicknessForAngle(center.angle, directionalColorOptions)
      : 0;
    const color = directionalValueToColor(directionalThickness);
    variants.forEach((variant) => {
      const polygon = variant.apply(basePolygon);
      drawWorldPolygon(polygon, color, variant.clipScreen);
    });
  });
};
