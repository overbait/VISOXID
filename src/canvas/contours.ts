import type { PathEntity } from '../types';

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

export const drawContours = (
  ctx: CanvasRenderingContext2D,
  path: PathEntity,
  selected: boolean,
  showOxide: boolean,
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
    path.meta.closed,
  );
  ctx.restore();
  if (!showOxide || !path.sampled || path.sampled.samples.length < 2) return;
  const outer = path.sampled.samples.map((sample) => sample.position);
  const fallbackInner = path.sampled.samples.map((sample) => ({
    x: sample.position.x - sample.normal.x * sample.thickness,
    y: sample.position.y - sample.normal.y * sample.thickness,
  }));
  const innerSource = path.sampled.innerSamples ?? fallbackInner;
  const inner = innerSource.length === outer.length ? innerSource : fallbackInner;
  ctx.save();
  for (let i = 1; i < outer.length; i += 1) {
    fillRibbon(ctx, outer[i - 1], outer[i], inner[i], inner[i - 1]);
  }
  if (path.meta.closed && outer.length > 2) {
    fillRibbon(ctx, outer.at(-1)!, outer[0], inner[0], inner.at(-1)!);
  }
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(37, 99, 235, 0.55)';
  strokePolyline(ctx, inner, path.meta.closed);
  ctx.restore();
};

const fillRibbon = (
  ctx: CanvasRenderingContext2D,
  outerA: { x: number; y: number },
  outerB: { x: number; y: number },
  innerB: { x: number; y: number },
  innerA: { x: number; y: number },
) => {
  const gradient = ctx.createLinearGradient(outerA.x, outerA.y, innerA.x, innerA.y);
  gradient.addColorStop(0, 'rgba(37, 99, 235, 0.35)');
  gradient.addColorStop(1, 'rgba(37, 99, 235, 0.05)');
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.moveTo(outerA.x, outerA.y);
  ctx.lineTo(outerB.x, outerB.y);
  ctx.lineTo(innerB.x, innerB.y);
  ctx.lineTo(innerA.x, innerA.y);
  ctx.closePath();
  ctx.fill();
};
