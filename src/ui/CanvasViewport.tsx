import { useEffect, useRef, type PointerEvent } from 'react';
import { createRenderer } from '../canvas/renderer';
import { useWorkspaceStore } from '../state';
import { createId } from '../utils/ids';
import { distance, toDegrees } from '../utils/math';
import type { Vec2 } from '../types';

export const CanvasViewport = () => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const activeTool = useWorkspaceStore((state) => state.activeTool);
  const setProbe = useWorkspaceStore((state) => state.setProbe);
  const addProbe = useWorkspaceStore((state) => state.addProbe);
  const measurements = useWorkspaceStore((state) => state.measurements);
  const measureStart = useRef<Vec2 | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const renderer = createRenderer(canvas, () => useWorkspaceStore.getState());
    renderer.start();
    return () => renderer.stop();
  }, []);

  const getPointerPos = (event: PointerEvent<HTMLCanvasElement>): Vec2 => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
  };

  const handlePointerDown = (event: PointerEvent<HTMLCanvasElement>) => {
    if (activeTool !== 'measure') return;
    const position = getPointerPos(event);
    const probe = {
      id: createId('probe'),
      a: position,
      b: position,
      distance: 0,
      angleDeg: 0,
    };
    measureStart.current = position;
    setProbe(probe);
  };

  const handlePointerMove = (event: PointerEvent<HTMLCanvasElement>) => {
    if (activeTool !== 'measure' || !measureStart.current || !measurements.activeProbe) return;
    const pos = getPointerPos(event);
    const dist = distance(measureStart.current, pos);
    const angle = toDegrees(Math.atan2(pos.y - measureStart.current.y, pos.x - measureStart.current.x));
    setProbe({
      ...measurements.activeProbe,
      b: pos,
      distance: dist,
      angleDeg: angle,
    });
  };

  const handlePointerUp = () => {
    if (activeTool !== 'measure' || !measurements.activeProbe) return;
    addProbe(measurements.activeProbe);
    measureStart.current = null;
  };

  return (
    <div className="relative h-full w-full overflow-hidden rounded-3xl border border-border bg-surface shadow-panel">
      <canvas
        ref={canvasRef}
        className="h-full w-full touch-none"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
      />
      {activeTool === 'measure' && (
        <div className="pointer-events-none absolute left-4 top-4 rounded-xl bg-white/90 px-3 py-2 text-xs font-medium text-muted shadow">Click & drag to measure</div>
      )}
    </div>
  );
};
