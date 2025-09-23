import { useMemo } from 'react';
import type { DirKey } from '../types';
import { useWorkspaceStore } from '../state';

const formatValue = (value: number) => value.toFixed(1);

const DIRECTION_LABELS: Record<DirKey, string> = {
  N: 'North',
  NE: 'North-East',
  E: 'East',
  SE: 'South-East',
  S: 'South',
  SW: 'South-West',
  W: 'West',
  NW: 'North-West',
};

const DIRECTION_ORDER: DirKey[] = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

export const OxidationPanel = () => {
  const defaults = useWorkspaceStore((state) => state.oxidationDefaults);
  const updateDefaults = useWorkspaceStore((state) => state.updateOxidationDefaults);

  const directionValues = useMemo(
    () => defaults.thicknessByDirection.items.map((item) => item.valueUm),
    [defaults],
  );

  const range = useMemo(() => {
    const min = Math.min(...directionValues);
    const max = Math.max(...directionValues);
    return { min, max };
  }, [directionValues]);

  const preview = useMemo(
    () => [
      { label: 'Uniform', value: `${formatValue(defaults.thicknessUniformUm)} μm` },
      { label: 'κ', value: formatValue(defaults.thicknessByDirection.kappa) },
      { label: 'Δ range', value: `${formatValue(range.max - range.min)} μm` },
    ],
    [defaults, range.max, range.min],
  );

  const updateDirection = (dir: DirKey, value: number) => {
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
    <div className="panel flex flex-col gap-4 p-4">
      <div className="section-title">Oxidation</div>
      <div className="grid grid-cols-3 gap-3 text-xs text-muted">
        {preview.map((item) => (
          <div key={item.label} className="rounded-xl bg-accentSoft/60 px-3 py-2 text-center text-[11px]">
            <div className="font-semibold text-text">{item.value}</div>
            <div>{item.label}</div>
          </div>
        ))}
      </div>
      <div className="flex flex-col gap-3 text-sm">
        <LabeledSlider
          label="Uniform thickness"
          min={0}
          max={50}
          step={0.5}
          value={defaults.thicknessUniformUm}
          onChange={(value) => updateDefaults({ thicknessUniformUm: value })}
        />
        <LabeledSlider
          label="Smoothing strength"
          min={0.1}
          max={1}
          step={0.05}
          value={defaults.smoothingStrength}
          onChange={(value) => updateDefaults({ smoothingStrength: value })}
        />
        <LabeledSlider
          label="Smoothing iterations"
          min={0}
          max={5}
          step={1}
          value={defaults.smoothingIterations}
          onChange={(value) => updateDefaults({ smoothingIterations: Math.round(value) })}
        />
        <LabeledSlider
          label="Directional κ"
          min={1}
          max={12}
          step={0.25}
          value={defaults.thicknessByDirection.kappa}
          onChange={(value) =>
            updateDefaults({
              thicknessByDirection: {
                ...defaults.thicknessByDirection,
                kappa: value,
              },
            })
          }
        />
      </div>
      <div className="grid grid-cols-2 gap-3 text-sm">
        {DIRECTION_ORDER.map((dir) => {
          const current = defaults.thicknessByDirection.items.find((item) => item.dir === dir);
          const value = current?.valueUm ?? 0;
          return (
            <LabeledSlider
              key={dir}
              label={`${DIRECTION_LABELS[dir]} (${dir})`}
              min={-25}
              max={25}
              step={0.5}
              value={value}
              onChange={(v) => updateDirection(dir, v)}
            />
          );
        })}
      </div>
      <label className="flex items-center gap-2 text-xs font-medium text-muted">
        <input
          type="checkbox"
          className="h-4 w-4 rounded border-border text-accent focus:ring-accent"
          checked={defaults.mirrorSymmetry}
          onChange={(event) => updateDefaults({ mirrorSymmetry: event.target.checked })}
        />
        Mirror symmetry
      </label>
    </div>
  );
};

interface LabeledSliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}

const LabeledSlider = ({ label, value, min, max, step, onChange }: LabeledSliderProps) => (
  <label className="flex flex-col gap-1 text-xs text-muted">
    <span className="flex items-center justify-between">
      <span>{label}</span>
      <span className="font-semibold text-text">{formatValue(value)}</span>
    </span>
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(event) => onChange(Number(event.target.value))}
      className="accent-accent"
    />
  </label>
);
