import { useMemo } from 'react';
import type { DirKey } from '../types';
import { useWorkspaceStore } from '../state';

const DIRECTIONS: Array<{ dir: DirKey; angle: number; label: string }> = [
  { dir: 'N', angle: -90, label: 'N' },
  { dir: 'NE', angle: -45, label: 'NE' },
  { dir: 'E', angle: 0, label: 'E' },
  { dir: 'SE', angle: 45, label: 'SE' },
  { dir: 'S', angle: 90, label: 'S' },
  { dir: 'SW', angle: 135, label: 'SW' },
  { dir: 'W', angle: 180, label: 'W' },
  { dir: 'NW', angle: -135, label: 'NW' },
];

const radius = 70;

export const DirectionalCompass = () => {
  const defaults = useWorkspaceStore((state) => state.oxidationDefaults);
  const updateDefaults = useWorkspaceStore((state) => state.updateOxidationDefaults);

  const valueLookup = useMemo(() => {
    const lookup: Record<DirKey, number> = {
      N: 0,
      NE: 0,
      E: 0,
      SE: 0,
      S: 0,
      SW: 0,
      W: 0,
      NW: 0,
    };
    defaults.thicknessByDirection.items.forEach((item) => {
      lookup[item.dir] = item.valueUm;
    });
    return lookup;
  }, [defaults.thicknessByDirection.items]);

  const handleChange = (dir: DirKey, value: number) => {
    const items = defaults.thicknessByDirection.items.map((item) =>
      item.dir === dir ? { ...item, valueUm: value } : item,
    );
    updateDefaults({
      thicknessByDirection: {
        ...defaults.thicknessByDirection,
        items,
      },
    });
  };

  return (
    <div className="pointer-events-none absolute left-4 top-4 select-none">
      <div className="relative flex h-40 w-40 items-center justify-center rounded-full border border-border bg-white/70 shadow-inner">
        <div className="text-center text-[11px] font-semibold text-muted">
          Directional weights
          <div className="text-xs font-bold text-text">{defaults.thicknessByDirection.kappa.toFixed(1)} κ</div>
        </div>
        {DIRECTIONS.map((entry) => {
          const radians = (entry.angle * Math.PI) / 180;
          const offsetX = Math.cos(radians) * radius;
          const offsetY = Math.sin(radians) * radius;
          return (
            <label
              key={entry.dir}
              className="pointer-events-auto absolute flex w-16 -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1"
              style={{
                left: `calc(50% + ${offsetX}px)`,
                top: `calc(50% + ${offsetY}px)`,
              }}
            >
              <span className="rounded-full bg-white/80 px-2 py-1 text-[10px] font-semibold uppercase text-muted shadow">
                {entry.label}
              </span>
              <input
                type="number"
                step={0.5}
                className="w-full rounded-full border border-border bg-white/95 px-2 py-1 text-center text-xs text-text shadow focus:border-accent focus:outline-none"
                value={valueLookup[entry.dir].toFixed(1)}
                onChange={(event) => {
                  const next = Number(event.target.value);
                  handleChange(entry.dir, Number.isNaN(next) ? 0 : next);
                }}
              />
            </label>
          );
        })}
      </div>
    </div>
  );
};
