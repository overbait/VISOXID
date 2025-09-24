import type { SamplePoint, Vec2 } from '../types';
import { gaussianKernel, add, scale, sub } from '../utils/math';

export const smoothSamples = (
  samples: SamplePoint[],
  iterations: number,
  strength: number,
): SamplePoint[] => {
  let result = samples.map((sample) => ({ ...sample }));
  const radius = Math.max(1, Math.round(strength * 6));
  for (let iter = 0; iter < iterations; iter += 1) {
    result = result.map((sample, index) => {
      let totalWeight = 0;
      let accumulated = { x: 0, y: 0 };
      for (let offset = -radius; offset <= radius; offset += 1) {
        const neighborIndex = index + offset;
        if (neighborIndex < 0 || neighborIndex >= result.length) continue;
        const weight = gaussianKernel(offset, strength);
        accumulated = add(accumulated, scale(result[neighborIndex].position, weight));
        totalWeight += weight;
      }
      return {
        ...sample,
        position: totalWeight > 0 ? scale(accumulated, 1 / totalWeight) : sample.position,
      };
    });
  }
  return result;
};

interface LaplacianOptions {
  closed?: boolean;
}

export const laplacianSmooth = (
  points: Vec2[],
  alpha: number,
  iterations: number,
  options: LaplacianOptions = {},
): Vec2[] => {
  if (points.length < 3) return points;
  const { closed = false } = options;
  let result = points.map((p) => ({ ...p }));
  for (let iter = 0; iter < iterations; iter += 1) {
    const next = result.map((point, i) => {
      if (!closed && (i === 0 || i === result.length - 1)) return point;
      const prevIndex = i === 0 ? (closed ? result.length - 1 : i) : i - 1;
      const nextIndex = i === result.length - 1 ? (closed ? 0 : i) : i + 1;
      const prev = result[prevIndex];
      const nextPoint = result[nextIndex];
      const average = scale(add(prev, nextPoint), 0.5);
      return add(point, scale(sub(average, point), alpha));
    });
    result = next;
  }
  return result;
};
