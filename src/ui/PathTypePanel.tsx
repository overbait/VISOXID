import { useMemo } from 'react';
import { clsx } from 'clsx';
import { useWorkspaceStore } from '../state';
import type { PathKind } from '../types';

const pathTypes: Array<{ id: PathKind; label: string; description: string }> = [
  { id: 'oxided', label: 'Oxided', description: 'Shows oxidation' },
  { id: 'reference', label: 'Reference', description: 'Reference outline' },
];

export const PathTypePanel = () => {
  const paths = useWorkspaceStore((state) => state.paths);
  const selectedPathIds = useWorkspaceStore((state) => state.selectedPathIds);
  const setPathType = useWorkspaceStore((state) => state.setPathType);

  const selectedPaths = useMemo(
    () => paths.filter((path) => selectedPathIds.includes(path.meta.id)),
    [paths, selectedPathIds],
  );

  const selectionState: PathKind | 'mixed' | null = (() => {
    if (!selectedPaths.length) return null;
    const first = selectedPaths[0].meta.kind;
    return selectedPaths.every((path) => path.meta.kind === first) ? first : 'mixed';
  })();

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
    </div>
  );
};

export default PathTypePanel;
