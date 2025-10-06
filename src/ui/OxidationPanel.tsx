import { useMemo } from 'react';
import { useWorkspaceStore } from '../state';

const formatValue = (value: number) => value.toFixed(1);

export const OxidationPanel = () => {
  const defaults = useWorkspaceStore((state) => state.oxidationDefaults);
  const updateDefaults = useWorkspaceStore((state) => state.updateOxidationDefaults);
  const oxidationVisible = useWorkspaceStore((state) => state.oxidationVisible);
  const toggleVisible = useWorkspaceStore((state) => state.toggleOxidationVisible);
  const dotCount = useWorkspaceStore((state) => state.oxidationDotCount);
  const setDotCount = useWorkspaceStore((state) => state.setOxidationDotCount);
  const collapsed = useWorkspaceStore((state) => state.panelCollapse.oxidation);
  const setPanelCollapsed = useWorkspaceStore((state) => state.setPanelCollapsed);
  const active = defaults;

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
      { label: 'Directional span', value: `${formatValue(range.max - range.min)} μm` },
      { label: 'Headings', value: `${active.thicknessByDirection.items.length}` },
    ],
    [active.thicknessByDirection.items.length, active.thicknessUniformUm, range.max, range.min],
  );

  return (
    <div className="panel flex flex-col gap-3 p-4">
      <div className="flex items-center justify-between">
        <div className="section-title">Oxidation</div>
        <button
          type="button"
          className="text-[11px] font-semibold text-accent transition hover:text-accent/80"
          onClick={() => setPanelCollapsed('oxidation', !collapsed)}
        >
          {collapsed ? 'Expand' : 'Collapse'}
        </button>
      </div>
      {!collapsed && (
        <>
          <label className="flex items-center justify-between text-xs font-medium text-muted">
            <span>Show compass dots</span>
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
              step={0.1}
              value={active.thicknessUniformUm}
              onChange={(value) => {
                const clamped = Math.min(10, Math.max(0, value));
                updateDefaults({ thicknessUniformUm: clamped });
              }}
            />
            <LabeledSlider
              label="Line preview dots"
              min={0}
              max={1000}
              step={1}
              value={dotCount}
              onChange={(value) => {
                setDotCount(value);
              }}
              format={(value) => Math.round(value).toString()}
            />
          </div>
          <label className="flex items-center gap-2 text-xs font-medium text-muted">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-border text-accent focus:ring-accent"
              checked={active.mirrorSymmetry}
              onChange={(event) => {
                updateDefaults({ mirrorSymmetry: event.target.checked });
              }}
            />
            Mirror symmetry
          </label>
        </>
      )}
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
  format?: (value: number) => string;
}

const LabeledSlider = ({ label, value, min, max, step, onChange, format }: LabeledSliderProps) => (
  <label className="flex flex-col gap-1 text-xs text-muted">
    <span className="flex items-center justify-between">
      <span>{label}</span>
      <span className="font-semibold text-text">{format ? format(value) : formatValue(value)}</span>
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
