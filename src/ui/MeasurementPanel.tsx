import { useWorkspaceStore } from '../state';

export const MeasurementPanel = () => {
  const measurements = useWorkspaceStore((state) => state.measurements);
  const setHeatmapVisible = useWorkspaceStore((state) => state.setHeatmapVisible);
  const setMeasurementSnapping = useWorkspaceStore((state) => state.setMeasurementSnapping);
  const setPinnedProbe = useWorkspaceStore((state) => state.setPinnedProbe);

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
      <div className="rounded-2xl border border-dashed border-border/70 bg-white/60 p-3 text-xs text-muted">
        {measurements.pinnedProbe ? (
          <div className="flex flex-col gap-2 text-text">
            <div className="flex items-center justify-between text-[11px] font-semibold">
              <span>{measurements.pinnedProbe.distance.toFixed(2)} μm</span>
              <span>{measurements.pinnedProbe.angleDeg.toFixed(1)}°</span>
            </div>
            <div className="flex justify-between text-[10px] uppercase tracking-widest text-muted">
              <span>
                A ({measurements.pinnedProbe.a.x.toFixed(0)} μm,{' '}
                {measurements.pinnedProbe.a.y.toFixed(0)} μm)
              </span>
              <span>
                B ({measurements.pinnedProbe.b.x.toFixed(0)} μm,{' '}
                {measurements.pinnedProbe.b.y.toFixed(0)} μm)
              </span>
            </div>
          </div>
        ) : (
          <div className="text-xs">
            Hover the outer contour to preview oxide thickness. Click to pin the current normal
            measurement.
          </div>
        )}
      </div>
      <button
        type="button"
        className="toolbar-button"
        onClick={() => setPinnedProbe(null)}
        disabled={!measurements.pinnedProbe}
      >
        Clear pinned measurement
      </button>
    </div>
  );
};
