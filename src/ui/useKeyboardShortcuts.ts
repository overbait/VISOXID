import { useEffect } from 'react';
import { useWorkspaceStore } from '../state';
import type { ToolId } from '../types';

const keyMap: Record<string, ToolId> = {
  v: 'select',
  l: 'line',
  d: 'dot',
  m: 'measure',
  r: 'rotate',
};

export const useKeyboardShortcuts = () => {
  const setActiveTool = useWorkspaceStore((state) => state.setActiveTool);
  const undo = useWorkspaceStore((state) => state.undo);
  const redo = useWorkspaceStore((state) => state.redo);
  const deleteSelectedNodes = useWorkspaceStore((state) => state.deleteSelectedNodes);
  const duplicateSelectedPaths = useWorkspaceStore((state) => state.duplicateSelectedPaths);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
        return;
      }
      const key = event.key.toLowerCase();
      if ((event.metaKey || event.ctrlKey) && key === 'z') {
        event.preventDefault();
        if (event.shiftKey) {
          redo();
        } else {
          undo();
        }
        return;
      }
      if ((event.metaKey || event.ctrlKey) && key === 'd') {
        event.preventDefault();
        duplicateSelectedPaths();
        return;
      }
      if (key in keyMap) {
        event.preventDefault();
        setActiveTool(keyMap[key]);
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        deleteSelectedNodes();
      }
      if (event.code === 'Space') {
        event.preventDefault();
        setActiveTool('pan');
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [deleteSelectedNodes, duplicateSelectedPaths, redo, setActiveTool, undo]);
};
