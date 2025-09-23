import type { MeasurementState } from '../types';
import { toDegrees } from '../utils/math';

export const drawMeasurements = (
  ctx: CanvasRenderingContext2D,
  measurements: MeasurementState,
): void => {
  ctx.save();
  ctx.strokeStyle = '#2563eb';
  ctx.fillStyle = '#2563eb';
  ctx.lineWidth = 1.5;
  const probes = measurements.activeProbe
    ? [measurements.activeProbe, ...measurements.history]
    : measurements.history;
  probes.slice(0, 1).forEach((probe) => {
    ctx.beginPath();
    ctx.moveTo(probe.a.x, probe.a.y);
    ctx.lineTo(probe.b.x, probe.b.y);
    ctx.stroke();
    const midX = (probe.a.x + probe.b.x) / 2;
    const midY = (probe.a.y + probe.b.y) / 2;
    const distanceLabel = `${probe.distance.toFixed(2)} px`;
    const angleLabel = `${toDegrees(Math.atan2(probe.b.y - probe.a.y, probe.b.x - probe.a.x)).toFixed(1)}°`;
    drawLabel(ctx, midX, midY, `${distanceLabel} • ${angleLabel}`);
  });
  ctx.restore();
};

const drawLabel = (ctx: CanvasRenderingContext2D, x: number, y: number, text: string) => {
  ctx.save();
  ctx.font = '12px Inter, sans-serif';
  const padding = 6;
  const textMetrics = ctx.measureText(text);
  const width = textMetrics.width + padding * 2;
  const height = 20;
  ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(x - width / 2, y - height / 2, width, height, 10);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#f8fafc';
  ctx.fillText(text, x - textMetrics.width / 2, y + 4);
  ctx.restore();
};
