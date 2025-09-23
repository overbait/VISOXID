import { useMemo } from 'react';
import { useWorkspaceStore } from '../state';

const formatValue = (value: number) => value.toFixed(1);

export const OxidationPanel = () => {
  const defaults = useWorkspaceStore((state) => state.oxidationDefaults);
  const updateDefaults = useWorkspaceStore((state) => state.updateOxidationDefaults);
  const preview = useMemo(
    () => [
      { label: 'Kernel', value: `${formatValue(defaults.kernelWidth)} px` },
      { label: 'Target', value: `${formatValue(defaults.targetThickness)} nm` },
      { label: 'Base', value: `${formatValue(defaults.baseThickness)} nm` },
    ],
    [defaults],
  );

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
          label="Kernel width"
          min={4}
          max={48}
          step={0.5}
          value={defaults.kernelWidth}
          onChange={(value) => updateDefaults({ kernelWidth: value })}
        />
        <LabeledSlider
          label="Target thickness"
          min={1}
          max={25}
          step={0.5}
          value={defaults.targetThickness}
          onChange={(value) => updateDefaults({ targetThickness: value })}
        />
        <LabeledSlider
          label="Base thickness"
          min={0}
          max={defaults.targetThickness}
          step={0.5}
          value={defaults.baseThickness}
          onChange={(value) => updateDefaults({ baseThickness: value })}
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
          label="Von Mises κ"
          min={1}
          max={12}
          step={0.5}
          value={defaults.vonMisesKappa}
          onChange={(value) => updateDefaults({ vonMisesKappa: value })}
        />
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
