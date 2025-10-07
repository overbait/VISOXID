import type { ExportMeasurement, MeasurementProbe, MeasurementState } from '../types';
import { toDegrees } from '../utils/math';
import { worldToCanvas, type ViewTransform } from './viewTransform';

export const drawMeasurements = (
  ctx: CanvasRenderingContext2D,
  measurements: MeasurementState,
  view: ViewTransform,
  saved: ExportMeasurement[] = [],
  exportMode = false,
): void => {
  ctx.save();
  const entries: Array<
    {
      probe: MeasurementProbe;
      tone: 'pinned' | 'drag' | 'hover' | 'saved';
      color?: string;
      label?: string;
    }
  > = [];
  if (measurements.pinnedProbe) {
    entries.push({ probe: measurements.pinnedProbe, tone: 'pinned' });
  }
  if (measurements.hoverProbe) {
    entries.push({ probe: measurements.hoverProbe, tone: 'hover' });
  }
  if (measurements.dragProbe) {
    entries.push({ probe: measurements.dragProbe, tone: 'drag' });
  }
  saved.forEach((entry) => {
    entries.push({ probe: entry.probe, tone: 'saved', color: entry.color, label: entry.label });
  });
  entries.forEach(({ probe, tone, color, label }) => {
    const aScreen = worldToCanvas(probe.a, view);
    const bScreen = worldToCanvas(probe.b, view);
    ctx.beginPath();
    ctx.setLineDash([]);
    ctx.lineWidth = tone === 'drag' ? 2 : 1.5;
    if (tone === 'hover') {
      ctx.strokeStyle = 'rgba(30, 64, 175, 0.45)';
      ctx.setLineDash([6, 4]);
    } else if (tone === 'saved') {
      ctx.strokeStyle = color ?? '#1e3a8a';
      ctx.setLineDash([]);
      ctx.lineWidth = 2;
    } else {
      ctx.strokeStyle = '#1e3a8a';
    }
    ctx.moveTo(aScreen.x, aScreen.y);
    ctx.lineTo(bScreen.x, bScreen.y);
    ctx.stroke();
    const dx = bScreen.x - aScreen.x;
    const dy = bScreen.y - aScreen.y;
    const length = Math.hypot(dx, dy);
    let labelX = aScreen.x + 18;
    let labelY = aScreen.y - 18;
    if (length > 1e-3) {
      const ux = dx / length;
      const uy = dy / length;
      const lateral = 12;
      const along = Math.min(Math.max(length * 0.25, 18), 42);
      labelX = aScreen.x + ux * along - uy * lateral;
      labelY = aScreen.y + uy * along + ux * lateral;
    }
    const distanceLabel = `${probe.distance.toFixed(2)} μm`;
    const angleLabel = `${toDegrees(Math.atan2(probe.b.y - probe.a.y, probe.b.x - probe.a.x)).toFixed(1)}°`;
    const toneVariant = tone === 'hover' ? 'subtle' : 'strong';
    const text = tone === 'saved'
      ? exportMode
        ? distanceLabel
        : `${label ?? ''} • ${distanceLabel} • ${angleLabel}`.replace(/^\s*•\s*/, '')
      : `${distanceLabel} • ${angleLabel}`;
    drawLabel(ctx, labelX, labelY, text, toneVariant, tone === 'saved' ? color : undefined);
  });
  ctx.restore();
};

const drawLabel = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  text: string,
  tone: 'strong' | 'subtle',
  accentColor?: string,
) => {
  ctx.save();
  ctx.font = '12px Inter, sans-serif';
  const padding = 6;
  const textMetrics = ctx.measureText(text);
  const width = textMetrics.width + padding * 2;
  const height = 20;
  const accent = accentColor ?? '#1e3a8a';
  ctx.fillStyle = tone === 'strong' ? 'rgba(15, 23, 42, 0.85)' : 'rgba(148, 163, 184, 0.85)';
  ctx.strokeStyle = tone === 'strong' ? accent : 'rgba(226, 232, 240, 0.9)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(x - width / 2, y - height / 2, width, height, 10);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = tone === 'strong' ? '#f8fafc' : '#0f172a';
  ctx.fillText(text, x - textMetrics.width / 2, y + 4);
  ctx.restore();
};
