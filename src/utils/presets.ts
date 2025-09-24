import { createId } from './ids';
import type { PathNode } from '../types';

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
