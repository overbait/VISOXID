import type { WorkspaceState } from '../types';
import { drawGrid } from './grid';
import { drawContours } from './contours';
import { drawHandles } from './handles';
import { drawHeatmap } from './heatmap';
import { drawSnaps } from './snaps';
import { drawMeasurements } from './measurements';
import { drawMirrorAxes } from './mirror';

export type StateGetter = () => WorkspaceState;

export class CanvasRenderer {
  private ctx: CanvasRenderingContext2D;

  private frameId: number | null = null;

  private observer: ResizeObserver;

  private dpr = window.devicePixelRatio ?? 1;

  private canvas: HTMLCanvasElement;

  private getState: StateGetter;

  constructor(canvas: HTMLCanvasElement, getState: StateGetter) {
    this.canvas = canvas;
    this.getState = getState;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Canvas context could not be created');
    }
    this.ctx = ctx;
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(canvas);
    this.resize();
  }

  start(): void {
    if (this.frameId !== null) return;
    const loop = () => {
      this.frameId = window.requestAnimationFrame(loop);
      this.render();
    };
    this.frameId = window.requestAnimationFrame(loop);
  }

  stop(): void {
    if (this.frameId !== null) {
      cancelAnimationFrame(this.frameId);
      this.frameId = null;
    }
    this.observer.disconnect();
  }

  private resize(): void {
    const { width, height } = this.canvas.getBoundingClientRect();
    const pixelWidth = Math.max(1, Math.floor(width * this.dpr));
    const pixelHeight = Math.max(1, Math.floor(height * this.dpr));
    if (this.canvas.width !== pixelWidth || this.canvas.height !== pixelHeight) {
      this.canvas.width = pixelWidth;
      this.canvas.height = pixelHeight;
      this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    }
  }

  private render(): void {
    const state = this.getState();
    const { width, height } = this.canvas;
    this.ctx.save();
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.ctx.clearRect(0, 0, width, height);
    const logicalWidth = width / this.dpr;
    const logicalHeight = height / this.dpr;
    drawGrid(this.ctx, logicalWidth, logicalHeight, state.grid);
    drawMirrorAxes(this.ctx, logicalWidth, logicalHeight, state.mirror);
    const showHeatmap = state.measurements.showHeatmap;
    state.paths.forEach((path) => {
      const selected = state.selectedPathIds.includes(path.meta.id);
      if (showHeatmap) {
        drawHeatmap(this.ctx, path);
      }
      drawContours(this.ctx, path, selected);
      drawHandles(this.ctx, path, selected);
    });
    drawSnaps(this.ctx, state.paths, state.measurements);
    drawMeasurements(this.ctx, state.measurements);
    this.ctx.restore();
  }
}

export const createRenderer = (
  canvas: HTMLCanvasElement,
  getState: StateGetter,
): CanvasRenderer => new CanvasRenderer(canvas, getState);
