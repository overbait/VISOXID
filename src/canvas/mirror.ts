import type { MirrorSettings } from '../types';
import { VIEW_EXTENT_UM, worldToCanvas, type ViewTransform } from './viewTransform';

export const drawMirrorAxes = (
  ctx: CanvasRenderingContext2D,
  settings: MirrorSettings,
  view: ViewTransform,
): void => {
  if (!settings.enabled) return;
  ctx.save();
  ctx.strokeStyle = 'rgba(99, 102, 241, 0.35)';
  ctx.setLineDash([6, 6]);
  ctx.lineWidth = 1;
  if (settings.axis === 'x' || settings.axis === 'xy') {
    const start = worldToCanvas({ x: 0, y: settings.origin.y }, view);
    const end = worldToCanvas({ x: VIEW_EXTENT_UM, y: settings.origin.y }, view);
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
    ctx.stroke();
  }
  if (settings.axis === 'y' || settings.axis === 'xy') {
    const start = worldToCanvas({ x: settings.origin.x, y: 0 }, view);
    const end = worldToCanvas({ x: settings.origin.x, y: VIEW_EXTENT_UM }, view);
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
    ctx.stroke();
  }
  ctx.restore();
};
