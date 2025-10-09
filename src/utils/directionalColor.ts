export const directionalGradientStops: ReadonlyArray<{
  stop: number;
  color: readonly [number, number, number];
}> = [
  { stop: 0, color: [37, 99, 235] },
  { stop: 0.35, color: [34, 197, 94] },
  { stop: 0.7, color: [250, 204, 21] },
  { stop: 1, color: [239, 68, 68] },
] as const;

const interpolate = (
  start: readonly [number, number, number],
  end: readonly [number, number, number],
  t: number,
): [number, number, number] => [
  start[0] + (end[0] - start[0]) * t,
  start[1] + (end[1] - start[1]) * t,
  start[2] + (end[2] - start[2]) * t,
];

const clamp01 = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
};

export const directionalValueToColor = (value: number): string => {
  const t = clamp01(value / 10);
  for (let i = 0; i < directionalGradientStops.length - 1; i += 1) {
    const current = directionalGradientStops[i];
    const next = directionalGradientStops[i + 1];
    if (t >= current.stop && t <= next.stop) {
      const span = next.stop - current.stop;
      const ratio = span <= 1e-6 ? 0 : (t - current.stop) / span;
      const [r, g, b] = interpolate(current.color, next.color, ratio);
      return `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;
    }
  }
  const last = directionalGradientStops[directionalGradientStops.length - 1];
  const [r, g, b] = last.color;
  return `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;
};
