import type { DirectionWeight, SamplePoint } from '../types';

export interface ThicknessOptions {
  uniformThickness: number;
  weights: DirectionWeight[];
  mirrorSymmetry?: boolean;
  progress?: number;
  resolution?: number;
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

const TAU = Math.PI * 2;

const evaluatePolygon = (theta: number, weights: NormalizedWeight[]): number => {
  if (!weights.length) return 0;
  if (weights.length === 1) {
    return weights[0].value;
  }

  const wrapped = normalizeAngle(theta);
  const firstAngle = weights[0].angle;
  const target = wrapped < firstAngle ? wrapped + TAU : wrapped;
  const extended: NormalizedWeight[] = [
    ...weights,
    { angle: weights[0].angle + TAU, value: weights[0].value },
  ];

  for (let i = 0; i < extended.length - 1; i += 1) {
    const a = extended[i];
    const b = extended[i + 1];
    if (target >= a.angle && target <= b.angle) {
      const span = b.angle - a.angle;
      const t = span <= 1e-6 ? 0 : (target - a.angle) / span;
      return a.value + (b.value - a.value) * t;
    }
  }

  const shifted = target - TAU;
  for (let i = 0; i < extended.length - 1; i += 1) {
    const a = extended[i];
    const b = extended[i + 1];
    if (shifted >= a.angle && shifted <= b.angle) {
      const span = b.angle - a.angle;
      const t = span <= 1e-6 ? 0 : (shifted - a.angle) / span;
      return a.value + (b.value - a.value) * t;
    }
  }

  return extended[0].value;
};

const evaluateForAngle = (
  theta: number,
  weights: NormalizedWeight[],
  mirrorSymmetry?: boolean,
): number => {
  const primary = evaluatePolygon(theta, weights);
  if (!mirrorSymmetry) {
    return primary;
  }
  const mirroredTheta = normalizeAngle(Math.PI - theta);
  const mirrored = evaluatePolygon(mirroredTheta, weights);
  return (primary + mirrored) / 2;
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
