import type { PathEntity } from '../types';

const toHeatColor = (value: number, min: number, max: number): string => {
  const t = max === min ? 0 : (value - min) / (max - min);
  const hue = (1 - t) * 210; // from blue to red
  return `hsl(${hue}, 85%, ${40 + t * 20}%)`;
};

export const drawHeatmap = (
  ctx: CanvasRenderingContext2D,
  path: PathEntity,
): void => {
  const samples = path.sampled?.samples;
  if (!samples?.length) return;
  const values = samples.map((sample) => sample.thickness);
  const min = Math.min(...values);
  const max = Math.max(...values);
  ctx.save();
  ctx.lineWidth = 6;
  ctx.lineCap = 'round';
  for (let i = 1; i < samples.length; i += 1) {
    const prev = samples[i - 1];
    const curr = samples[i];
    const color = toHeatColor((prev.thickness + curr.thickness) / 2, min, max);
    ctx.strokeStyle = `${color}88`;
    ctx.beginPath();
    ctx.moveTo(prev.position.x, prev.position.y);
    ctx.lineTo(curr.position.x, curr.position.y);
    ctx.stroke();
  }
  ctx.restore();
};
