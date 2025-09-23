import type { GridSettings } from '../types';
import { VIEW_EXTENT_UM, worldToCanvas, type ViewTransform } from './viewTransform';

export const drawGrid = (
  ctx: CanvasRenderingContext2D,
  settings: GridSettings,
  view: ViewTransform,
): void => {
  if (!settings.visible) return;
  const spacing = Math.max(4, settings.spacing);
  const subdivisions = Math.max(1, settings.subdivisions);
  ctx.save();
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.25)';
  const extent = VIEW_EXTENT_UM;
  const subSpacing = spacing / subdivisions;
  for (let x = 0; x <= extent; x += spacing) {
    const a = worldToCanvas({ x, y: 0 }, view);
    const b = worldToCanvas({ x, y: extent }, view);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  for (let y = 0; y <= extent; y += spacing) {
    const a = worldToCanvas({ x: 0, y }, view);
    const b = worldToCanvas({ x: extent, y }, view);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.15)';
  for (let x = 0; x <= extent; x += subSpacing) {
    const a = worldToCanvas({ x, y: 0 }, view);
    const b = worldToCanvas({ x, y: extent }, view);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  for (let y = 0; y <= extent; y += subSpacing) {
    const a = worldToCanvas({ x: 0, y }, view);
    const b = worldToCanvas({ x: extent, y }, view);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  ctx.restore();
};
