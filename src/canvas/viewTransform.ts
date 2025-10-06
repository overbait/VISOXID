import type { Vec2 } from '../types';

export interface ViewTransform {
  scale: number;
  offsetX: number;
  offsetY: number;
  extent: number;
  zoom: number;
  originX: number;
  originY: number;
}

export const VIEW_EXTENT_UM = 50;

export const computeViewTransform = (
  width: number,
  height: number,
  zoom = 1,
  pan: Vec2 = { x: 0, y: 0 },
): ViewTransform => {
  const extent = VIEW_EXTENT_UM;
  const span = Math.max(Math.min(width, height), 1);
  const clampedZoom = Math.max(0.1, Math.min(zoom, 10));
  const scale = (span / extent) * clampedZoom || 1;
  const viewportExtent = extent / clampedZoom;
  const originX = pan.x;
  const originY = pan.y;
  const offsetX = (width - viewportExtent * scale) / 2 - originX * scale;
  const offsetY = (height - viewportExtent * scale) / 2 - originY * scale;
  return {
    scale: scale || 1,
    offsetX,
    offsetY,
    extent: viewportExtent,
    zoom: clampedZoom,
    originX,
    originY,
  };
};

export const worldToCanvas = (point: Vec2, view: ViewTransform): Vec2 => ({
  x: view.offsetX + (point.x - view.originX) * view.scale,
  y: view.offsetY + (point.y - view.originY) * view.scale,
});

export const canvasToWorld = (point: Vec2, view: ViewTransform): Vec2 => ({
  x: (point.x - view.offsetX) / view.scale + view.originX,
  y: (point.y - view.offsetY) / view.scale + view.originY,
});

export const worldDistanceToCanvas = (distance: number, view: ViewTransform): number =>
  distance * view.scale;

export const canvasDistanceToWorld = (distance: number, view: ViewTransform): number =>
  distance / view.scale;
