import { useMemo } from 'react';
import { clsx } from 'clsx';
import { useWorkspaceStore } from '../state';
import type { PathKind, ToolId } from '../types';

const tools: Array<{ id: ToolId; label: string; shortcut: string }> = [
  { id: 'select', label: 'Select', shortcut: 'V' },
  { id: 'line', label: 'Line', shortcut: 'L' },
  { id: 'dot', label: 'Dot', shortcut: 'D' },
  { id: 'measure', label: 'Measure', shortcut: 'M' },
  { id: 'pan', label: 'Pan', shortcut: 'Space' },
];

const pathTypes: Array<{ id: PathKind; label: string; description: string }> = [
  { id: 'oxided', label: 'Oxided', description: 'Shows oxidation' },
  { id: 'reference', label: 'Reference', description: 'Reference outline' },
];

export const ToolPanel = () => {
  const activeTool = useWorkspaceStore((state) => state.activeTool);
  const setActiveTool = useWorkspaceStore((state) => state.setActiveTool);
  const duplicateSelectedPaths = useWorkspaceStore((state) => state.duplicateSelectedPaths);
  const selectedPathIds = useWorkspaceStore((state) => state.selectedPathIds);
  const paths = useWorkspaceStore((state) => state.paths);
  const setPathType = useWorkspaceStore((state) => state.setPathType);

  const hasSelection = selectedPathIds.length > 0;

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
      <div className="section-title">Tools</div>
      <div className="grid grid-cols-3 gap-2">
        {tools.map((tool) => (
          <button
            key={tool.id}
            type="button"
            className={clsx('toolbar-button', activeTool === tool.id && 'toolbar-button-active')}
            onClick={() => setActiveTool(tool.id)}
          >
            <span>{tool.label}</span>
            <span className="text-[10px] text-muted">{tool.shortcut}</span>
          </button>
        ))}
      </div>
      <button
        type="button"
        className="toolbar-button"
        onClick={() => duplicateSelectedPaths()}
        disabled={!hasSelection}
      >
        <span>Copy selection</span>
        <span className="text-[10px] text-muted">⌘D</span>
      </button>
      <div className="mt-1 text-[11px] uppercase tracking-wide text-muted">Path type</div>
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
