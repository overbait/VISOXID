import type { PathEntity } from '../types';

const moveToPoint = (ctx: CanvasRenderingContext2D, x: number, y: number) => {
  ctx.beginPath();
  ctx.moveTo(x, y);
};

const strokePolyline = (ctx: CanvasRenderingContext2D, points: Array<{ x: number; y: number }>) => {
  if (!points.length) return;
  moveToPoint(ctx, points[0].x, points[0].y);
  for (let i = 1; i < points.length; i += 1) {
    ctx.lineTo(points[i].x, points[i].y);
  }
  ctx.stroke();
};

export const drawContours = (
  ctx: CanvasRenderingContext2D,
  path: PathEntity,
  selected: boolean,
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
  ctx.save();
  ctx.lineWidth = 1.8;
  ctx.strokeStyle = strokeColor;
  ctx.setLineDash(path.meta.closed ? [] : [6, 3]);
  strokePolyline(
    ctx,
    samples.map((sample) => sample.position),
  );
  ctx.restore();
  if (!path.sampled) return;
  // draw inner/outer contours using thickness information
  const halfWidth = path.sampled.samples.map((sample) => sample.thickness / 2);
  const outer = path.sampled.samples.map((sample, index) => ({
    x: sample.position.x + sample.normal.x * halfWidth[index],
    y: sample.position.y + sample.normal.y * halfWidth[index],
  }));
  const inner = path.sampled.samples.map((sample, index) => ({
    x: sample.position.x - sample.normal.x * halfWidth[index],
    y: sample.position.y - sample.normal.y * halfWidth[index],
  }));
  ctx.save();
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(37, 99, 235, 0.25)';
  strokePolyline(ctx, outer);
  strokePolyline(ctx, inner);
  ctx.restore();
};
