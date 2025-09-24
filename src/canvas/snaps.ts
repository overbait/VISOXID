import type { MeasurementProbe, MeasurementState, PathEntity } from '../types';
import { worldToCanvas, type ViewTransform } from './viewTransform';

export const drawSnaps = (
  ctx: CanvasRenderingContext2D,
  paths: PathEntity[],
  measurements: MeasurementState,
  view: ViewTransform,
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
      const screen = worldToCanvas(node.point, view);
      ctx.arc(screen.x, screen.y, 3, 0, Math.PI * 2);
      ctx.fill();
    });
  });
  const probeCandidates = [measurements.pinnedProbe, measurements.dragProbe].filter(
    (probe): probe is MeasurementProbe => Boolean(probe),
  );
  probeCandidates.forEach((probe) => {
    const aScreen = worldToCanvas(probe.a, view);
    const bScreen = worldToCanvas(probe.b, view);
    drawSnap(ctx, aScreen.x, aScreen.y, true);
    drawSnap(ctx, bScreen.x, bScreen.y, true);
  });
  ctx.restore();
};

const drawSnap = (ctx: CanvasRenderingContext2D, x: number, y: number, strong: boolean) => {
  ctx.beginPath();
  ctx.fillStyle = strong ? 'rgba(37, 99, 235, 0.9)' : ctx.fillStyle;
  ctx.arc(x, y, strong ? 5 : 3, 0, Math.PI * 2);
  ctx.fill();
};
