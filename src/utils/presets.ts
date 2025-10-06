import { createId } from './ids';
import type { PathNode, Vec2 } from '../types';

export const createCircleNodes = (center: { x: number; y: number }, radius: number): PathNode[] => {
  const k = radius * 0.5522847498307936;
  return [
    {
      id: createId('node'),
      point: { x: center.x + radius, y: center.y },
      handleIn: { x: center.x + radius, y: center.y + k },
      handleOut: { x: center.x + radius, y: center.y - k },
    },
    {
      id: createId('node'),
      point: { x: center.x, y: center.y - radius },
      handleIn: { x: center.x + k, y: center.y - radius },
      handleOut: { x: center.x - k, y: center.y - radius },
    },
    {
      id: createId('node'),
      point: { x: center.x - radius, y: center.y },
      handleIn: { x: center.x - radius, y: center.y - k },
      handleOut: { x: center.x - radius, y: center.y + k },
    },
    {
      id: createId('node'),
      point: { x: center.x, y: center.y + radius },
      handleIn: { x: center.x - k, y: center.y + radius },
      handleOut: { x: center.x + k, y: center.y + radius },
    },
  ];
};

const HALF_PI = Math.PI / 2;

export const createArcNodes = (
  center: Vec2,
  radius: number,
  startAngle: number,
  sweep: number,
): PathNode[] => {
  const safeRadius = Math.max(0, radius);
  if (safeRadius === 0) {
    return [];
  }
  const segments = Math.max(1, Math.ceil(Math.abs(sweep) / HALF_PI));
  const delta = sweep / segments;
  const nodes: PathNode[] = [];
  let angle = startAngle;
  const startPoint = {
    x: center.x + Math.cos(angle) * safeRadius,
    y: center.y + Math.sin(angle) * safeRadius,
  };
  nodes.push({
    id: createId('node'),
    point: startPoint,
    handleIn: null,
    handleOut: null,
  });
  for (let i = 0; i < segments; i += 1) {
    const nextAngle = angle + delta;
    const p0 = nodes[nodes.length - 1];
    const p3 = {
      x: center.x + Math.cos(nextAngle) * safeRadius,
      y: center.y + Math.sin(nextAngle) * safeRadius,
    };
    const alpha = (4 / 3) * Math.tan(delta / 4);
    const handleOut = {
      x: p0.point.x - Math.sin(angle) * safeRadius * alpha,
      y: p0.point.y + Math.cos(angle) * safeRadius * alpha,
    };
    const handleIn = {
      x: p3.x + Math.sin(nextAngle) * safeRadius * alpha,
      y: p3.y - Math.cos(nextAngle) * safeRadius * alpha,
    };
    nodes[nodes.length - 1] = {
      ...p0,
      handleOut,
    };
    nodes.push({
      id: createId('node'),
      point: p3,
      handleIn,
      handleOut: null,
    });
    angle = nextAngle;
  }
  return nodes;
};
