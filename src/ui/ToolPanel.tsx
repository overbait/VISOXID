import { clsx } from 'clsx';
import { useWorkspaceStore } from '../state';
import type { ToolId } from '../types';

const tools: Array<{ id: ToolId; label: string; shortcut: string }> = [
  { id: 'select', label: 'Select', shortcut: 'V' },
  { id: 'line', label: 'Line', shortcut: 'L' },
  { id: 'dot', label: 'Dot', shortcut: 'D' },
  { id: 'measure', label: 'Measure', shortcut: 'M' },
  { id: 'pan', label: 'Pan', shortcut: 'Space' },
  { id: 'rotate', label: 'Rotate', shortcut: 'R' },
];

export const ToolPanel = () => {
  const activeTool = useWorkspaceStore((state) => state.activeTool);
  const setActiveTool = useWorkspaceStore((state) => state.setActiveTool);
  const duplicateSelectedPaths = useWorkspaceStore((state) => state.duplicateSelectedPaths);
  const selectedPathIds = useWorkspaceStore((state) => state.selectedPathIds);

  const hasSelection = selectedPathIds.length > 0;

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
        <button
          type="button"
          className="toolbar-button"
          onClick={() => duplicateSelectedPaths()}
          disabled={!hasSelection}
        >
          <span>Copy</span>
          <span className="text-[10px] text-muted">⌘D</span>
        </button>
      </div>
    </div>
  );
};
