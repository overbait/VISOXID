// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - clipper-lib lacks ESM typings
import ClipperLib from 'clipper-lib';
import type { Vec2 } from '../types';
import { distance, lerp } from '../utils/math';

const SCALE = 10_000;

export type JoinStyle = 'miter' | 'round' | 'bevel';

export interface OffsetOptions {
  delta: number;
  joinStyle?: JoinStyle;
  miterLimit?: number;
}

type IntPoint = { X: number; Y: number };

type ClipperModule = {
  JoinType: { jtMiter: number; jtRound: number; jtSquare: number };
  EndType: { etClosedPolygon: number };
  PolyFillType: {
    pftEvenOdd: number;
    pftNonZero: number;
    pftPositive: number;
    pftNegative: number;
  };
  ClipperOffset: new (miterLimit?: number, arcTolerance?: number) => {
    AddPath(path: IntPoint[], joinType: number, endType: number): void;
    Execute(delta: number): IntPoint[][];
    Execute(solution: IntPoint[][], delta: number): void;
  };
  Clipper: {
    CleanPolygon(path: IntPoint[], distance: number): IntPoint[];
    CleanPolygons(polys: IntPoint[][], distance: number): IntPoint[][];
    SimplifyPolygon(path: IntPoint[], fillType: number): IntPoint[][];
    SimplifyPolygons(polys: IntPoint[][], fillType: number): IntPoint[][];
  };
};

const clipper = ClipperLib as unknown as ClipperModule;

const joinMap: Record<JoinStyle, number> = {
  miter: clipper.JoinType.jtMiter,
  round: clipper.JoinType.jtRound,
  bevel: clipper.JoinType.jtSquare,
};

export const computeOffset = (path: Vec2[], options: OffsetOptions): Vec2[][] => {
  const { delta, joinStyle = 'round', miterLimit = 3 } = options;
  if (path.length < 3) return [];
  const integerPath: IntPoint[] = path.map((p) => ({ X: Math.round(p.x * SCALE), Y: Math.round(p.y * SCALE) }));
  const offset = new clipper.ClipperOffset(2, miterLimit * SCALE);
  offset.AddPath(integerPath, joinMap[joinStyle], clipper.EndType.etClosedPolygon);
  const solution: IntPoint[][] = [];
  offset.Execute(solution, delta * SCALE);
  return solution.map((poly) => poly.map((pt) => ({ x: pt.X / SCALE, y: pt.Y / SCALE })));
};

const toIntPoint = (point: Vec2): IntPoint => ({
  X: Math.round(point.x * SCALE),
  Y: Math.round(point.y * SCALE),
});

const fromIntPoint = (point: IntPoint): Vec2 => ({ x: point.X / SCALE, y: point.Y / SCALE });

const toIntPath = (path: Vec2[]): IntPoint[] => path.map(toIntPoint);

const fromIntPath = (path: IntPoint[]): Vec2[] => path.map(fromIntPoint);

export const cleanAndSimplifyPolygons = (path: Vec2[], tolerance = 0.25): Vec2[][] => {
  if (path.length < 3) return [];
  const intPath = toIntPath(path);
  const cleaned = clipper.Clipper.CleanPolygon(intPath, Math.max(1, Math.round(tolerance * SCALE)));
  if (cleaned.length < 3) {
    return [];
  }
  const simplified = clipper.Clipper.SimplifyPolygon(cleaned, clipper.PolyFillType.pftNonZero);
  if (!simplified.length) {
    return [fromIntPath(cleaned)];
  }
  return simplified.map(fromIntPath);
};

export const polygonArea = (polygon: Vec2[]): number => {
  if (polygon.length < 3) return 0;
  let area = 0;
  for (let i = 0; i < polygon.length; i += 1) {
    const current = polygon[i];
    const next = polygon[(i + 1) % polygon.length];
    area += current.x * next.y - next.x * current.y;
  }
  return area / 2;
};

export const resampleClosedPolygon = (polygon: Vec2[], count: number): Vec2[] => {
  if (!polygon.length || count <= 0) return [];
  const segments: number[] = [];
  let totalLength = 0;
  for (let i = 0; i < polygon.length; i += 1) {
    const current = polygon[i];
    const next = polygon[(i + 1) % polygon.length];
    const len = distance(current, next);
    segments.push(len);
    totalLength += len;
  }
  if (totalLength === 0) {
    return Array.from({ length: count }, () => ({ ...polygon[0] }));
  }
  const samples: Vec2[] = [];
  for (let i = 0; i < count; i += 1) {
    const target = (i / count) * totalLength;
    let accumulated = 0;
    for (let seg = 0; seg < polygon.length; seg += 1) {
      const segLength = segments[seg];
      const nextAccum = accumulated + segLength;
      if (target <= nextAccum || seg === polygon.length - 1) {
        const t = segLength === 0 ? 0 : (target - accumulated) / segLength;
        const start = polygon[seg];
        const end = polygon[(seg + 1) % polygon.length];
        samples.push(lerp(start, end, Math.min(Math.max(t, 0), 1)));
        break;
      }
      accumulated = nextAccum;
    }
  }
  return samples;
};

export const resampleOpenPolyline = (polyline: Vec2[], count: number): Vec2[] => {
  if (!polyline.length || count <= 0) return [];
  if (count === 1) {
    return [{ ...polyline[0] }];
  }
  if (polyline.length === 1) {
    return Array.from({ length: count }, () => ({ ...polyline[0] }));
  }

  const segments: number[] = [];
  let totalLength = 0;
  for (let i = 0; i < polyline.length - 1; i += 1) {
    const current = polyline[i];
    const next = polyline[i + 1];
    const len = distance(current, next);
    segments.push(len);
    totalLength += len;
  }

  if (totalLength === 0) {
    return Array.from({ length: count }, (_, index) => ({ ...polyline[Math.min(index, polyline.length - 1)] }));
  }

  const samples: Vec2[] = [];
  for (let i = 0; i < count; i += 1) {
    const fraction = i / (count - 1);
    const target = fraction * totalLength;
    let accumulated = 0;
    for (let seg = 0; seg < segments.length; seg += 1) {
      const segLength = segments[seg];
      const nextAccum = accumulated + segLength;
      if (target <= nextAccum || seg === segments.length - 1) {
        const t = segLength === 0 ? 0 : (target - accumulated) / segLength;
        const start = polyline[seg];
        const end = polyline[seg + 1];
        samples.push(lerp(start, end, Math.min(Math.max(t, 0), 1)));
        break;
      }
      accumulated = nextAccum;
    }
  }

  return samples;
};
