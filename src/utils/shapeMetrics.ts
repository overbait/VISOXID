import type { PathEntity, Vec2 } from '../types';

export interface PathBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
}

export type ShapeSummary =
  | { kind: 'circle'; diameter: number; bounds: PathBounds }
  | { kind: 'oval'; horizontal: number; vertical: number; bounds: PathBounds }
  | { kind: 'complex'; longest: number; shortest: number; bounds: PathBounds };

const collectPoints = (path: PathEntity): Vec2[] => {
  const sampled = path.sampled?.samples ?? [];
  if (sampled.length) {
    return sampled.map((sample) => sample.position);
  }
  return path.nodes.map((node) => node.point);
};

const roundExtent = (value: number): number => {
  if (!Number.isFinite(value)) {
    return 0;
  }
  const sanitized = Math.max(value, 0);
  return sanitized < 1e-3 ? 0 : sanitized;
};

export const computePathBounds = (path: PathEntity): PathBounds | null => {
  const points = collectPoints(path);
  if (!points.length) {
    return null;
  }
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return null;
  }
  const width = roundExtent(maxX - minX);
  const height = roundExtent(maxY - minY);
  return { minX, minY, maxX, maxY, width, height };
};

export const formatDimension = (value: number): string => {
  if (!Number.isFinite(value)) {
    return '—';
  }
  const normalized = Math.round(value * 10) / 10;
  return Number.isInteger(normalized) ? normalized.toFixed(0) : normalized.toFixed(1);
};

const inferShapeKind = (path: PathEntity, bounds: PathBounds): 'circle' | 'oval' | 'complex' => {
  const { width, height } = bounds;
  if (width === 0 || height === 0) {
    return 'complex';
  }
  const name = path.meta.name.toLowerCase();
  if (name.includes('circle')) {
    return 'circle';
  }
  if (name.includes('oval')) {
    return 'oval';
  }
  const tolerance = Math.max(0.05, Math.min(Math.min(width, height) * 0.05, 0.5));
  if (Math.abs(width - height) <= tolerance) {
    return 'circle';
  }
  if (path.meta.kind === 'reference') {
    return 'oval';
  }
  return 'complex';
};

export const summarizePathGeometry = (path: PathEntity): ShapeSummary | null => {
  const bounds = computePathBounds(path);
  if (!bounds) {
    return null;
  }
  const { width, height } = bounds;
  const kind = inferShapeKind(path, bounds);
  if (kind === 'circle') {
    const diameter = width > 0 && height > 0 ? (width + height) / 2 : Math.max(width, height);
    return { kind: 'circle', diameter, bounds };
  }
  if (kind === 'oval') {
    return { kind: 'oval', horizontal: width, vertical: height, bounds };
  }
  const longest = Math.max(width, height);
  const shortest = Math.min(width, height);
  return { kind: 'complex', longest, shortest, bounds };
};
