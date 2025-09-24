// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - clipper-lib lacks ESM typings
import ClipperLib from 'clipper-lib';
import type { SampledPath, Vec2 } from '../types';
import { scale, sub } from '../utils/math';

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

export const computeVariableOffset = (sampledPath: SampledPath): Vec2[][] => {
  if (!sampledPath.samples.length) return [];

  const rawOffsetPoints = sampledPath.samples.map((p) =>
    sub(p.position, scale(p.normal, p.thickness)),
  );

  // Use the standard 'computeOffset' with a zero delta as a cleaning operation.
  // This asks clipper-lib to resolve self-intersections and fix winding order.
  return computeOffset(rawOffsetPoints, { delta: 0, joinStyle: 'round' });
};
