import type { SamplePoint } from '../types';
import { add, normalize, scale } from '../utils/math';

export const recomputeNormals = (samples: SamplePoint[], window = 2): SamplePoint[] => {
  if (!samples.length) return samples;
  const result = samples.map((sample) => ({ ...sample }));
  for (let i = 0; i < samples.length; i += 1) {
    const start = Math.max(0, i - window);
    const end = Math.min(samples.length - 1, i + window);
    let tangent = { x: 0, y: 0 };
    for (let j = start; j <= end; j += 1) {
      tangent = add(tangent, samples[j].tangent);
    }
    const averaged = normalize(tangent);
    result[i].tangent = averaged;
    result[i].normal = { x: -averaged.y, y: averaged.x };
  }

  const start = samples[0].position;
  const end = samples[samples.length - 1].position;
  const closingDistanceSq = (start.x - end.x) ** 2 + (start.y - end.y) ** 2;
  const isClosed = closingDistanceSq < 1e-6;
  if (!isClosed) {
    return result;
  }

  const centroid = scale(
    samples.reduce((acc, sample) => add(acc, sample.position), { x: 0, y: 0 }),
    1 / samples.length,
  );

  let normalAlignment = 0;
  for (const sample of result) {
    const toSample = {
      x: sample.position.x - centroid.x,
      y: sample.position.y - centroid.y,
    };
    normalAlignment += sample.normal.x * toSample.x + sample.normal.y * toSample.y;
  }

  if (normalAlignment < 0) {
    for (const sample of result) {
      sample.normal = { x: -sample.normal.x, y: -sample.normal.y };
    }
  }

  return result;
};

export const accumulateLength = (samples: SamplePoint[]): number => {
  let length = 0;
  for (let i = 1; i < samples.length; i += 1) {
    const dx = samples[i].position.x - samples[i - 1].position.x;
    const dy = samples[i].position.y - samples[i - 1].position.y;
    length += Math.hypot(dx, dy);
  }
  return length;
};
