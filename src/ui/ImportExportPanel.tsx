import { useRef, type ChangeEvent } from 'react';
import {
  exportProjectToJSON,
  importProjectFromJSON,
  exportProjectToPNG,
  exportProjectToSVG,
} from '../utils/io';
import { parseDXFShapes, serializePathsToDXF } from '../utils/dxf';
import { useWorkspaceStore } from '../state';
import { createId } from '../utils/ids';

export const ImportExportPanel = () => {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const dxfInputRef = useRef<HTMLInputElement | null>(null);
  const undo = useWorkspaceStore((state) => state.undo);
  const redo = useWorkspaceStore((state) => state.redo);
  const importState = useWorkspaceStore((state) => state.importState);
  const pushWarning = useWorkspaceStore((state) => state.pushWarning);
  const addPath = useWorkspaceStore((state) => state.addPath);
  const setSelected = useWorkspaceStore((state) => state.setSelected);
  const setNodeSelection = useWorkspaceStore((state) => state.setNodeSelection);
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
    event.target.value = '';
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

  const handleExportDXF = () => {
    const { paths } = getState();
    if (!paths.length) {
      pushWarning('Nothing to export', 'warning');
      return;
    }
    const dxf = serializePathsToDXF(paths);
    const blob = new Blob([dxf], { type: 'application/dxf' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'visoxid-scene.dxf';
    link.click();
    URL.revokeObjectURL(link.href);
  };

  const handleImportDXF = async (event: ChangeEvent<HTMLInputElement>) => {
    const [file] = event.target.files ?? [];
    if (!file) return;
    const text = await file.text();
    try {
      const shapes = parseDXFShapes(text);
      if (!shapes.length) {
        pushWarning('DXF contained no supported entities', 'warning');
        return;
      }
      const ids: string[] = [];
      shapes.forEach((shape, index) => {
        const nodes = shape.points.map((point) => ({
          id: createId('node'),
          point: { ...point },
          handleIn: null,
          handleOut: null,
        }));
        const metaId = createId('path');
        const pathId = addPath(nodes, {
          meta: {
            id: metaId,
            name: `${shape.kind === 'reference' ? 'Reference' : 'Imported'} ${index + 1}`,
            closed: shape.closed,
            visible: true,
            locked: false,
            color: '#2563eb',
            kind: shape.kind,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
        });
        ids.push(pathId);
      });
      if (ids.length) {
        setSelected(ids);
        setNodeSelection(null);
      }
    } catch (error) {
      console.error(error);
      pushWarning('Failed to import DXF', 'error');
    }
    event.target.value = '';
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
        <button type="button" className="toolbar-button" onClick={handleExportDXF}>
          Export DXF
        </button>
        <button type="button" className="toolbar-button" onClick={() => dxfInputRef.current?.click()}>
          Import DXF
        </button>
      </div>
      <input ref={inputRef} type="file" accept="application/json" className="hidden" onChange={handleImportJSON} />
      <input ref={dxfInputRef} type="file" accept=".dxf" className="hidden" onChange={handleImportDXF} />
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
