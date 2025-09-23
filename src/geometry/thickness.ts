import type { DirectionWeight, SamplePoint } from '../types';

export interface ThicknessOptions {
  uniformThickness: number;
  weights: DirectionWeight[];
  mirrorSymmetry?: boolean;
  progress?: number;
}

interface NormalizedWeight {
  angle: number;
  value: number;
}

const clamp01 = (value: number): number => {
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
};

const clampThickness = (value: number): number => {
  if (value < 0) return 0;
  if (value > 10) return 10;
  return value;
};

const normalizeAngle = (angle: number): number => {
  let wrapped = angle % (Math.PI * 2);
  if (wrapped <= -Math.PI) {
    wrapped += Math.PI * 2;
  } else if (wrapped > Math.PI) {
    wrapped -= Math.PI * 2;
  }
  return wrapped;
};

const toNormalizedWeights = (weights: DirectionWeight[]): NormalizedWeight[] => {
  if (!weights.length) {
    return [{ angle: 0, value: 0 }];
  }
  return [...weights]
    .map((weight) => ({
      angle: normalizeAngle((weight.angleDeg * Math.PI) / 180),
      value: clampThickness(weight.valueUm),
    }))
    .sort((a, b) => a.angle - b.angle);
};

const evaluateDirectional = (
  theta: number,
  weights: NormalizedWeight[],
): { contribution: number; influence: number } => {
  let contribution = 0;
  let influence = 0;
  for (const weight of weights) {
    const delta = Math.cos(theta - weight.angle);
    if (delta > 0) {
      const falloff = delta * delta;
      contribution += weight.value * falloff;
      influence += falloff;
    }
  }
  return { contribution, influence };
};

const evaluateForAngle = (
  theta: number,
  weights: NormalizedWeight[],
  mirrorSymmetry?: boolean,
): number => {
  const primary = evaluateDirectional(theta, weights);
  if (!mirrorSymmetry) {
    return primary.influence > 0 ? primary.contribution / primary.influence : 0;
  }
  const mirroredTheta = normalizeAngle(Math.PI - theta);
  const mirrored = evaluateDirectional(mirroredTheta, weights);
  const combinedContribution = primary.contribution + mirrored.contribution;
  const combinedInfluence = primary.influence + mirrored.influence;
  return combinedInfluence > 0 ? combinedContribution / combinedInfluence : 0;
};

export const evalThickness = (
  samples: SamplePoint[],
  options: ThicknessOptions,
): SamplePoint[] => {
  const { uniformThickness, weights, mirrorSymmetry, progress = 1 } = options;
  const normalized = toNormalizedWeights(weights);
  const scale = clamp01(progress);
  return samples.map((sample) => {
    const theta = Math.atan2(sample.normal.y, sample.normal.x);
    const directional = evaluateForAngle(theta, normalized, mirrorSymmetry);
    const combined = uniformThickness + directional;
    const scaled = clampThickness(combined * scale);
    return {
      ...sample,
      thickness: scaled,
    };
  });
};

export const evalThicknessForAngle = (
  thetaRad: number,
  options: ThicknessOptions,
): number => {
  const { uniformThickness, weights, mirrorSymmetry, progress = 1 } = options;
  const normalized = toNormalizedWeights(weights);
  const directional = evaluateForAngle(thetaRad, normalized, mirrorSymmetry);
  const combined = uniformThickness + directional;
  return clampThickness(combined * clamp01(progress));
};
