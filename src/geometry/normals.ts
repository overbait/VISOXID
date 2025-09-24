import type { SamplePoint } from '../types';
import { add, normalize, scale, sub } from '../utils/math';

const isZero = (vector: { x: number; y: number }): boolean =>
  Math.abs(vector.x) <= 1e-6 && Math.abs(vector.y) <= 1e-6;

const normaliseTangent = (candidate: { x: number; y: number }): { x: number; y: number } => {
  const normalised = normalize(candidate);
  if (!isZero(normalised)) {
    return normalised;
  }
  return { x: 1, y: 0 };
};

export const recomputeNormals = (samples: SamplePoint[], window = 1): SamplePoint[] => {
  if (!samples.length) return samples;
  const result = samples.map((sample) => ({ ...sample }));

  if (samples.length === 1) {
    const tangent = normaliseTangent(samples[0].tangent);
    result[0].tangent = tangent;
    result[0].normal = { x: -tangent.y, y: tangent.x };
    return result;
  }

  const start = samples[0].position;
  const end = samples[samples.length - 1].position;
  const closingDistanceSq = (start.x - end.x) ** 2 + (start.y - end.y) ** 2;
  const isClosed = closingDistanceSq < 1e-6;

  const baseTangents = samples.map((sample, index) => {
    if (!isClosed) {
      if (index === 0 && samples.length > 1) {
        const forward = normalize(sub(samples[1].position, sample.position));
        if (!isZero(forward)) return forward;
      }
      if (index === samples.length - 1 && samples.length > 1) {
        const backward = normalize(sub(sample.position, samples[index - 1].position));
        if (!isZero(backward)) return backward;
      }
    }

    const prevIndex = index === 0 ? (isClosed ? samples.length - 1 : index) : index - 1;
    const nextIndex = index === samples.length - 1 ? (isClosed ? 0 : index) : index + 1;

    let delta = { x: 0, y: 0 };
    if (prevIndex !== index && nextIndex !== index) {
      delta = sub(samples[nextIndex].position, samples[prevIndex].position);
    } else if (nextIndex !== index) {
      delta = sub(samples[nextIndex].position, sample.position);
    } else if (prevIndex !== index) {
      delta = sub(sample.position, samples[prevIndex].position);
    }

    if (!isZero(delta)) {
      return normaliseTangent(delta);
    }

    const fallback = normaliseTangent(sample.tangent);
    return fallback;
  });

  const smoothWindow = Math.max(0, Math.floor(window));

  for (let i = 0; i < samples.length; i += 1) {
    let accumulated = { x: 0, y: 0 };
    let count = 0;
    for (let offset = -smoothWindow; offset <= smoothWindow; offset += 1) {
      const index = i + offset;
      if (index < 0 || index >= samples.length) continue;
      accumulated = add(accumulated, baseTangents[index]);
      count += 1;
    }

    let tangent = count > 0 ? normalize(accumulated) : baseTangents[i];
    if (isZero(tangent)) {
      tangent = baseTangents[i];
    }

    if (isZero(tangent)) {
      tangent = { x: 1, y: 0 };
    }

    result[i].tangent = tangent;
    result[i].normal = { x: -tangent.y, y: tangent.x };
  }

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
