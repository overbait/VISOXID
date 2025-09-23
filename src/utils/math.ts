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
