import type { SamplePoint } from '../types';
import { gaussianKernel, vonMisesKernel, angleBetween, distance } from '../utils/math';

export interface ThicknessOptions {
  kernelWidth: number;
  baseThickness: number;
  targetThickness: number;
  vonMisesKappa: number;
  mirrorSymmetry?: boolean;
}

export const evalThickness = (
  samples: SamplePoint[],
  options: ThicknessOptions,
): SamplePoint[] => {
  const { kernelWidth, baseThickness, targetThickness, vonMisesKappa, mirrorSymmetry } = options;
  const updated = samples.map((sample) => ({ ...sample }));
  const maxDistance = kernelWidth * 3;
  for (let i = 0; i < samples.length; i += 1) {
    let weightSum = 0;
    let accum = 0;
    const pivot = samples[i];
    for (let j = 0; j < samples.length; j += 1) {
      const neighbor = samples[j];
      const dist = distance(pivot.position, neighbor.position);
      if (dist > maxDistance) continue;
      const angular = Math.abs(angleBetween(pivot.normal, neighbor.normal));
      const gaussian = gaussianKernel(dist, kernelWidth);
      const vm = vonMisesKernel(angular, vonMisesKappa);
      const weight = gaussian * vm;
      weightSum += weight;
      const neighborThickness = neighbor.thickness || baseThickness;
      accum += neighborThickness * weight;
    }
    const base = weightSum > 0 ? accum / weightSum : baseThickness;
    const lerpFactor = Math.min(1, weightSum * 0.75);
    const blended = base * (1 - lerpFactor) + targetThickness * lerpFactor;
    updated[i].thickness = mirrorSymmetry ? (blended + baseThickness) / 2 : blended;
  }
  return updated;
};
