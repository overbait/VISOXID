import { useState } from 'react';
import { useWorkspaceStore } from '../state';
import { createId } from '../utils/ids';
import { createCircleNodes } from '../utils/presets';

export const ScenePanel = () => {
  const selectedPathIds = useWorkspaceStore((state) => state.selectedPathIds);
  const paths = useWorkspaceStore((state) => state.paths);
  const saveShape = useWorkspaceStore((state) => state.saveShapeToLibrary);
  const saveScene = useWorkspaceStore((state) => state.saveSceneToLibrary);
  const removeShape = useWorkspaceStore((state) => state.removeShapeFromLibrary);
  const removeScene = useWorkspaceStore((state) => state.removeSceneFromLibrary);
  const renameShape = useWorkspaceStore((state) => state.renameShapeInLibrary);
  const renameScene = useWorkspaceStore((state) => state.renameSceneInLibrary);
  const loadShape = useWorkspaceStore((state) => state.loadShapeFromLibrary);
  const loadStoredScene = useWorkspaceStore((state) => state.loadSceneFromLibrary);
  const resetScene = useWorkspaceStore((state) => state.resetScene);
  const removePath = useWorkspaceStore((state) => state.removePath);
  const addPath = useWorkspaceStore((state) => state.addPath);
  const pushWarning = useWorkspaceStore((state) => state.pushWarning);
  const nodeSelection = useWorkspaceStore((state) => state.nodeSelection);
  const setNodeCurveMode = useWorkspaceStore((state) => state.setNodeCurveMode);
  const library = useWorkspaceStore((state) => state.library);
  const scenes = useWorkspaceStore((state) => state.scenes);
  const [saveName, setSaveName] = useState('');
  const [referenceCircleDiameter, setReferenceCircleDiameter] = useState('36');
  const [shapeRenameDrafts, setShapeRenameDrafts] = useState<Record<string, string>>({});
  const [sceneRenameDrafts, setSceneRenameDrafts] = useState<Record<string, string>>({});

  const selectedPath = paths.find((path) => path.meta.id === selectedPathIds[0]);
  const activeNodeId =
    nodeSelection && selectedPath && nodeSelection.pathId === selectedPath.meta.id
      ? nodeSelection.nodeIds[0]
      : undefined;
  const activeNode = selectedPath?.nodes.find((node) => node.id === activeNodeId);
  const isBezierNode = (() => {
    if (!selectedPath || !activeNode) return false;
    const index = selectedPath.nodes.findIndex((node) => node.id === activeNode.id);
    if (index === -1) return false;
    const prevIndex = index === 0 ? selectedPath.nodes.length - 1 : index - 1;
    const nextIndex = (index + 1) % selectedPath.nodes.length;
    const hasPrevSegment = selectedPath.meta.closed || index > 0;
    const hasNextSegment = selectedPath.meta.closed || index < selectedPath.nodes.length - 1;
    return (
      Boolean(activeNode.handleIn) ||
      Boolean(activeNode.handleOut) ||
      (hasPrevSegment && Boolean(selectedPath.nodes[prevIndex]?.handleOut)) ||
      (hasNextSegment && Boolean(selectedPath.nodes[nextIndex]?.handleIn))
    );
  })();

  const handleShapeSave = () => {
    if (!selectedPath) return;
    saveShape(selectedPath.meta.id, saveName || selectedPath.meta.name);
  };

  const handleSceneSave = () => {
    const fallback = selectedPath?.meta.name ?? 'Untitled scene';
    saveScene(saveName || fallback);
  };

  const handleShapeRenameCommit = (id: string) => {
    const draft = shapeRenameDrafts[id];
    if (draft !== undefined) {
      renameShape(id, draft);
    }
  };

  const handleSceneRenameCommit = (id: string) => {
    const draft = sceneRenameDrafts[id];
    if (draft !== undefined) {
      renameScene(id, draft);
    }
  };

  const handleAddReferenceCircle = () => {
    const diameter = Number.parseFloat(referenceCircleDiameter);
    if (!Number.isFinite(diameter) || diameter <= 0) {
      pushWarning('Enter a positive diameter before adding the circle', 'warning');
      return;
    }
    const radius = diameter / 2;
    const normalized = Math.round(diameter * 10) / 10;
    const label = Number.isInteger(normalized) ? normalized.toFixed(0) : normalized.toFixed(1);
    addPath(createCircleNodes({ x: 25, y: 25 }, radius), {
      meta: {
        id: createId('path'),
        name: `Reference circle (${label} μm)`,
        closed: true,
        visible: true,
        locked: false,
        color: '#2563eb',
        kind: 'reference',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    });
  };

  return (
    <div className="panel flex flex-col gap-4 p-4 text-xs text-muted">
      <div className="section-title">Scene</div>
      <div className="flex flex-col gap-3 text-xs">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] uppercase tracking-wide text-muted">Name</span>
          <input
            type="text"
            value={saveName}
            onChange={(event) => setSaveName(event.target.value)}
            placeholder={selectedPath ? selectedPath.meta.name : 'Untitled'}
            className="rounded-xl border border-border bg-white/80 px-3 py-2 text-sm text-text focus:border-accent focus:outline-none"
          />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" className="toolbar-button" onClick={handleShapeSave} disabled={!selectedPath}>
            Save shape
          </button>
          <button type="button" className="toolbar-button" onClick={handleSceneSave} disabled={paths.length === 0}>
            Save scene
          </button>
        </div>
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
          }}
        >
          Reset canvas
        </button>
        <button type="button" className="toolbar-button" onClick={handleAddReferenceCircle}>
          Add reference circle
        </button>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] uppercase tracking-wide text-muted">Circle diameter (μm)</span>
          <input
            type="number"
            min="0"
            step="0.5"
            value={referenceCircleDiameter}
            onChange={(event) => setReferenceCircleDiameter(event.target.value)}
            className="rounded-xl border border-border bg-white/80 px-3 py-2 text-sm text-text focus:border-accent focus:outline-none"
          />
        </label>
      </div>
      {selectedPath && activeNode && selectedPath.meta.kind !== 'reference' && (
        <div className="flex flex-col gap-3 rounded-2xl border border-dashed border-border/70 bg-white/70 p-3 text-xs text-muted">
          <div className="text-[11px] uppercase tracking-wide text-muted">Selected node</div>
          <div className="flex justify-between text-[11px] font-semibold text-text">
            <span>{activeNodeId?.slice(-6)}</span>
            <span>
              ({activeNode.point.x.toFixed(1)} μm, {activeNode.point.y.toFixed(1)} μm)
            </span>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              className={`flex-1 rounded-xl border px-3 py-2 text-xs font-semibold transition ${
                isBezierNode ? 'border-border text-muted hover:bg-border/20' : 'border-accent text-accent'
              }`}
              onClick={() => setNodeCurveMode(selectedPath.meta.id, activeNode.id, 'line')}
              disabled={!isBezierNode}
            >
              Straight
            </button>
            <button
              type="button"
              className={`flex-1 rounded-xl border px-3 py-2 text-xs font-semibold transition ${
                isBezierNode ? 'border-accent text-accent' : 'border-border text-muted hover:bg-border/20'
              }`}
              onClick={() => setNodeCurveMode(selectedPath.meta.id, activeNode.id, 'bezier')}
              disabled={isBezierNode}
            >
              Bézier
            </button>
          </div>
        </div>
      )}
      <div className="rounded-2xl border border-dashed border-border/70 bg-white/60 p-3">
        <div className="flex flex-col gap-2">
          <div className="text-[11px] uppercase tracking-wide text-muted">Saved scenes</div>
          {scenes.length === 0 ? (
            <div className="text-xs">Capture a scene to preserve the full workspace configuration.</div>
          ) : (
            <ul className="flex flex-col gap-2">
              {scenes.map((scene) => {
                const draft = sceneRenameDrafts[scene.id] ?? scene.name;
                return (
                  <li key={scene.id} className="flex flex-col gap-2 rounded-xl bg-white/80 p-3 shadow-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        type="text"
                        value={draft}
                        onChange={(event) =>
                          setSceneRenameDrafts((drafts) => ({ ...drafts, [scene.id]: event.target.value }))
                        }
                        onBlur={() => handleSceneRenameCommit(scene.id)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            handleSceneRenameCommit(scene.id);
                            event.currentTarget.blur();
                          }
                        }}
                        className="min-w-[140px] flex-1 rounded-lg border border-border bg-white/80 px-2 py-1 text-sm text-text focus:border-accent focus:outline-none"
                      />
                      <button
                        type="button"
                        className="shrink-0 rounded-lg border border-accent px-2 py-1 text-[11px] font-semibold text-accent hover:bg-accent/10"
                        onClick={() => loadStoredScene(scene.id)}
                      >
                        Load
                      </button>
                      <button
                        type="button"
                        className="shrink-0 rounded-lg border border-border px-2 py-1 text-[11px] text-muted hover:bg-border/20"
                        onClick={() => removeScene(scene.id)}
                      >
                        Delete
                      </button>
                    </div>
                    <div className="flex flex-wrap justify-between gap-2 text-[10px] uppercase tracking-widest text-muted">
                      <span>{scene.state.paths.length} paths</span>
                      <span>Saved {new Date(scene.updatedAt).toLocaleDateString()}</span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <div className="my-3 h-px bg-border/60" />
        <div className="flex flex-col gap-2">
          <div className="text-[11px] uppercase tracking-wide text-muted">Saved shapes</div>
          {library.length === 0 ? (
            <div className="text-xs">Saved shapes will appear here. Capture any contour to reuse it later.</div>
          ) : (
            <ul className="flex flex-col gap-2">
              {library.map((shape) => {
                const draft = shapeRenameDrafts[shape.id] ?? shape.name;
                return (
                  <li key={shape.id} className="flex flex-col gap-2 rounded-xl bg-white/80 p-3 shadow-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        type="text"
                        value={draft}
                        onChange={(event) =>
                          setShapeRenameDrafts((drafts) => ({ ...drafts, [shape.id]: event.target.value }))
                        }
                        onBlur={() => handleShapeRenameCommit(shape.id)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            handleShapeRenameCommit(shape.id);
                            event.currentTarget.blur();
                          }
                        }}
                        className="min-w-[140px] flex-1 rounded-lg border border-border bg-white/80 px-2 py-1 text-sm text-text focus:border-accent focus:outline-none"
                      />
                      <button
                        type="button"
                        className="shrink-0 rounded-lg border border-accent px-2 py-1 text-[11px] font-semibold text-accent hover:bg-accent/10"
                        onClick={() => loadShape(shape.id)}
                      >
                        Load
                      </button>
                      <button
                        type="button"
                        className="shrink-0 rounded-lg border border-border px-2 py-1 text-[11px] text-muted hover:bg-border/20"
                        onClick={() => removeShape(shape.id)}
                      >
                        Delete
                      </button>
                    </div>
                    <div className="flex flex-wrap justify-between gap-2 text-[10px] uppercase tracking-widest text-muted">
                      <span>{shape.nodes.length} pts</span>
                      <span>Saved {new Date(shape.updatedAt).toLocaleDateString()}</span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
};
