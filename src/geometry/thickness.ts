import type { DirectionWeight, DirKey, SamplePoint } from '../types';

export interface ThicknessOptions {
  uniformThickness: number;
  weights: DirectionWeight[];
  kappa: number;
  mirrorSymmetry?: boolean;
}

const DIR_SEQUENCE: DirKey[] = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

const DIR_ANGLES: Record<DirKey, number> = {
  E: 0,
  NE: Math.PI / 4,
  N: Math.PI / 2,
  NW: (3 * Math.PI) / 4,
  W: Math.PI,
  SW: (-3 * Math.PI) / 4,
  S: -Math.PI / 2,
  SE: -Math.PI / 4,
};

const MIRROR_PAIRS: [DirKey, DirKey][] = [
  ['E', 'W'],
  ['NE', 'NW'],
  ['SE', 'SW'],
];

const normalizeWeights = (
  weights: DirectionWeight[],
  mirrorSymmetry?: boolean,
): Record<DirKey, number> => {
  const lookup: Record<DirKey, number> = {
    N: 0,
    NE: 0,
    E: 0,
    SE: 0,
    S: 0,
    SW: 0,
    W: 0,
    NW: 0,
  };
  for (const weight of weights) {
    lookup[weight.dir] = weight.valueUm;
  }
  if (mirrorSymmetry) {
    for (const [a, b] of MIRROR_PAIRS) {
      const average = (lookup[a] + lookup[b]) / 2;
      lookup[a] = average;
      lookup[b] = average;
    }
  }
  return lookup;
};

export const evalThickness = (
  samples: SamplePoint[],
  options: ThicknessOptions,
): SamplePoint[] => {
  const { uniformThickness, weights, kappa, mirrorSymmetry } = options;
  const lookup = normalizeWeights(weights, mirrorSymmetry);
  const safeKappa = Math.max(0, Number.isFinite(kappa) ? kappa : 0);

  return samples.map((sample) => {
    const theta = Math.atan2(sample.normal.y, sample.normal.x);
    let numerator = 0;
    let denominator = 0;
    for (const dir of DIR_SEQUENCE) {
      const phi = DIR_ANGLES[dir];
      const kernel = Math.exp(safeKappa * Math.cos(theta - phi));
      denominator += kernel;
      numerator += lookup[dir] * kernel;
    }
    const directional = denominator > 0 ? numerator / denominator : 0;
    return {
      ...sample,
      thickness: uniformThickness + directional,
    };
  });
};

export const evalThicknessForAngle = (
  thetaRad: number,
  options: ThicknessOptions,
): number => {
  const { uniformThickness, weights, kappa, mirrorSymmetry } = options;
  const lookup = normalizeWeights(weights, mirrorSymmetry);
  const safeKappa = Math.max(0, Number.isFinite(kappa) ? kappa : 0);
  let numerator = 0;
  let denominator = 0;
  for (const dir of DIR_SEQUENCE) {
    const phi = DIR_ANGLES[dir];
    const kernel = Math.exp(safeKappa * Math.cos(thetaRad - phi));
    denominator += kernel;
    numerator += lookup[dir] * kernel;
  }
  const directional = denominator > 0 ? numerator / denominator : 0;
  return uniformThickness + directional;
};
