import type { MirrorSettings, PathEntity, Vec2 } from '../types';
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

const fillPolygon = (
  ctx: CanvasRenderingContext2D,
  points: Array<{ x: number; y: number }>,
  fillStyle: string,
) => {
  if (points.length < 3) return;
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i += 1) {
    ctx.lineTo(points[i].x, points[i].y);
  }
  ctx.closePath();
  ctx.fillStyle = fillStyle;
  ctx.fill();
};

export const drawContours = (
  ctx: CanvasRenderingContext2D,
  path: PathEntity,
  selected: boolean,
  showOxide: boolean,
  view: ViewTransform,
  mirror?: MirrorSettings,
): void => {
  const samples =
    path.sampled?.samples ??
    path.nodes.map((node) => ({
      position: node.point,
      thickness: 0,
      normal: { x: 0, y: -1 },
    }));
  if (!samples.length) return;
  const strokeColor = selected ? '#2563eb' : path.meta.color;
  const outerWorld = path.sampled?.samples.map((sample) => sample.position) ?? [];
  const fallbackInner = path.sampled?.samples.map((sample) => ({
    x: sample.position.x - sample.normal.x * sample.thickness,
    y: sample.position.y - sample.normal.y * sample.thickness,
  }));
  const innerWorld =
    path.sampled?.innerSamples && path.sampled.innerSamples.length === outerWorld.length
      ? path.sampled.innerSamples
      : fallbackInner ?? [];
  const drawVariant = (outer: Vec2[], inner: Vec2[], emphasize: boolean) => {
    const outerScreen = outer.map((pt) => worldToCanvas(pt, view));
    const innerScreen = inner.map((pt) => worldToCanvas(pt, view));
    ctx.save();
    ctx.globalAlpha = emphasize ? 1 : 0.45;
    ctx.lineWidth = 1.8;
    ctx.strokeStyle = strokeColor;
    ctx.setLineDash([]);
    strokePolyline(ctx, outerScreen, path.meta.closed);
    if (showOxide && outerScreen.length > 1 && innerScreen.length === outerScreen.length) {
      ctx.lineWidth = 1;
      ctx.strokeStyle = emphasize ? 'rgba(37, 99, 235, 0.7)' : 'rgba(37, 99, 235, 0.35)';
      strokePolyline(ctx, innerScreen, path.meta.closed);
    }
    ctx.restore();
  };

  const innerPolygons = path.sampled?.innerPolygons ?? [];
  if (showOxide && innerPolygons.length && outerWorld.length <= 2) {
    ctx.save();
    const alpha = selected ? 0.55 : 0.35;
    const fill = `rgba(37, 99, 235, ${alpha})`;
    innerPolygons.forEach((poly) => {
      const screen = poly.map((pt) => worldToCanvas(pt, view));
      fillPolygon(ctx, screen, fill);
    });
    ctx.restore();
  }

  if (mirror?.enabled) {
    const variants = createMirroredVariants(outerWorld, innerWorld, mirror);
    variants.forEach(({ outer, inner }) => {
      if (outer.length) {
        drawVariant(outer, inner, false);
      }
    });
  }
  drawVariant(
    outerWorld.length ? outerWorld : samples.map((sample) => sample.position),
    innerWorld.length ? innerWorld : samples.map((sample) => sample.position),
    true,
  );
};

const createMirroredVariants = (
  outer: Vec2[],
  inner: Vec2[],
  mirror: MirrorSettings,
): Array<{ outer: Vec2[]; inner: Vec2[] }> => {
  const variants: Array<{ outer: Vec2[]; inner: Vec2[] }> = [];
  const mirrorX = mirror.axis === 'x' || mirror.axis === 'xy';
  const mirrorY = mirror.axis === 'y' || mirror.axis === 'xy';
  const mapPoints = (transform: (point: Vec2) => Vec2) => ({
    outer: outer.map(transform),
    inner: inner.map(transform),
  });
  if (mirrorY) {
    variants.push(
      mapPoints((pt) => ({
        x: mirror.origin.x - (pt.x - mirror.origin.x),
        y: pt.y,
      })),
    );
  }
  if (mirrorX) {
    variants.push(
      mapPoints((pt) => ({
        x: pt.x,
        y: mirror.origin.y - (pt.y - mirror.origin.y),
      })),
    );
  }
  if (mirror.axis === 'xy') {
    variants.push(
      mapPoints((pt) => ({
        x: mirror.origin.x - (pt.x - mirror.origin.x),
        y: mirror.origin.y - (pt.y - mirror.origin.y),
      })),
    );
  }
  return variants;
};
