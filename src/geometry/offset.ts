// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - clipper-lib lacks ESM typings
import ClipperLib from 'clipper-lib';
import type { Vec2 } from '../types';

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
  ClipperOffset: new (miterLimit?: number, arcTolerance?: number) => {
    AddPath(path: IntPoint[], joinType: number, endType: number): void;
    Execute(delta: number): IntPoint[][];
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
  const solution = offset.Execute(delta * SCALE);
  return solution.map((poly) => poly.map((pt) => ({ x: pt.X / SCALE, y: pt.Y / SCALE })));
};
