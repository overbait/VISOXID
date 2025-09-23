import type { PathEntity } from '../types';

export const drawHandles = (
  ctx: CanvasRenderingContext2D,
  path: PathEntity,
  selected: boolean,
): void => {
  if (!selected) return;
  ctx.save();
  ctx.strokeStyle = 'rgba(37, 99, 235, 0.35)';
  ctx.fillStyle = '#2563eb';
  ctx.lineWidth = 1;
  path.nodes.forEach((node) => {
    const { point, handleIn, handleOut } = node;
    if (handleIn) {
      ctx.beginPath();
      ctx.moveTo(point.x, point.y);
      ctx.lineTo(handleIn.x, handleIn.y);
      ctx.stroke();
      drawHandlePoint(ctx, handleIn.x, handleIn.y, false);
    }
    if (handleOut) {
      ctx.beginPath();
      ctx.moveTo(point.x, point.y);
      ctx.lineTo(handleOut.x, handleOut.y);
      ctx.stroke();
      drawHandlePoint(ctx, handleOut.x, handleOut.y, false);
    }
    drawHandlePoint(ctx, point.x, point.y, true);
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
