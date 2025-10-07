import { useEffect, useMemo, useRef } from 'react';
import { clsx } from 'clsx';
import { useWorkspaceStore } from '../state';
import type { OxidationDirection, PathKind } from '../types';

const pathTypes: Array<{ id: PathKind; label: string; description: string }> = [
  { id: 'oxided', label: 'Oxided', description: 'Shows oxidation' },
  { id: 'reference', label: 'Reference', description: 'Reference outline' },
];

export const PathTypePanel = () => {
  const paths = useWorkspaceStore((state) => state.paths);
  const selectedPathIds = useWorkspaceStore((state) => state.selectedPathIds);
  const setPathType = useWorkspaceStore((state) => state.setPathType);
  const setOxidationDirection = useWorkspaceStore((state) => state.setOxidationDirection);

  const selectedPaths = useMemo(
    () => paths.filter((path) => selectedPathIds.includes(path.meta.id)),
    [paths, selectedPathIds],
  );

  const selectionState: PathKind | 'mixed' | null = (() => {
    if (!selectedPaths.length) return null;
    const first = selectedPaths[0].meta.kind;
    return selectedPaths.every((path) => path.meta.kind === first) ? first : 'mixed';
  })();

  const directionState: OxidationDirection | 'mixed' | null = useMemo(() => {
    if (!selectedPaths.length) return null;
    const oxidedPaths = selectedPaths.filter((path) => path.meta.kind === 'oxided');
    if (!oxidedPaths.length) return null;
    const fallback: OxidationDirection = 'inward';
    const first = oxidedPaths[0].meta.oxidationDirection ?? fallback;
    return oxidedPaths.every(
      (path) => (path.meta.oxidationDirection ?? fallback) === first,
    )
      ? (first as OxidationDirection)
      : 'mixed';
  }, [selectedPaths]);

  const directionToggleRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (directionToggleRef.current) {
      directionToggleRef.current.indeterminate = directionState === 'mixed';
    }
  }, [directionState]);

  const directionSummary = directionState === 'mixed'
    ? 'Смешанный режим'
    : directionState === 'outward'
      ? 'Внешний режим'
      : 'Внутренний режим';

  return (
    <div className="panel flex flex-col gap-3 p-4">
      <div className="section-title">Path type</div>
      {selectionState === 'mixed' && (
        <div className="rounded-xl border border-dashed border-border px-3 py-2 text-[11px] text-muted">
          Mixed selection
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">
        {pathTypes.map((type) => (
          <button
            key={type.id}
            type="button"
            className={clsx(
              'toolbar-button h-full text-left',
              selectionState === type.id && 'toolbar-button-active',
            )}
            onClick={() => setPathType(type.id)}
            disabled={!selectedPaths.length}
          >
            <span className="font-semibold">{type.label}</span>
            <span className="text-[10px] text-muted">{type.description}</span>
          </button>
        ))}
      </div>
      {selectionState === 'oxided' && (
        <div className="rounded-2xl border border-border/70 bg-white/70 p-3">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted">
            Режим оксидации
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted">Внутрь → Внешний</span>
            <label className="relative inline-flex cursor-pointer items-center">
              <input
                ref={directionToggleRef}
                type="checkbox"
                className="peer sr-only"
                checked={directionState === 'outward'}
                onChange={(event) =>
                  setOxidationDirection(event.target.checked ? 'outward' : 'inward')
                }
              />
              <span className="block h-5 w-10 rounded-full bg-slate-300 transition peer-checked:bg-accent peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-accent/60" />
              <span className="absolute left-1 top-1 h-3 w-3 rounded-full bg-white shadow transition peer-checked:translate-x-5" />
            </label>
          </div>
          <div className="mt-2 text-right text-[10px] text-muted">{directionSummary}</div>
        </div>
      )}
    </div>
  );
};

export default PathTypePanel;
