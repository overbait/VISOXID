import { useCallback, useEffect, useMemo, useState, type MouseEvent as ReactMouseEvent } from 'react';
import type { DirectionWeight } from '../types';
import { useWorkspaceStore } from '../state';
import { createId } from '../utils/ids';

const CANVAS_SIZE = 240;
const RADIUS = CANVAS_SIZE / 2 - 28;

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

  const [hoverState, setHoverState] = useState<{ angle: number; distance: number } | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

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
        next[index] = { ...next[index], valueUm: clampValue(value) };
        if (linking && next.length > 1) {
          const prevIndex = (index - 1 + next.length) % next.length;
          const nextIndex = (index + 1) % next.length;
          const adjusted = next[index].valueUm;
          next[prevIndex] = { ...next[prevIndex], valueUm: (next[prevIndex].valueUm + adjusted) / 2 };
          next[nextIndex] = { ...next[nextIndex], valueUm: (next[nextIndex].valueUm + adjusted) / 2 };
        }
        return next;
      });
    },
    [applyWeights, linking],
  );

  const handleLabelChange = useCallback(
    (id: string, label: string) => {
      applyWeights((items) =>
        items.map((item) => (item.id === id ? { ...item, label: label.slice(0, 2).toUpperCase() || '?' } : item)),
      );
    },
    [applyWeights],
  );

  const handleAddDirection = useCallback(() => {
    if (!hoverState || hoverState.distance < 18) return;
    applyWeights((items) => {
      const next = sortByAngle(items);
      const angle = wrapAngle(hoverState.angle);
      const insertIndex = next.findIndex((item) => angle < item.angleDeg);
      const label = nextLabel(next);
      const newWeight: DirectionWeight = {
        id: createId('dir'),
        label,
        angleDeg: angle,
        valueUm: 0,
      };
      const targetIndex = insertIndex === -1 ? next.length : insertIndex;
      next.splice(targetIndex, 0, newWeight);
      if (linking && next.length > 1) {
        const prevIndex = (targetIndex - 1 + next.length) % next.length;
        const nextIndex = (targetIndex + 1) % next.length;
        const average = (next[prevIndex].valueUm + next[nextIndex].valueUm) / 2;
        next[targetIndex] = { ...newWeight, valueUm: average };
      }
      return next;
    });
  }, [applyWeights, hoverState, linking]);

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

  const handleCompassMouseMove = (event: ReactMouseEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = event.clientX - cx;
    const dy = event.clientY - cy;
    const distance = Math.hypot(dx, dy);
    if (distance > RADIUS) {
      setHoverState(null);
      return;
    }
    const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
    setHoverState({ angle, distance });
  };

  const handleCompassLeave = () => {
    setHoverState(null);
  };

  return (
    <div className="panel flex flex-col gap-4 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="section-title">Directional weights</div>
          <div className="text-xs text-muted">
            {selectedPath ? selectedPath.meta.name : 'Scene defaults'} · {sortedWeights.length} headings
          </div>
        </div>
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
      </div>
      <div className="mx-auto flex flex-col items-center gap-3 text-xs text-muted">
        <div
          className="relative flex items-center justify-center"
          style={{ width: CANVAS_SIZE, height: CANVAS_SIZE }}
        >
          <div
            className="absolute inset-0 rounded-full border border-border bg-white/70"
            onMouseMove={handleCompassMouseMove}
            onMouseLeave={handleCompassLeave}
            onClick={handleAddDirection}
          />
          {hoverState && (
            <div
              className="pointer-events-none absolute left-1/2 top-1/2 h-[2px] rounded bg-accent/70"
              style={{
                width: RADIUS,
                transform: `translate(-50%, -50%) rotate(${hoverState!.angle}deg)`,
              }}
            />
          )}
          {sortedWeights.map((weight) => {
            const angleRad = toRadians(weight.angleDeg);
            const x = CANVAS_SIZE / 2 + Math.cos(angleRad) * (RADIUS - 4);
            const y = CANVAS_SIZE / 2 + Math.sin(angleRad) * (RADIUS - 4);
            const isSelected = selectedId === weight.id;
            return (
              <div
                key={weight.id}
                className="absolute flex w-24 -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1"
                style={{ left: x, top: y }}
              >
                <input
                  type="text"
                  value={weight.label}
                  maxLength={2}
                  className={`w-10 rounded-full border px-2 py-1 text-center text-[11px] font-semibold uppercase shadow focus:border-accent focus:outline-none ${
                    isSelected ? 'border-accent text-accent' : 'border-border text-text'
                  }`}
                  onFocus={() => setSelectedId(weight.id)}
                  onClick={(event) => {
                    event.stopPropagation();
                    setSelectedId(weight.id);
                  }}
                  onChange={(event) => handleLabelChange(weight.id, event.target.value)}
                />
                <input
                  type="number"
                  step={0.1}
                  min={0}
                  max={10}
                  value={weight.valueUm.toFixed(1)}
                  className={`w-full rounded-full border px-2 py-1 text-center text-[11px] shadow focus:border-accent focus:outline-none ${
                    isSelected ? 'border-accent text-accent' : 'border-border text-text'
                  }`}
                  onClick={(event) => event.stopPropagation()}
                  onFocus={() => setSelectedId(weight.id)}
                  onChange={(event) => handleValueChange(weight.id, Number(event.target.value))}
                />
              </div>
            );
          })}
          <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent/10 px-3 py-1 text-[10px] font-semibold text-accent">
            Add direction
          </div>
        </div>
        <div className="text-center text-[11px] text-muted">
          Click inside the ring to insert a new heading. Select a label and press Delete to remove it
          (minimum of two directions).
        </div>
      </div>
    </div>
  );
};
