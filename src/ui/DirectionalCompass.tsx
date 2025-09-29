import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type { DirectionWeight } from '../types';
import { useWorkspaceStore } from '../state';
import { createId } from '../utils/ids';

const CANVAS_SIZE = 260;
const OUTER_RADIUS = CANVAS_SIZE / 2 - 18;
const CENTER_DOT_RADIUS = 10;
const MIN_SPOKE_RADIUS = CENTER_DOT_RADIUS + 18;
const INNER_CLEAR_RADIUS = MIN_SPOKE_RADIUS + 16;
const ADD_RING_INNER = OUTER_RADIUS - 20;
const ADD_RING_OUTER = OUTER_RADIUS + 14;

const clampValue = (value: number): number => {
  if (Number.isNaN(value)) return 0;
  return Math.min(10, Math.max(0, value));
};

const wrapAngle = (angleDeg: number): number => {
  let wrapped = angleDeg % 360;
  if (wrapped < 0) wrapped += 360;
  return wrapped;
};

const toRadians = (deg: number): number => (deg * Math.PI) / 180;

const sortByAngle = (items: DirectionWeight[]): DirectionWeight[] =>
  [...items].sort((a, b) => a.angleDeg - b.angleDeg);

const nextLabel = (items: DirectionWeight[]): string => {
  const used = new Set(items.map((item) => item.label));
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  for (const char of alphabet) {
    if (!used.has(char)) {
      return char;
    }
  }
  return `D${items.length + 1}`;
};

const polarToCartesian = (angleRad: number, radius: number): { x: number; y: number } => ({
  x: CANVAS_SIZE / 2 + Math.cos(angleRad) * radius,
  y: CANVAS_SIZE / 2 + Math.sin(angleRad) * radius,
});

const interpolate = (start: number[], end: number[], t: number): number[] => [
  start[0] + (end[0] - start[0]) * t,
  start[1] + (end[1] - start[1]) * t,
  start[2] + (end[2] - start[2]) * t,
];

const gradientStops: { stop: number; color: number[] }[] = [
  { stop: 0, color: [37, 99, 235] },
  { stop: 0.35, color: [34, 197, 94] },
  { stop: 0.7, color: [250, 204, 21] },
  { stop: 1, color: [239, 68, 68] },
];

const valueToColor = (value: number): string => {
  const t = Math.min(Math.max(value / 10, 0), 1);
  for (let i = 0; i < gradientStops.length - 1; i += 1) {
    const current = gradientStops[i];
    const next = gradientStops[i + 1];
    if (t >= current.stop && t <= next.stop) {
      const span = (t - current.stop) / (next.stop - current.stop || 1);
      const [r, g, b] = interpolate(current.color, next.color, span);
      return `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;
    }
  }
  const last = gradientStops.at(-1)!;
  return `rgb(${last.color.map((c) => Math.round(c)).join(', ')})`;
};

const spokeRadiusForValue = (value: number): number => {
  const ratio = Math.min(Math.max(value / 10, 0), 1);
  const maxRadius = OUTER_RADIUS - 24;
  return MIN_SPOKE_RADIUS + ratio * Math.max(maxRadius - MIN_SPOKE_RADIUS, 0);
};

const smallestAngleDelta = (a: number, b: number): number => {
  const diff = Math.abs(a - b) % 360;
  return diff > 180 ? 360 - diff : diff;
};

export const DirectionalCompass = () => {
  const defaults = useWorkspaceStore((state) => state.oxidationDefaults);
  const selectedPath = useWorkspaceStore((state) => {
    const first = state.selectedPathIds[0];
    return first ? state.paths.find((path) => path.meta.id === first) ?? null : null;
  });
  const updateDefaults = useWorkspaceStore((state) => state.updateOxidationDefaults);
  const updateSelected = useWorkspaceStore((state) => state.updateSelectedOxidation);
  const linking = useWorkspaceStore((state) => state.directionalLinking);
  const setLinking = useWorkspaceStore((state) => state.setDirectionalLinking);

  const activeWeights = selectedPath
    ? selectedPath.oxidation.thicknessByDirection.items
    : defaults.thicknessByDirection.items;

  const sortedWeights = useMemo(() => sortByAngle(activeWeights), [activeWeights]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [addPreview, setAddPreview] = useState<{ angle: number; distance: number } | null>(null);

  useEffect(() => {
    if (selectedId && !sortedWeights.some((weight) => weight.id === selectedId)) {
      setSelectedId(null);
    }
  }, [selectedId, sortedWeights]);

  const applyWeights = useCallback(
    (updater: (items: DirectionWeight[]) => DirectionWeight[]) => {
      const nextItems = updater(sortedWeights.map((item) => ({ ...item })));
      updateDefaults({
        thicknessByDirection: {
          items: nextItems,
        },
      });
      if (selectedPath) {
        updateSelected({
          thicknessByDirection: {
            items: nextItems,
          },
        });
      }
    },
    [sortedWeights, selectedPath, updateDefaults, updateSelected],
  );

  const handleValueChange = useCallback(
    (id: string, value: number) => {
      applyWeights((items) => {
        const next = sortByAngle(items);
        const index = next.findIndex((item) => item.id === id);
        if (index === -1) return next;
        const clamped = clampValue(value);
        if (linking && next.length > 0) {
          const delta = clamped - next[index].valueUm;
          return next.map((item) => ({
            ...item,
            valueUm: clampValue(item.valueUm + delta),
          }));
        }
        next[index] = { ...next[index], valueUm: clamped };
        return next;
      });
    },
    [applyWeights, linking],
  );

  const handleAddDirection = useCallback(
    (angleDeg: number) => {
      let createdId: string | null = null;
      applyWeights((items) => {
        const next = sortByAngle(items);
        const angle = wrapAngle(angleDeg);
        if (next.some((item) => smallestAngleDelta(item.angleDeg, angle) < 0.5)) {
          return next;
        }
        const insertIndex = next.findIndex((item) => angle < item.angleDeg);
        const label = nextLabel(next);
        const baseValue = next.length
          ? next.reduce((sum, item) => sum + item.valueUm, 0) / next.length
          : 0;
        const newWeight: DirectionWeight = {
          id: createId('dir'),
          label,
          angleDeg: angle,
          valueUm: linking ? baseValue : 0,
        };
        createdId = newWeight.id;
        const targetIndex = insertIndex === -1 ? next.length : insertIndex;
        next.splice(targetIndex, 0, newWeight);
        return next;
      });
      if (createdId) {
        setSelectedId(createdId);
      }
    },
    [applyWeights, linking],
  );

  const handleRemove = useCallback(
    (id: string) => {
      applyWeights((items) => {
        if (items.length <= 2) {
          return items;
        }
        return items.filter((item) => item.id !== id);
      });
    },
    [applyWeights],
  );

  useEffect(() => {
    if (!selectedId) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.key === 'Delete' || event.key === 'Backspace') && selectedId) {
        event.preventDefault();
        handleRemove(selectedId);
        setSelectedId(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleRemove, selectedId]);

  const updateAddPreview = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!adding) return;
      const rect = event.currentTarget.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const dx = event.clientX - cx;
      const dy = event.clientY - cy;
      const distance = Math.hypot(dx, dy);
      if (distance < ADD_RING_INNER || distance > ADD_RING_OUTER) {
        setAddPreview(null);
        return;
      }
      const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
      setAddPreview({ angle, distance });
    },
    [adding],
  );

  const clearAddPreview = useCallback(() => {
    setAddPreview(null);
  }, []);

  const handleBackgroundPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!adding) {
        setSelectedId(null);
        return;
      }
      const rect = event.currentTarget.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const dx = event.clientX - cx;
      const dy = event.clientY - cy;
      const distance = Math.hypot(dx, dy);
      if (distance < ADD_RING_INNER || distance > ADD_RING_OUTER) {
        setAddPreview(null);
        return;
      }
      const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
      handleAddDirection(wrapAngle(angle));
      setAddPreview(null);
      setAdding(false);
      event.stopPropagation();
    },
    [adding, handleAddDirection],
  );

  const handleSpokePointerDown = useCallback(
    (id: string, event: ReactPointerEvent<SVGLineElement>) => {
      event.stopPropagation();
      setAdding(false);
      setSelectedId(id);
    },
    [],
  );

  const handleNudge = useCallback(
    (id: string, delta: number) => {
      const weight = sortedWeights.find((item) => item.id === id);
      if (!weight) return;
      handleValueChange(id, weight.valueUm + delta);
    },
    [handleValueChange, sortedWeights],
  );

  const selectedWeight = useMemo(
    () => sortedWeights.find((item) => item.id === selectedId) ?? null,
    [selectedId, sortedWeights],
  );

  const selectedPopover = useMemo(() => {
    if (!selectedWeight) return null;
    const angleRad = toRadians(selectedWeight.angleDeg);
    const radius = spokeRadiusForValue(selectedWeight.valueUm);
    const anchorRadius = Math.max(radius + 24, INNER_CLEAR_RADIUS + 12);
    const anchor = polarToCartesian(angleRad, anchorRadius);
    return { anchor, weight: selectedWeight };
  }, [selectedWeight]);

  useEffect(() => {
    if (!adding) {
      setAddPreview(null);
    }
  }, [adding]);

  return (
    <div className="panel flex flex-col gap-4 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="section-title">Directional weights</div>
          <div className="text-xs text-muted">
            {selectedPath ? selectedPath.meta.name : 'Scene defaults'} · {sortedWeights.length} headings
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className={`flex h-9 w-9 items-center justify-center rounded-full border transition ${
              linking ? 'border-accent bg-accent/10 text-accent' : 'border-border text-muted hover:border-accent'
            }`}
            onClick={() => setLinking(!linking)}
            title={linking ? 'Linked adjustments enabled' : 'Linked adjustments disabled'}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
              <path
                d="M6.2 5.2a2 2 0 0 1 2.8 0l.8.8a2 2 0 0 1 0 2.8l-.7.7"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M9.8 10.8a2 2 0 0 1-2.8 0l-.8-.8a2 2 0 0 1 0-2.8l.7-.7"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          <button
            type="button"
            className={`flex h-9 w-9 items-center justify-center rounded-full border transition ${
              adding ? 'border-accent bg-accent/10 text-accent' : 'border-border text-muted hover:border-accent'
            }`}
            onClick={() => setAdding((value) => !value)}
            title={adding ? 'Click the rim to place a heading' : 'Add new heading'}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
              <path
                d="M8 3v10M3 8h10"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
      </div>
      <div className="mx-auto flex flex-col items-center gap-3 text-xs text-muted">
        <div
          className="relative flex items-center justify-center"
          style={{ width: CANVAS_SIZE, height: CANVAS_SIZE }}
          onPointerMove={updateAddPreview}
          onPointerLeave={clearAddPreview}
          onPointerDown={handleBackgroundPointerDown}
        >
          <svg
            width={CANVAS_SIZE}
            height={CANVAS_SIZE}
            className="pointer-events-none"
            viewBox={`0 0 ${CANVAS_SIZE} ${CANVAS_SIZE}`}
          >
            <circle
              cx={CANVAS_SIZE / 2}
              cy={CANVAS_SIZE / 2}
              r={OUTER_RADIUS}
              fill="rgba(255,255,255,0.7)"
              stroke="#dbe1ea"
              strokeWidth={2}
            />
            <circle
              cx={CANVAS_SIZE / 2}
              cy={CANVAS_SIZE / 2}
              r={CENTER_DOT_RADIUS}
              fill="rgba(37, 99, 235, 0.15)"
              stroke="rgba(37, 99, 235, 0.4)"
              strokeWidth={2}
            />
            <circle
              cx={CANVAS_SIZE / 2}
              cy={CANVAS_SIZE / 2}
              r={INNER_CLEAR_RADIUS}
              fill="rgba(255,255,255,0.85)"
              stroke="rgba(37, 99, 235, 0.18)"
              strokeWidth={1}
              strokeDasharray="10 10"
            />
            {[0, 45, 90, 135, 180, 225, 270, 315].map((angle) => {
              const rad = toRadians(angle);
              const inner = polarToCartesian(rad, OUTER_RADIUS - 12);
              const outer = polarToCartesian(rad, OUTER_RADIUS - 2);
              return (
                <line
                  key={`tick-${angle}`}
                  x1={inner.x}
                  y1={inner.y}
                  x2={outer.x}
                  y2={outer.y}
                  stroke="rgba(37, 99, 235, 0.35)"
                  strokeWidth={2}
                  strokeLinecap="round"
                />
              );
            })}
            {addPreview && (
              <line
                x1={polarToCartesian(toRadians(addPreview.angle), CENTER_DOT_RADIUS).x}
                y1={polarToCartesian(toRadians(addPreview.angle), CENTER_DOT_RADIUS).y}
                x2={polarToCartesian(toRadians(addPreview.angle), spokeRadiusForValue(5)).x}
                y2={polarToCartesian(toRadians(addPreview.angle), spokeRadiusForValue(5)).y}
                stroke="#2563eb"
                strokeWidth={5}
                strokeLinecap="round"
                opacity={0.4}
              />
            )}
            {sortedWeights.map((weight) => {
              const angleRad = toRadians(weight.angleDeg);
              const radius = spokeRadiusForValue(weight.valueUm);
              const start = polarToCartesian(angleRad, CENTER_DOT_RADIUS);
              const end = polarToCartesian(angleRad, radius);
              const color = valueToColor(weight.valueUm);
              const isSelected = selectedId === weight.id;
              return (
                <g key={weight.id} className="pointer-events-auto">
                  <line
                    x1={start.x}
                    y1={start.y}
                    x2={end.x}
                    y2={end.y}
                    stroke={color}
                    strokeWidth={isSelected ? 7 : 5}
                    strokeLinecap="round"
                    className="cursor-pointer transition-all duration-150"
                    onPointerDown={(event) => handleSpokePointerDown(weight.id, event)}
                  />
                </g>
              );
            })}
          </svg>
          <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-[10px] font-semibold text-accent">
            0
          </div>
          {selectedPopover && (
            <div
              className="pointer-events-auto absolute flex -translate-x-1/2 -translate-y-1/2 flex-col gap-2 rounded-2xl border border-border bg-white/95 p-3 shadow"
              style={{ left: selectedPopover.anchor.x, top: selectedPopover.anchor.y }}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <div className="flex items-center justify-between gap-3 text-[11px] font-semibold text-muted">
                <span>{selectedPopover.weight.label}</span>
                <span>{selectedPopover.weight.angleDeg.toFixed(1)}°</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="flex h-7 w-7 items-center justify-center rounded-full border border-border text-sm text-muted hover:border-accent hover:text-accent"
                  onClick={() => handleNudge(selectedPopover.weight.id, -0.1)}
                >
                  –
                </button>
                <input
                  type="number"
                  min={0}
                  max={10}
                  step={0.1}
                  value={selectedPopover.weight.valueUm.toFixed(1)}
                  onChange={(event) =>
                    handleValueChange(selectedPopover.weight.id, Number(event.target.value))
                  }
                  className="w-20 rounded-full border border-border px-3 py-1 text-center text-sm font-semibold text-text focus:border-accent focus:outline-none"
                />
                <button
                  type="button"
                  className="flex h-7 w-7 items-center justify-center rounded-full border border-border text-sm text-muted hover:border-accent hover:text-accent"
                  onClick={() => handleNudge(selectedPopover.weight.id, 0.1)}
                >
                  +
                </button>
              </div>
              <div className="text-[10px] text-muted">Press Delete to remove · value in μm</div>
            </div>
          )}
          {adding && (
            <div className="pointer-events-none absolute inset-0 rounded-full border-2 border-dashed border-accent/40" />
          )}
        </div>
        <div className="text-center text-[11px] text-muted">
          Click a spoke to adjust its μm offset. Enable the chain to move every heading together. Toggle the plus icon and click
          the outer rim to add a new heading.
        </div>
      </div>
    </div>
  );
};
