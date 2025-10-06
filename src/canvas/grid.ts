import type { GridSettings } from '../types';
import { canvasToWorld, worldToCanvas, type ViewTransform } from './viewTransform';

export const drawGrid = (
  ctx: CanvasRenderingContext2D,
  settings: GridSettings,
  view: ViewTransform,
): void => {
  if (!settings.visible) return;
  const spacing = Math.max(4, settings.spacing);
  const subdivisions = Math.max(1, settings.subdivisions);
  const subSpacing = spacing / subdivisions;
  const topLeft = canvasToWorld({ x: 0, y: 0 }, view);
  const bottomRight = canvasToWorld({ x: view.canvasWidth, y: view.canvasHeight }, view);
  const minX = Math.min(topLeft.x, bottomRight.x);
  const maxX = Math.max(topLeft.x, bottomRight.x);
  const minY = Math.min(topLeft.y, bottomRight.y);
  const maxY = Math.max(topLeft.y, bottomRight.y);
  const startMajorX = Math.floor(minX / spacing) * spacing;
  const endMajorX = Math.ceil(maxX / spacing) * spacing;
  const startMajorY = Math.floor(minY / spacing) * spacing;
  const endMajorY = Math.ceil(maxY / spacing) * spacing;
  const startMinorX = Math.floor(minX / subSpacing) * subSpacing;
  const endMinorX = Math.ceil(maxX / subSpacing) * subSpacing;
  const startMinorY = Math.floor(minY / subSpacing) * subSpacing;
  const endMinorY = Math.ceil(maxY / subSpacing) * subSpacing;

  ctx.save();
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.25)';
  for (let x = startMajorX; x <= endMajorX; x += spacing) {
    const a = worldToCanvas({ x, y: minY }, view);
    const b = worldToCanvas({ x, y: maxY }, view);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  for (let y = startMajorY; y <= endMajorY; y += spacing) {
    const a = worldToCanvas({ x: minX, y }, view);
    const b = worldToCanvas({ x: maxX, y }, view);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.15)';
  for (let x = startMinorX; x <= endMinorX; x += subSpacing) {
    const a = worldToCanvas({ x, y: minY }, view);
    const b = worldToCanvas({ x, y: maxY }, view);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  for (let y = startMinorY; y <= endMinorY; y += subSpacing) {
    const a = worldToCanvas({ x: minX, y }, view);
    const b = worldToCanvas({ x: maxX, y }, view);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  ctx.restore();
};
