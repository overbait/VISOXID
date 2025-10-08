import { useMemo, useState } from 'react';
import { CanvasViewport } from './CanvasViewport';
import { useWorkspaceStore } from '../state';
import type { DirectionWeight } from '../types';
import { evalThicknessForAngle } from '../geometry';
import { directionalValueToColor } from '../utils/directionalColor';

const CANVAS_SIZE = 260;
const OUTER_RADIUS = CANVAS_SIZE / 2 - 20;
const CENTER = CANVAS_SIZE / 2;
const MIN_SPOKE_RADIUS = 44;

const toRadians = (value: number): number => (value * Math.PI) / 180;

const sortByAngle = (items: DirectionWeight[]): DirectionWeight[] =>
  [...items].sort((a, b) => a.angleDeg - b.angleDeg);

const spokeRadiusForValue = (value: number): number => {
  const ratio = Math.min(Math.max(value / 10, 0), 1);
  const maxRadius = OUTER_RADIUS - 24;
  return MIN_SPOKE_RADIUS + ratio * Math.max(maxRadius - MIN_SPOKE_RADIUS, 0);
};

const polarToCartesian = (angleRad: number, radius: number): { x: number; y: number } => ({
  x: CENTER + Math.cos(angleRad) * radius,
  y: CENTER + Math.sin(angleRad) * radius,
});

const ExportCompass = () => {
  const defaults = useWorkspaceStore((state) => state.oxidationDefaults);
  const oxidationProgress = useWorkspaceStore((state) => state.oxidationProgress);
  const [displayMode, setDisplayMode] = useState<'directional' | 'total'>('directional');

  const toggleDisplayMode = () => {
    setDisplayMode((mode) => (mode === 'directional' ? 'total' : 'directional'));
  };

  const weights = useMemo(
    () => sortByAngle(defaults.thicknessByDirection.items),
    [defaults.thicknessByDirection.items],
  );

  const thicknessOptions = useMemo(
    () => ({
      uniformThickness: defaults.thicknessUniformUm,
      weights,
      mirrorSymmetry: defaults.mirrorSymmetry,
      progress: oxidationProgress,
    }),
    [defaults.mirrorSymmetry, defaults.thicknessUniformUm, oxidationProgress, weights],
  );

  const preview = useMemo(() => {
    const segments = Math.max(96, weights.length * 12, 160);
    const points: Array<{ x: number; y: number }> = [];
    let maxRadius = MIN_SPOKE_RADIUS;
    for (let i = 0; i < segments; i += 1) {
      const theta = (i / segments) * Math.PI * 2;
      const totalThickness = weights.length
        ? evalThicknessForAngle(theta, thicknessOptions)
        : defaults.thicknessUniformUm * oxidationProgress;
      const radius = spokeRadiusForValue(totalThickness ?? 0);
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
  }, [defaults.thicknessUniformUm, oxidationProgress, thicknessOptions, weights]);

  const uniformRadius = spokeRadiusForValue(defaults.thicknessUniformUm * oxidationProgress);

  return (
    <div className="rounded-3xl border border-border bg-white/80 p-5 shadow-panel">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">Directional weights</h2>
          <p className="text-xs text-muted">
            {displayMode === 'directional'
              ? 'Showing configured offsets per heading.'
              : 'Showing offsets plus the uniform baseline.'}
          </p>
        </div>
        <button
          type="button"
          className="rounded-full border border-border px-3 py-1 text-[10px] font-semibold uppercase tracking-widest text-muted transition hover:border-accent hover:text-accent"
          onClick={toggleDisplayMode}
        >
          {displayMode === 'directional' ? 'Show totals' : 'Show offsets'}
        </button>
      </div>
      <div
        className="relative mx-auto mt-4 flex items-center justify-center"
        style={{ width: CANVAS_SIZE, height: CANVAS_SIZE }}
      >
        <svg width={CANVAS_SIZE} height={CANVAS_SIZE} viewBox={`0 0 ${CANVAS_SIZE} ${CANVAS_SIZE}`}>
          <circle
            cx={CENTER}
            cy={CENTER}
            r={OUTER_RADIUS}
            fill="rgba(255,255,255,0.85)"
            stroke="#dbe1ea"
            strokeWidth={2}
          />
          <circle
            cx={CENTER}
            cy={CENTER}
            r={MIN_SPOKE_RADIUS - 10}
            fill="rgba(30, 64, 175, 0.08)"
            stroke="rgba(30, 64, 175, 0.3)"
            strokeWidth={2}
          />
          {uniformRadius > MIN_SPOKE_RADIUS && (
            <circle
              cx={CENTER}
              cy={CENTER}
              r={uniformRadius}
              fill="rgba(30, 64, 175, 0.05)"
              stroke="rgba(30, 64, 175, 0.25)"
              strokeWidth={1.5}
              strokeDasharray="6 6"
            />
          )}
          {preview.path && (
            <path
              d={preview.path}
              fill="rgba(37, 99, 235, 0.12)"
              stroke="rgba(30, 64, 175, 0.55)"
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
                stroke="rgba(148, 163, 184, 0.4)"
                strokeWidth={2}
                strokeLinecap="round"
              />
            );
          })}
          {weights.map((weight) => {
            const angleRad = toRadians(weight.angleDeg);
            const start = polarToCartesian(angleRad, MIN_SPOKE_RADIUS - 10);
            const end = polarToCartesian(angleRad, spokeRadiusForValue(weight.valueUm * oxidationProgress));
            const color = directionalValueToColor(weight.valueUm);
            return (
              <line
                key={weight.id}
                x1={start.x}
                y1={start.y}
                x2={end.x}
                y2={end.y}
                stroke={color}
                strokeWidth={6}
                strokeLinecap="round"
              />
            );
          })}
        </svg>
        {weights.map((weight) => {
          const angleRad = toRadians(weight.angleDeg);
          const labelRadius = preview.maxRadius + 20;
          const position = polarToCartesian(angleRad, Math.max(labelRadius, OUTER_RADIUS + 20));
          const color = directionalValueToColor(weight.valueUm);
          const labelValue =
            displayMode === 'directional'
              ? weight.valueUm
              : weight.valueUm + defaults.thicknessUniformUm;
          return (
            <div
              key={`label-${weight.id}`}
              className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 text-[11px] font-semibold text-text"
              style={{ left: position.x, top: position.y }}
            >
              <span
                className="rounded-full px-2 py-1 whitespace-nowrap"
                style={{ borderBottom: `2px solid ${color}`, backgroundColor: 'rgba(255,255,255,0.92)' }}
              >
                {labelValue.toFixed(1)} μm
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

const UniformThicknessCard = () => {
  const defaults = useWorkspaceStore((state) => state.oxidationDefaults);

  return (
    <div className="rounded-3xl border border-border bg-white/80 p-5 shadow-panel">
      <h2 className="text-base font-semibold">Uniform thickness</h2>
      <p className="mt-1 text-xs text-muted">Baseline layer applied before directional growth.</p>
      <div className="mt-4 flex items-center justify-between rounded-2xl border border-border/70 bg-white/80 px-4 py-3 shadow-sm">
        <span className="text-xs uppercase tracking-[0.3em] text-muted">Value</span>
        <span className="text-lg font-semibold text-text">{defaults.thicknessUniformUm.toFixed(1)} μm</span>
      </div>
    </div>
  );
};

const ExportMeasurementsPanel = () => {
  const exportMeasurements = useWorkspaceStore((state) => state.exportView.measurements);
  const addMeasurement = useWorkspaceStore((state) => state.addExportMeasurement);
  const removeMeasurement = useWorkspaceStore((state) => state.removeExportMeasurement);
  const updateColor = useWorkspaceStore((state) => state.updateExportMeasurementColor);
  const pinnedProbe = useWorkspaceStore((state) => state.measurements.pinnedProbe);
  const setActiveTool = useWorkspaceStore((state) => state.setActiveTool);
  const activeTool = useWorkspaceStore((state) => state.activeTool);

  return (
    <div className="rounded-3xl border border-border bg-white/85 p-6 shadow-panel">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Measurements</h2>
          <p className="text-xs text-muted">
            Use the measurement tool to pin spans, then add them to the export list below.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className={`rounded-full border px-4 py-2 text-xs font-semibold uppercase tracking-wide transition ${
              activeTool === 'measure'
                ? 'border-accent bg-accent/10 text-accent'
                : 'border-border text-muted hover:border-accent'
            }`}
            onClick={() => setActiveTool('measure')}
          >
            Measure tool
          </button>
          <button
            type="button"
            className="rounded-full border border-border bg-white px-4 py-2 text-xs font-semibold uppercase tracking-wide text-accent shadow-sm transition hover:bg-white"
            onClick={() => pinnedProbe && addMeasurement(pinnedProbe)}
            disabled={!pinnedProbe}
          >
            Add pinned
          </button>
        </div>
      </div>
      <div className="mt-4 grid gap-4">
        {exportMeasurements.length === 0 && (
          <div className="rounded-2xl border border-dashed border-border/70 bg-white/70 px-4 py-6 text-center text-sm text-muted">
            No saved measurements yet. Pin a measurement on the canvas and press “Add pinned”.
          </div>
        )}
        {exportMeasurements.map((entry) => (
          <div
            key={entry.id}
            className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-border/70 bg-white/80 px-4 py-3 shadow-sm"
          >
            <div className="flex flex-col gap-1 text-sm">
              <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted">
                <span className="font-semibold text-text">{entry.label}</span>
                <span>• {entry.probe.distance.toFixed(2)} μm</span>
                <span>• {entry.probe.angleDeg.toFixed(1)}°</span>
              </div>
              <div className="text-xs text-muted">
                A ({entry.probe.a.x.toFixed(1)} μm, {entry.probe.a.y.toFixed(1)} μm) · B (
                {entry.probe.b.x.toFixed(1)} μm, {entry.probe.b.y.toFixed(1)} μm)
              </div>
            </div>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 text-xs text-muted">
                Color
                <input
                  type="color"
                  value={entry.color}
                  onChange={(event) => updateColor(entry.id, event.target.value)}
                  className="h-9 w-9 cursor-pointer rounded-full border border-border"
                />
              </label>
              <button
                type="button"
                className="rounded-full border border-border bg-white px-3 py-2 text-xs font-semibold uppercase tracking-wide text-error transition hover:border-error"
                onClick={() => removeMeasurement(entry.id)}
              >
                Remove
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export const ExportView = () => {
  const closeExportView = useWorkspaceStore((state) => state.closeExportView);

  return (
    <div className="min-h-screen bg-background px-4 py-6 text-text sm:px-6 lg:px-10">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <header className="flex items-center justify-between">
          <button
            type="button"
            className="rounded-full border border-border bg-white px-4 py-2 text-xs font-semibold uppercase tracking-wide text-accent shadow transition hover:bg-white/90"
            onClick={closeExportView}
          >
            Back to workspace
          </button>
          <div className="text-right">
            <h1 className="text-xl font-semibold">Export overview</h1>
            <p className="text-xs text-muted">All essential oxidation data in a single screen capture.</p>
          </div>
        </header>
        <div className="grid gap-6 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] xl:grid-cols-[minmax(0,0.75fr)_minmax(0,1.25fr)]">
          <div className="flex flex-col gap-6">
            <ExportCompass />
            <UniformThicknessCard />
          </div>
          <div className="flex items-center justify-center">
            <CanvasViewport variant="export" />
          </div>
        </div>
        <ExportMeasurementsPanel />
      </div>
    </div>
  );
};

