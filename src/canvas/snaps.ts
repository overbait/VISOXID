import type { MeasurementState, PathEntity } from '../types';

export const drawSnaps = (
  ctx: CanvasRenderingContext2D,
  paths: PathEntity[],
  measurements: MeasurementState,
): void => {
  if (!measurements.snapping) return;
  ctx.save();
  ctx.fillStyle = 'rgba(56, 189, 248, 0.75)';
  const snapPoints = new Set<string>();
  paths.forEach((path) => {
    path.nodes.forEach((node) => {
      const key = `${Math.round(node.point.x)}:${Math.round(node.point.y)}`;
      if (snapPoints.has(key)) return;
      snapPoints.add(key);
      ctx.beginPath();
      ctx.arc(node.point.x, node.point.y, 3, 0, Math.PI * 2);
      ctx.fill();
    });
  });
  if (measurements.activeProbe) {
    const { a, b } = measurements.activeProbe;
    drawSnap(ctx, a.x, a.y, true);
    drawSnap(ctx, b.x, b.y, true);
  }
  ctx.restore();
};

const drawSnap = (ctx: CanvasRenderingContext2D, x: number, y: number, strong: boolean) => {
  ctx.beginPath();
  ctx.fillStyle = strong ? 'rgba(37, 99, 235, 0.9)' : ctx.fillStyle;
  ctx.arc(x, y, strong ? 5 : 3, 0, Math.PI * 2);
  ctx.fill();
};
