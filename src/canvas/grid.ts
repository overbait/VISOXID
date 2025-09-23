import type { GridSettings } from '../types';

export const drawGrid = (
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  settings: GridSettings,
): void => {
  if (!settings.visible) return;
  const spacing = Math.max(4, settings.spacing);
  const subdivisions = Math.max(1, settings.subdivisions);
  ctx.save();
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.25)';
  const originX = width / 2;
  const originY = height / 2;
  const subSpacing = spacing / subdivisions;
  for (let x = originX % spacing; x <= width; x += spacing) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
  for (let y = originY % spacing; y <= height; y += spacing) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.15)';
  for (let x = originX % subSpacing; x <= width; x += subSpacing) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
  for (let y = originY % subSpacing; y <= height; y += subSpacing) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }
  ctx.restore();
};
