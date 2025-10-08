import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { evalThicknessForAngle } from '../geometry';
import type { DirectionWeight } from '../types';
import { useWorkspaceStore } from '../state';
import { createId } from '../utils/ids';

const CANVAS_SIZE = 260;
const OUTER_RADIUS = CANVAS_SIZE / 2 - 18;
const CENTER_DOT_RADIUS = 10;
const MIN_SPOKE_RADIUS = CENTER_DOT_RADIUS + 18;
const ADD_RING_INNER = OUTER_RADIUS - 20;
const ADD_RING_OUTER = OUTER_RADIUS + 14;

const clampValue = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, value);
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
  const ratio = Math.max(value / 10, 0);
  const maxRadius = OUTER_RADIUS - 24;
  return MIN_SPOKE_RADIUS + ratio * Math.max(maxRadius - MIN_SPOKE_RADIUS, 0);
};

const smallestAngleDelta = (a: number, b: number): number => {
  const diff = Math.abs(a - b) % 360;
  return diff > 180 ? 360 - diff : diff;
};

export const DirectionalCompass = () => {
  const defaults = useWorkspaceStore((state) => state.oxidationDefaults);
  const updateDefaults = useWorkspaceStore((state) => state.updateOxidationDefaults);
  const linking = useWorkspaceStore((state) => state.directionalLinking);
  const setLinking = useWorkspaceStore((state) => state.setDirectionalLinking);
  const openExportView = useWorkspaceStore((state) => state.openExportView);
  const oxidationProgress = useWorkspaceStore((state) => state.oxidationProgress);

  const activeWeights = defaults.thicknessByDirection.items;

  const activeUniform = defaults.thicknessUniformUm;
  const activeMirror = defaults.mirrorSymmetry;

  const sortedWeights = useMemo(() => sortByAngle(activeWeights), [activeWeights]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [addPreview, setAddPreview] = useState<{ angle: number; distance: number } | null>(null);

  const thicknessOptions = useMemo(
    () => ({
      uniformThickness: activeUniform,
      weights: sortedWeights,
      mirrorSymmetry: activeMirror,
      progress: oxidationProgress,
    }),
    [activeMirror, activeUniform, oxidationProgress, sortedWeights],
  );

  const previewData = useMemo(() => {
    const segments = Math.max(96, sortedWeights.length * 12, 160);
    const points: Array<{ x: number; y: number }> = [];
    let maxRadius = MIN_SPOKE_RADIUS;
    for (let i = 0; i < segments; i += 1) {
      const theta = (i / segments) * Math.PI * 2;
      const thickness = evalThicknessForAngle(theta, thicknessOptions);
      const radius = spokeRadiusForValue(thickness);
      maxRadius = Math.max(maxRadius, radius);
      points.push(polarToCartesian(theta, radius));
    }
    if (!points.length) {
      return { path: '', maxRadius: MIN_SPOKE_RADIUS };
    }
    const [first, ...rest] = points;
    const path = [
      `M ${first.x.toFixed(2)} ${first.y.toFixed(2)}`,
      ...rest.map((point) => `L ${point.x.toFixed(2)} ${point.y.toFixed(2)}`),
      'Z',
    ].join(' ');
    return { path, maxRadius };
  }, [sortedWeights, thicknessOptions]);

  const scaledUniform = clampValue(activeUniform * oxidationProgress);
  const uniformRadius = spokeRadiusForValue(scaledUniform);
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
    },
    [sortedWeights, updateDefaults],
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

  const handleAngleChange = useCallback(
    (id: string, value: number) => {
      applyWeights((items) => {
        const next = sortByAngle(items);
        const index = next.findIndex((item) => item.id === id);
        if (index === -1) return next;
        const angle = wrapAngle(value);
        if (
          next.some(
            (item, itemIndex) => itemIndex !== index && smallestAngleDelta(item.angleDeg, angle) < 0.5,
          )
        ) {
          return next;
        }
        next[index] = { ...next[index], angleDeg: angle };
        return sortByAngle(next);
      });
    },
    [applyWeights],
  );

  const handleLabelChange = useCallback(
    (id: string, value: string) => {
      const trimmed = value.trim().toUpperCase().slice(0, 2) || '?';
      applyWeights((items) => {
        const next = sortByAngle(items);
        const index = next.findIndex((item) => item.id === id);
        if (index === -1) return next;
        next[index] = { ...next[index], label: trimmed };
        return next;
      });
    },
    [applyWeights],
  );

  const selectedWeight = useMemo(
    () => sortedWeights.find((item) => item.id === selectedId) ?? null,
    [selectedId, sortedWeights],
  );

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
          <div className="text-xs text-muted">Global oxidation profile · {sortedWeights.length} headings</div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className={`flex h-9 w-9 items-center justify-center rounded-full border transition ${
              linking ? 'border-accent bg-accent/10 text-accent' : 'border-border text-muted hover:border-accent'
            }`}
            onClick={() => setLinking(!linking)}
            title={
              linking
                ? 'Proportional adjustments enabled'
                : 'Proportional adjustments disabled'
            }
            aria-label="Toggle proportional adjustments"
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
            {uniformRadius > CENTER_DOT_RADIUS && (
              <circle
                cx={CANVAS_SIZE / 2}
                cy={CANVAS_SIZE / 2}
                r={uniformRadius}
                fill="rgba(37, 99, 235, 0.04)"
                stroke="rgba(37, 99, 235, 0.25)"
                strokeWidth={1.5}
                strokeDasharray="6 6"
              />
            )}
            {previewData.path && (
              <path
                d={previewData.path}
                fill="rgba(37, 99, 235, 0.08)"
                stroke="rgba(37, 99, 235, 0.45)"
                strokeWidth={2}
                strokeLinejoin="round"
              />
            )}
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
          {adding && (
            <div className="pointer-events-none absolute inset-0 rounded-full border-2 border-dashed border-accent/40" />
          )}
        </div>
      </div>
      <div className="rounded-2xl border border-border/70 bg-white/80 p-4">
        {selectedWeight ? (
          <div className="flex flex-col gap-3 text-xs text-muted">
            <div className="flex items-center gap-2">
              <label className="flex w-20 flex-col text-[11px] font-semibold text-muted">
                Label
                <input
                  type="text"
                  maxLength={2}
                  value={selectedWeight.label}
                  onChange={(event) => handleLabelChange(selectedWeight.id, event.target.value)}
                  className="mt-1 rounded-full border border-border px-3 py-1 text-sm font-semibold text-text focus:border-accent focus:outline-none"
                />
              </label>
              <label className="flex min-w-0 flex-1 flex-col text-[11px] font-semibold text-muted">
                Angle (°)
                <input
                  type="number"
                  step={0.1}
                  value={selectedWeight.angleDeg.toFixed(1)}
                  onChange={(event) => handleAngleChange(selectedWeight.id, Number(event.target.value))}
                  className="mt-1 w-full rounded-full border border-border px-3 py-1 text-sm font-semibold text-text focus:border-accent focus:outline-none"
                />
              </label>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold text-muted">
              <span className="w-20 shrink-0">Thickness</span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="flex h-8 w-8 items-center justify-center rounded-full border border-border text-sm text-muted hover:border-accent hover:text-accent"
                  onClick={() => handleNudge(selectedWeight.id, -0.1)}
                >
                  –
                </button>
                <input
                  type="number"
                  min={0}
                  step={0.1}
                  value={selectedWeight.valueUm.toFixed(1)}
                  onChange={(event) => handleValueChange(selectedWeight.id, Number(event.target.value))}
                  className="w-24 rounded-full border border-border px-3 py-1 text-center text-sm font-semibold text-text focus:border-accent focus:outline-none"
                />
                <button
                  type="button"
                  className="flex h-8 w-8 items-center justify-center rounded-full border border-border text-sm text-muted hover:border-accent hover:text-accent"
                  onClick={() => handleNudge(selectedWeight.id, 0.1)}
                >
                  +
                </button>
              </div>
              <span className="shrink-0 text-[11px] text-muted">μm</span>
            </div>
            <div className="rounded-xl bg-accentSoft/40 px-3 py-2 text-[10px] text-muted">
              Delete removes the spoke. Angles wrap automatically; spokes cannot overlap closer than 0.5°.
            </div>
          </div>
        ) : (
          <div className="flex justify-center">
            <button
              type="button"
              className="rounded-full border border-border bg-white/80 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-accent shadow-sm transition hover:bg-white"
              onClick={openExportView}
            >
              Export view
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
