import type { Vec2 } from '../types';

export const vec = (x = 0, y = 0): Vec2 => ({ x, y });

export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });

export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });

export const scale = (v: Vec2, s: number): Vec2 => ({ x: v.x * s, y: v.y * s });

export const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y;

export const lengthSq = (v: Vec2): number => dot(v, v);

export const length = (v: Vec2): number => Math.sqrt(lengthSq(v));

export const normalize = (v: Vec2): Vec2 => {
  const len = length(v);
  return len === 0 ? { x: 0, y: 0 } : scale(v, 1 / len);
};

export const distance = (a: Vec2, b: Vec2): number => length(sub(a, b));

export const lerp = (a: Vec2, b: Vec2, t: number): Vec2 => add(scale(a, 1 - t), scale(b, t));

export const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

export const perpendicular = (v: Vec2): Vec2 => ({ x: -v.y, y: v.x });

export const avg = (points: readonly Vec2[]): Vec2 => {
  if (!points.length) return { x: 0, y: 0 };
  const sum = points.reduce((acc, p) => add(acc, p), vec());
  return scale(sum, 1 / points.length);
};

export const angleBetween = (a: Vec2, b: Vec2): number => {
  const na = normalize(a);
  const nb = normalize(b);
  return Math.atan2(na.x * nb.y - na.y * nb.x, dot(na, nb));
};

export const toDegrees = (rad: number): number => (rad * 180) / Math.PI;

export const toRadians = (deg: number): number => (deg * Math.PI) / 180;

export const rotate = (v: Vec2, angleRad: number): Vec2 => {
  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);
  return {
    x: v.x * cos - v.y * sin,
    y: v.x * sin + v.y * cos,
  };
};

export const gaussianKernel = (x: number, sigma: number): number => {
  const coeff = 1 / (sigma * Math.sqrt(2 * Math.PI));
  return coeff * Math.exp(-(x * x) / (2 * sigma * sigma));
};

export const vonMisesKernel = (theta: number, kappa: number): number => {
  const denom = 2 * Math.PI * besseli0(kappa);
  return Math.exp(kappa * Math.cos(theta)) / denom;
};

const besseli0 = (x: number): number => {
  // Modified Bessel function of the first kind, order 0 (series approximation)
  let sum = 1;
  let term = 1;
  for (let k = 1; k < 10; k += 1) {
    term *= (x * x) / (4 * k * k);
    sum += term;
  }
  return sum;
};

export const closestPointOnSegment = (p: Vec2, a: Vec2, b: Vec2): Vec2 => {
  const ap = sub(p, a);
  const ab = sub(b, a);
  const ab2 = ab.x * ab.x + ab.y * ab.y;
  if (ab2 === 0) {
    return a;
  }
  const ap_dot_ab = ap.x * ab.x + ap.y * ab.y;
  const t = clamp(ap_dot_ab / ab2, 0, 1);
  return add(a, scale(ab, t));
};

export const findClosestPointOnPolygon = (point: Vec2, polygon: Vec2[]): Vec2 => {
  if (!polygon.length) {
    return { x: 0, y: 0 };
  }
  if (polygon.length === 1) {
    return polygon[0];
  }

  let closestPoint = { x: 0, y: 0 };
  let minDistanceSq = Infinity;

  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    const candidate = closestPointOnSegment(point, a, b);
    const candidateDistSq = lengthSq(sub(point, candidate));

    if (candidateDistSq < minDistanceSq) {
      minDistanceSq = candidateDistSq;
      closestPoint = candidate;
    }
  }

  return closestPoint;
};

export const alignLoop = (loopToAlign: Vec2[], anchorLoop: Vec2[]): Vec2[] => {
  if (loopToAlign.length !== anchorLoop.length || loopToAlign.length === 0) {
    return loopToAlign;
  }

  let bestLoop = loopToAlign;
  let bestScore = Infinity;

  const evaluate = (candidate: Vec2[]): number => {
    let score = 0;
    for (let i = 0; i < candidate.length; i++) {
      score += lengthSq(sub(candidate[i], anchorLoop[i]));
    }
    return score;
  };

  const orientations = [loopToAlign, [...loopToAlign].reverse()];

  for (const orientation of orientations) {
    for (let i = 0; i < orientation.length; i++) {
      const rotated = orientation.slice(i).concat(orientation.slice(0, i));
      const score = evaluate(rotated);
      if (score < bestScore) {
        bestScore = score;
        bestLoop = rotated;
      }
    }
  }

  return bestLoop;
};
