import type { DirectionalWeight, SamplePoint } from '../types';
import { calculateDirectionalThickness } from './directional';

export interface ThicknessOptions {
  baseThickness: number;
  directionalWeights: DirectionalWeight[];
  directionalFocus: number;
  // The following properties are now deprecated for thickness calculation
  // but are kept for API compatibility.
  kernelWidth?: number;
  targetThickness?: number;
  vonMisesKappa?: number;
  mirrorSymmetry?: boolean;
}

export const evalThickness = (
  samples: SamplePoint[],
  options: ThicknessOptions,
): SamplePoint[] => {
  // The old logic is now entirely replaced by the new directional system.
  // We pass only the relevant options to the new function.
  return calculateDirectionalThickness(samples, {
    baseThickness: options.baseThickness,
    directionalWeights: options.directionalWeights,
    directionalFocus: options.directionalFocus,
  });
};
