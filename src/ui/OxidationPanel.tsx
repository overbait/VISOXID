import { useMemo } from 'react';
import type { OxidationSettings } from '../types';
import { useWorkspaceStore } from '../state';

const formatValue = (value: number) => value.toFixed(1);

export const OxidationPanel = () => {
  const defaults = useWorkspaceStore((state) => state.oxidationDefaults);
  const updateDefaults = useWorkspaceStore((state) => state.updateOxidationDefaults);
  const oxidationVisible = useWorkspaceStore((state) => state.oxidationVisible);
  const toggleVisible = useWorkspaceStore((state) => state.toggleOxidationVisible);
  const selectedPath = useWorkspaceStore((state) => {
    const first = state.selectedPathIds[0];
    return first ? state.paths.find((path) => path.meta.id === first) ?? null : null;
  });
  const updateSelectedOxidation = useWorkspaceStore((state) => state.updateSelectedOxidation);

  const active = selectedPath?.oxidation ?? defaults;

  const applyToSelected = (settings: Partial<OxidationSettings>) => {
    if (!selectedPath) return;
    updateSelectedOxidation(settings);
  };

  const directionValues = useMemo(
    () => active.thicknessByDirection.items.map((item) => item.valueUm),
    [active.thicknessByDirection.items],
  );

  const range = useMemo(() => {
    const min = Math.min(...directionValues);
    const max = Math.max(...directionValues);
    return { min, max };
  }, [directionValues]);

  const preview = useMemo(
    () => [
      { label: 'Uniform', value: `${formatValue(active.thicknessUniformUm)} μm` },
      { label: 'κ', value: formatValue(active.thicknessByDirection.kappa) },
      { label: 'Δ range', value: `${formatValue(range.max - range.min)} μm` },
    ],
    [active.thicknessByDirection.kappa, active.thicknessUniformUm, range.max, range.min],
  );

  return (
    <div className="panel flex flex-col gap-4 p-4">
      <div className="section-title">Oxidation</div>
      <label className="flex items-center justify-between text-xs font-medium text-muted">
        <span>Show oxide preview</span>
        <input
          type="checkbox"
          className="h-4 w-4 rounded border-border text-accent focus:ring-accent"
          checked={oxidationVisible}
          onChange={(event) => toggleVisible(event.target.checked)}
        />
      </label>
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
          max={10}
          step={0.5}
          value={active.thicknessUniformUm}
          onChange={(value) => {
            const clamped = Math.min(10, Math.max(0, value));
            updateDefaults({ thicknessUniformUm: clamped });
            applyToSelected({ thicknessUniformUm: clamped });
          }}
        />
        <LabeledSlider
          label="Smoothing strength"
          min={0.1}
          max={1}
          step={0.05}
          value={active.smoothingStrength}
          onChange={(value) => {
            updateDefaults({ smoothingStrength: value });
            applyToSelected({ smoothingStrength: value });
          }}
        />
        <LabeledSlider
          label="Smoothing iterations"
          min={0}
          max={5}
          step={1}
          value={active.smoothingIterations}
          onChange={(value) => {
            const rounded = Math.round(value);
            updateDefaults({ smoothingIterations: rounded });
            applyToSelected({ smoothingIterations: rounded });
          }}
        />
        <LabeledSlider
          label="Directional κ"
          min={1}
          max={12}
          step={0.25}
          value={active.thicknessByDirection.kappa}
          onChange={(value) => {
            updateDefaults({
              thicknessByDirection: {
                ...defaults.thicknessByDirection,
                kappa: value,
              },
            });
            applyToSelected({
              thicknessByDirection: {
                ...active.thicknessByDirection,
                kappa: value,
              },
            });
          }}
        />
      </div>
      <div className="rounded-2xl border border-dashed border-border/70 bg-white/60 p-3 text-xs text-muted">
        Directional μm offsets can be edited via the circular compass overlay on the canvas. Tap a cardinal label there to input
        values directly.
      </div>
      <label className="flex items-center gap-2 text-xs font-medium text-muted">
        <input
          type="checkbox"
          className="h-4 w-4 rounded border-border text-accent focus:ring-accent"
          checked={active.mirrorSymmetry}
          onChange={(event) => {
            updateDefaults({ mirrorSymmetry: event.target.checked });
            applyToSelected({ mirrorSymmetry: event.target.checked });
          }}
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
