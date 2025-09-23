import type { MeasurementProbe, MeasurementState } from '../types';
import { toDegrees } from '../utils/math';
import { worldToCanvas, type ViewTransform } from './viewTransform';

export const drawMeasurements = (
  ctx: CanvasRenderingContext2D,
  measurements: MeasurementState,
  view: ViewTransform,
): void => {
  ctx.save();
  const entries: Array<{ probe: MeasurementProbe; tone: 'pinned' | 'drag' | 'hover' }> = [];
  if (measurements.pinnedProbe) {
    entries.push({ probe: measurements.pinnedProbe, tone: 'pinned' });
  }
  if (measurements.hoverProbe) {
    entries.push({ probe: measurements.hoverProbe, tone: 'hover' });
  }
  if (measurements.dragProbe) {
    entries.push({ probe: measurements.dragProbe, tone: 'drag' });
  }
  entries.forEach(({ probe, tone }) => {
    const aScreen = worldToCanvas(probe.a, view);
    const bScreen = worldToCanvas(probe.b, view);
    ctx.beginPath();
    ctx.setLineDash([]);
    ctx.lineWidth = tone === 'drag' ? 2 : 1.5;
    if (tone === 'hover') {
      ctx.strokeStyle = 'rgba(37, 99, 235, 0.45)';
      ctx.setLineDash([6, 4]);
    } else {
      ctx.strokeStyle = '#2563eb';
    }
    ctx.moveTo(aScreen.x, aScreen.y);
    ctx.lineTo(bScreen.x, bScreen.y);
    ctx.stroke();
    const midX = (aScreen.x + bScreen.x) / 2;
    const midY = (aScreen.y + bScreen.y) / 2;
    const distanceLabel = `${probe.distance.toFixed(2)} μm`;
    const angleLabel = `${toDegrees(Math.atan2(probe.b.y - probe.a.y, probe.b.x - probe.a.x)).toFixed(1)}°`;
    const toneVariant = tone === 'hover' ? 'subtle' : 'strong';
    drawLabel(ctx, midX, midY, `${distanceLabel} • ${angleLabel}`, toneVariant);
  });
  ctx.restore();
};

const drawLabel = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  text: string,
  tone: 'strong' | 'subtle',
) => {
  ctx.save();
  ctx.font = '12px Inter, sans-serif';
  const padding = 6;
  const textMetrics = ctx.measureText(text);
  const width = textMetrics.width + padding * 2;
  const height = 20;
  ctx.fillStyle = tone === 'strong' ? 'rgba(15, 23, 42, 0.85)' : 'rgba(148, 163, 184, 0.85)';
  ctx.strokeStyle = tone === 'strong' ? 'rgba(255, 255, 255, 0.8)' : 'rgba(226, 232, 240, 0.9)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(x - width / 2, y - height / 2, width, height, 10);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = tone === 'strong' ? '#f8fafc' : '#0f172a';
  ctx.fillText(text, x - textMetrics.width / 2, y + 4);
  ctx.restore();
};
