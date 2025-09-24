import type { SamplePoint, DirectionalWeight } from '../types';
import { toRadians } from '../utils/math';

export interface DirectionalThicknessOptions {
  baseThickness: number;
  directionalWeights: DirectionalWeight[];
  directionalFocus: number; // This is kappa
}

// Simplified von Mises-like influence function, normalized to a 0-1 range
const calculateInfluence = (angleDiffRad: number, kappa: number): number => {
  // exp(kappa * cos(theta)) gives a value between exp(-kappa) and exp(kappa)
  const val = Math.exp(kappa * Math.cos(angleDiffRad));
  // Normalize to a 0-1 range
  const min = Math.exp(-kappa);
  const max = Math.exp(kappa);
  if (max === min) return 1; // Avoid division by zero if kappa is 0
  return (val - min) / (max - min);
};

export const calculateDirectionalThickness = (
  samples: SamplePoint[],
  options: DirectionalThicknessOptions,
): SamplePoint[] => {
  const { baseThickness, directionalWeights, directionalFocus } = options;

  if (directionalWeights.length === 0) {
    // If no weights, just return the base thickness for all points
    return samples.map((sample) => ({
      ...sample,
      thickness: baseThickness,
    }));
  }

  return samples.map((sample) => {
    // atan2 returns the angle in radians from the positive X axis, which is what we want.
    // Y is first argument to atan2.
    const normalAngleRad = Math.atan2(sample.normal.y, sample.normal.x);

    let totalStrength = 0;
    for (const weight of directionalWeights) {
      const weightAngleRad = toRadians(weight.angle);

      // Find the shortest angle difference, handling wrap-around
      let angleDiff = normalAngleRad - weightAngleRad;
      if (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
      if (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;

      const influence = calculateInfluence(angleDiff, directionalFocus);
      totalStrength += weight.strength * influence;
    }

    return {
      ...sample,
      thickness: baseThickness + totalStrength,
    };
  });
};
