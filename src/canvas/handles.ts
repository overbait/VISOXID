import type { PathEntity } from '../types';
import { worldToCanvas, type ViewTransform } from './viewTransform';

export const drawHandles = (
  ctx: CanvasRenderingContext2D,
  path: PathEntity,
  selected: boolean,
  view: ViewTransform,
): void => {
  if (!selected) return;
  ctx.save();
  ctx.strokeStyle = 'rgba(37, 99, 235, 0.35)';
  ctx.fillStyle = '#2563eb';
  ctx.lineWidth = 1;
  path.nodes.forEach((node) => {
    const { point, handleIn, handleOut } = node;
    const screenPoint = worldToCanvas(point, view);
    if (handleIn) {
      const screenHandleIn = worldToCanvas(handleIn, view);
      ctx.beginPath();
      ctx.moveTo(screenPoint.x, screenPoint.y);
      ctx.lineTo(screenHandleIn.x, screenHandleIn.y);
      ctx.stroke();
      drawHandlePoint(ctx, screenHandleIn.x, screenHandleIn.y, false);
    }
    if (handleOut) {
      const screenHandleOut = worldToCanvas(handleOut, view);
      ctx.beginPath();
      ctx.moveTo(screenPoint.x, screenPoint.y);
      ctx.lineTo(screenHandleOut.x, screenHandleOut.y);
      ctx.stroke();
      drawHandlePoint(ctx, screenHandleOut.x, screenHandleOut.y, false);
    }
    drawHandlePoint(ctx, screenPoint.x, screenPoint.y, true);
  });
  ctx.restore();
};

const drawHandlePoint = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  anchor: boolean,
) => {
  ctx.beginPath();
  ctx.arc(x, y, anchor ? 5 : 4, 0, Math.PI * 2);
  ctx.fillStyle = anchor ? '#2563eb' : '#94a3b8';
  ctx.strokeStyle = '#ffffff';
  ctx.fill();
  ctx.stroke();
};
