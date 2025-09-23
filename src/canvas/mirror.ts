import type { MirrorSettings } from '../types';

export const drawMirrorAxes = (
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  settings: MirrorSettings,
): void => {
  if (!settings.enabled) return;
  ctx.save();
  ctx.strokeStyle = 'rgba(99, 102, 241, 0.35)';
  ctx.setLineDash([6, 6]);
  ctx.lineWidth = 1;
  if (settings.axis === 'x' || settings.axis === 'xy') {
    ctx.beginPath();
    ctx.moveTo(0, settings.origin.y);
    ctx.lineTo(width, settings.origin.y);
    ctx.stroke();
  }
  if (settings.axis === 'y' || settings.axis === 'xy') {
    ctx.beginPath();
    ctx.moveTo(settings.origin.x, 0);
    ctx.lineTo(settings.origin.x, height);
    ctx.stroke();
  }
  ctx.restore();
};
