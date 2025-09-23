import { useWorkspaceStore } from '../state';

export const MeasurementPanel = () => {
  const measurements = useWorkspaceStore((state) => state.measurements);
  const clearProbes = useWorkspaceStore((state) => state.clearProbes);
  const setHeatmapVisible = useWorkspaceStore((state) => state.setHeatmapVisible);
  const setMeasurementSnapping = useWorkspaceStore((state) => state.setMeasurementSnapping);

  return (
    <div className="panel flex flex-col gap-4 p-4">
      <div className="section-title">Measurements</div>
      <div className="flex items-center justify-between text-xs text-muted">
        <span>Heatmap overlay</span>
        <input
          type="checkbox"
          className="h-4 w-4 rounded border-border text-accent focus:ring-accent"
          checked={measurements.showHeatmap}
          onChange={(event) => setHeatmapVisible(event.target.checked)}
        />
      </div>
      <div className="flex items-center justify-between text-xs text-muted">
        <span>Snapping</span>
        <input
          type="checkbox"
          className="h-4 w-4 rounded border-border text-accent focus:ring-accent"
          checked={measurements.snapping}
          onChange={(event) => setMeasurementSnapping(event.target.checked)}
        />
      </div>
      <div className="rounded-2xl border border-dashed border-border/70 bg-white/50 p-3">
        {measurements.history.length === 0 ? (
          <div className="text-xs text-muted">No measurements recorded yet.</div>
        ) : (
          <ul className="flex flex-col gap-2 text-xs text-muted">
            {measurements.history.map((probe) => (
              <li key={probe.id} className="flex flex-col gap-1 rounded-xl bg-accentSoft/40 px-3 py-2">
                <div className="flex items-center justify-between text-[11px] font-semibold text-text">
                  <span>{probe.distance.toFixed(2)} px</span>
                  <span>{probe.angleDeg.toFixed(1)}°</span>
                </div>
                <div className="flex justify-between text-[10px] uppercase tracking-widest">
                  <span>A ({probe.a.x.toFixed(0)}, {probe.a.y.toFixed(0)})</span>
                  <span>B ({probe.b.x.toFixed(0)}, {probe.b.y.toFixed(0)})</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
      <button
        type="button"
        className="toolbar-button"
        onClick={() => clearProbes()}
        disabled={measurements.history.length === 0}
      >
        Clear history
      </button>
    </div>
  );
};
