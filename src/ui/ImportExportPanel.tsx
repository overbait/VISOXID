import { useRef, type ChangeEvent } from 'react';
import { exportProjectToJSON, importProjectFromJSON, exportProjectToPNG, exportProjectToSVG } from '../utils/io';
import { useWorkspaceStore } from '../state';

export const ImportExportPanel = () => {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const undo = useWorkspaceStore((state) => state.undo);
  const redo = useWorkspaceStore((state) => state.redo);
  const importState = useWorkspaceStore((state) => state.importState);
  const pushWarning = useWorkspaceStore((state) => state.pushWarning);
  const getState = useWorkspaceStore.getState;

  const handleExportJSON = () => {
    const data = exportProjectToJSON(getState());
    const blob = new Blob([data], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'visoxid-project.json';
    link.click();
    URL.revokeObjectURL(link.href);
  };

  const handleImportJSON = async (event: ChangeEvent<HTMLInputElement>) => {
    const [file] = event.target.files ?? [];
    if (!file) return;
    const text = await file.text();
    try {
      const project = importProjectFromJSON(text);
      importState(project.payload);
    } catch (error) {
      console.error(error);
      pushWarning('Failed to import JSON', 'error');
    }
  };

  const handleExportPNG = async () => {
    const blob = await exportProjectToPNG();
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'visoxid-preview.png';
    link.click();
    URL.revokeObjectURL(link.href);
  };

  const handleExportSVG = async () => {
    const blob = await exportProjectToSVG();
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'visoxid-preview.svg';
    link.click();
    URL.revokeObjectURL(link.href);
  };

  return (
    <div className="panel flex flex-col gap-3 p-4 text-xs text-muted">
      <div className="section-title">Project</div>
      <div className="grid grid-cols-2 gap-2">
        <button type="button" className="toolbar-button" onClick={handleExportJSON}>
          Export JSON
        </button>
        <button type="button" className="toolbar-button" onClick={() => inputRef.current?.click()}>
          Import JSON
        </button>
        <button type="button" className="toolbar-button" onClick={handleExportPNG}>
          PNG preview
        </button>
        <button type="button" className="toolbar-button" onClick={handleExportSVG}>
          SVG stub
        </button>
      </div>
      <input ref={inputRef} type="file" accept="application/json" className="hidden" onChange={handleImportJSON} />
      <div className="mt-2 flex items-center justify-between">
        <button type="button" className="toolbar-button" onClick={undo}>
          Undo
        </button>
        <button type="button" className="toolbar-button" onClick={redo}>
          Redo
        </button>
      </div>
    </div>
  );
};
