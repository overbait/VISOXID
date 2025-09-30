import { Bezier } from 'bezier-js';
import type { PathEntity, SamplePoint } from '../types';
import { add, normalize, perpendicular } from '../utils/math';

export interface AdaptiveSampleOptions {
  spacing: number;
  minSamples?: number;
}

export const adaptiveSamplePath = (
  path: PathEntity,
  options: AdaptiveSampleOptions,
): { samples: SamplePoint[]; length: number } => {
  const { spacing, minSamples = 12 } = options;
  const nodes = path.nodes;
  if (nodes.length < 2) {
    return { samples: [], length: 0 };
  }

  const samples: SamplePoint[] = [];
  let accumulatedLength = 0;
  const totalSegments = path.meta.closed ? nodes.length : nodes.length - 1;

  for (let i = 0; i < totalSegments; i += 1) {
    const current = nodes[i];
    const next = nodes[(i + 1) % nodes.length];
    const p0 = current.point;
    const p1 = current.handleOut ?? current.point;
    const p2 = next.handleIn ?? next.point;
    const p3 = next.point;

    const curve = new Bezier(p0.x, p0.y, p1.x, p1.y, p2.x, p2.y, p3.x, p3.y);
    const segmentLength = curve.length();
    const sampleCount = Math.max(minSamples, Math.ceil(segmentLength / spacing));
    for (let s = 0; s <= sampleCount; s += 1) {
      const t = s / sampleCount;
      if (samples.length && s === 0) {
        continue; // avoid duplicates between segments
      }
      const { x, y } = curve.get(t);
      const derivative = curve.derivative(t);
      const tangent = normalize({ x: derivative.x, y: derivative.y });
      const prevPoint = samples.at(-1);
      if (prevPoint) {
        accumulatedLength += Math.hypot(x - prevPoint.position.x, y - prevPoint.position.y);
      }
      const normal = perpendicular(tangent);
      samples.push({
        position: { x, y },
        tangent,
        normal,
        thickness: 0,
        curvature: estimateCurvature(curve, t),
        parameter: samples.length,
        segmentIndex: i,
      });
    }
  }

  if (!path.meta.closed && samples.length) {
    const lastNode = nodes[nodes.length - 1];
    samples[samples.length - 1].position = add({ x: 0, y: 0 }, lastNode.point);
  }

  return { samples, length: accumulatedLength };
};

export const samplePathWithUniformSubdivisions = (
  path: PathEntity,
  subdivisionsPerSegment: number,
): { samples: SamplePoint[]; length: number } => {
  const subdivisions = Math.max(1, Math.floor(subdivisionsPerSegment));
  const nodes = path.nodes;
  if (nodes.length < 2) {
    return { samples: [], length: 0 };
  }

  const samples: SamplePoint[] = [];
  let accumulatedLength = 0;
  const totalSegments = path.meta.closed ? nodes.length : nodes.length - 1;

  for (let i = 0; i < totalSegments; i += 1) {
    const current = nodes[i];
    const next = nodes[(i + 1) % nodes.length];
    const p0 = current.point;
    const p1 = current.handleOut ?? current.point;
    const p2 = next.handleIn ?? next.point;
    const p3 = next.point;

    const curve = new Bezier(p0.x, p0.y, p1.x, p1.y, p2.x, p2.y, p3.x, p3.y);

    for (let step = 0; step <= subdivisions; step += 1) {
      const t = subdivisions <= 1 ? step : step / subdivisions;
      if (samples.length && step === 0) {
        continue;
      }
      const { x, y } = curve.get(t);
      const derivative = curve.derivative(t);
      let tangent = normalize({ x: derivative.x, y: derivative.y });
      if (!Number.isFinite(tangent.x) || !Number.isFinite(tangent.y)) {
        const fallback = samples.at(-1)?.tangent;
        tangent = fallback ?? { x: 1, y: 0 };
      }
      const prevPoint = samples.at(-1);
      if (prevPoint) {
        accumulatedLength += Math.hypot(x - prevPoint.position.x, y - prevPoint.position.y);
      }
      const normal = perpendicular(tangent);
      samples.push({
        position: { x, y },
        tangent,
        normal,
        thickness: 0,
        curvature: estimateCurvature(curve, t),
        parameter: samples.length,
        segmentIndex: i,
      });
    }
  }

  return { samples, length: accumulatedLength };
};

const estimateCurvature = (curve: Bezier, t: number): number => {
  const d = curve.derivative(t);
  const eps = 1e-3;
  const ahead = curve.derivative(Math.min(1, t + eps));
  const behind = curve.derivative(Math.max(0, t - eps));
  const dd = {
    x: (ahead.x - behind.x) / (2 * eps),
    y: (ahead.y - behind.y) / (2 * eps),
  };
  const numerator = d.x * dd.y - d.y * dd.x;
  const denominator = Math.pow(d.x * d.x + d.y * d.y, 1.5) || 1;
  return numerator / denominator;
};
