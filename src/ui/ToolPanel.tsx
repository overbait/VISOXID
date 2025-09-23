import { clsx } from 'clsx';
import { useWorkspaceStore } from '../state';
import type { ToolId } from '../types';

const tools: Array<{ id: ToolId; label: string; shortcut: string }> = [
  { id: 'select', label: 'Select', shortcut: 'V' },
  { id: 'pen', label: 'Pen', shortcut: 'P' },
  { id: 'edit', label: 'Edit', shortcut: 'E' },
  { id: 'oxidize', label: 'Oxidize', shortcut: 'O' },
  { id: 'measure', label: 'Measure', shortcut: 'M' },
  { id: 'pan', label: 'Pan', shortcut: 'Space' },
];

export const ToolPanel = () => {
  const activeTool = useWorkspaceStore((state) => state.activeTool);
  const setActiveTool = useWorkspaceStore((state) => state.setActiveTool);

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
    </div>
  );
};
