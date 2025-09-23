import { useState } from 'react';
import { useWorkspaceStore } from '../state';
import { createId } from '../utils/ids';
import { createCircleNodes } from '../utils/presets';

export const ScenePanel = () => {
  const selectedPathIds = useWorkspaceStore((state) => state.selectedPathIds);
  const paths = useWorkspaceStore((state) => state.paths);
  const saveShape = useWorkspaceStore((state) => state.saveShapeToLibrary);
  const removeShape = useWorkspaceStore((state) => state.removeShapeFromLibrary);
  const renameShape = useWorkspaceStore((state) => state.renameShapeInLibrary);
  const loadShape = useWorkspaceStore((state) => state.loadShapeFromLibrary);
  const resetScene = useWorkspaceStore((state) => state.resetScene);
  const removePath = useWorkspaceStore((state) => state.removePath);
  const addPath = useWorkspaceStore((state) => state.addPath);
  const library = useWorkspaceStore((state) => state.library);
  const [shapeName, setShapeName] = useState('');
  const [renameDrafts, setRenameDrafts] = useState<Record<string, string>>({});

  const selectedPath = paths.find((path) => path.meta.id === selectedPathIds[0]);
  const handleSave = () => {
    if (!selectedPath) return;
    saveShape(selectedPath.meta.id, shapeName || selectedPath.meta.name);
    setShapeName('');
  };

  const handleRenameCommit = (id: string) => {
    const draft = renameDrafts[id];
    if (draft !== undefined) {
      renameShape(id, draft);
    }
  };

  return (
    <div className="panel flex flex-col gap-4 p-4 text-xs text-muted">
      <div className="section-title">Scene</div>
      <div className="flex flex-col gap-2 text-xs">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] uppercase tracking-wide text-muted">Shape name</span>
          <input
            type="text"
            value={shapeName}
            onChange={(event) => setShapeName(event.target.value)}
            placeholder={selectedPath ? selectedPath.meta.name : 'Select a path'}
            className="rounded-xl border border-border bg-white/80 px-3 py-2 text-sm text-text focus:border-accent focus:outline-none"
          />
        </label>
        <button
          type="button"
          className="toolbar-button"
          onClick={handleSave}
          disabled={!selectedPath}
        >
          Save shape to library
        </button>
        <button
          type="button"
          className="toolbar-button"
          onClick={() => selectedPath && removePath(selectedPath.meta.id)}
          disabled={!selectedPath}
        >
          Delete selected path
        </button>
        <button
          type="button"
          className="toolbar-button"
          onClick={() => {
            resetScene();
            setShapeName('');
          }}
        >
          Reset canvas
        </button>
        <button
          type="button"
          className="toolbar-button"
          onClick={() =>
            addPath(createCircleNodes({ x: 360, y: 320 }, 180), {
              meta: {
                id: createId('path'),
                name: 'Reference circle',
                closed: true,
                visible: true,
                locked: false,
                color: '#2563eb',
                createdAt: Date.now(),
                updatedAt: Date.now(),
              },
            })
          }
        >
          Add reference circle
        </button>
      </div>
      <div className="rounded-2xl border border-dashed border-border/70 bg-white/60 p-3">
        {library.length === 0 ? (
          <div className="text-xs">Saved shapes will appear here. Capture any contour to reuse it later.</div>
        ) : (
          <ul className="flex flex-col gap-2">
            {library.map((shape) => (
              <li key={shape.id} className="flex flex-col gap-2 rounded-xl bg-white/80 p-3 shadow-sm">
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    defaultValue={shape.name}
                    onChange={(event) =>
                      setRenameDrafts((drafts) => ({ ...drafts, [shape.id]: event.target.value }))
                    }
                    onBlur={() => handleRenameCommit(shape.id)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        handleRenameCommit(shape.id);
                        event.currentTarget.blur();
                      }
                    }}
                    className="flex-1 rounded-lg border border-border bg-white/80 px-2 py-1 text-sm text-text focus:border-accent focus:outline-none"
                  />
                  <button
                    type="button"
                    className="rounded-lg border border-accent px-2 py-1 text-[11px] font-semibold text-accent hover:bg-accent/10"
                    onClick={() => loadShape(shape.id)}
                  >
                    Load
                  </button>
                  <button
                    type="button"
                    className="rounded-lg border border-border px-2 py-1 text-[11px] text-muted hover:bg-border/20"
                    onClick={() => removeShape(shape.id)}
                  >
                    Delete
                  </button>
                </div>
                <div className="flex justify-between text-[10px] uppercase tracking-widest text-muted">
                  <span>{shape.nodes.length} pts</span>
                  <span>Saved {new Date(shape.updatedAt).toLocaleDateString()}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};
