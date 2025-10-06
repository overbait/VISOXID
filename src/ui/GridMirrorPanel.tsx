import { useWorkspaceStore } from '../state';

export const GridMirrorPanel = () => {
  const grid = useWorkspaceStore((state) => state.grid);
  const mirror = useWorkspaceStore((state) => state.mirror);
  const updateGrid = useWorkspaceStore((state) => state.updateGrid);
  const updateMirror = useWorkspaceStore((state) => state.updateMirror);

  return (
    <div className="panel flex flex-col gap-3 p-4">
      <div className="section-title">Grid</div>
      <div className="flex flex-col gap-3 text-xs text-muted">
        <ToggleRow
          label="Visible"
          checked={grid.visible}
          onChange={(value) => updateGrid({ visible: value })}
        />
        <ToggleRow
          label="Snap to grid"
          checked={grid.snapToGrid}
          onChange={(value) => updateGrid({ snapToGrid: value })}
        />
        <NumberField
          label="Spacing"
          value={grid.spacing}
          min={4}
          max={256}
          onChange={(value) => updateGrid({ spacing: value })}
        />
        <NumberField
          label="Subdivisions"
          value={grid.subdivisions}
          min={1}
          max={16}
          onChange={(value) => updateGrid({ subdivisions: value })}
        />
      </div>
      <div className="section-title">Mirror</div>
      <div className="flex flex-col gap-3 text-xs text-muted">
        <ToggleRow
          label="Enabled"
          checked={mirror.enabled}
          onChange={(value) => updateMirror({ enabled: value })}
        />
        <label className="input-label flex items-center justify-between">
          Axis
          <select
            value={mirror.axis}
            onChange={(event) => updateMirror({ axis: event.target.value as typeof mirror.axis })}
            className="input-field ml-3 w-28"
          >
            <option value="x">X</option>
            <option value="y">Y</option>
            <option value="xy">Both</option>
          </select>
        </label>
        <NumberField
          label="Origin X"
          value={mirror.origin.x}
          min={-4096}
          max={4096}
          onChange={(value) => updateMirror({ origin: { ...mirror.origin, x: value } })}
        />
        <NumberField
          label="Origin Y"
          value={mirror.origin.y}
          min={-4096}
          max={4096}
          onChange={(value) => updateMirror({ origin: { ...mirror.origin, y: value } })}
        />
        <ToggleRow
          label="Live preview"
          checked={mirror.livePreview}
          onChange={(value) => updateMirror({ livePreview: value })}
        />
      </div>
    </div>
  );
};

interface ToggleRowProps {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}

const ToggleRow = ({ label, checked, onChange }: ToggleRowProps) => (
  <label className="flex items-center justify-between">
    <span>{label}</span>
    <input
      type="checkbox"
      className="h-4 w-4 rounded border-border text-accent focus:ring-accent"
      checked={checked}
      onChange={(event) => onChange(event.target.checked)}
    />
  </label>
);

interface NumberFieldProps {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}

const NumberField = ({ label, value, min, max, onChange }: NumberFieldProps) => (
  <label className="flex items-center justify-between">
    <span>{label}</span>
    <input
      type="number"
      value={value}
      min={min}
      max={max}
      onChange={(event) => onChange(Number(event.target.value))}
      className="input-field ml-3 w-24"
    />
  </label>
);
