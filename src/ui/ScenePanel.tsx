import { useRef, useState, type ChangeEvent } from 'react';
import { useWorkspaceStore } from '../state';
import { createId } from '../utils/ids';
import { createCircleNodes } from '../utils/presets';
import type { Vec2 } from '../types';

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
  const importScene = useWorkspaceStore((state) => state.importSceneToLibrary);
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
  const [referenceOvalEnabled, setReferenceOvalEnabled] = useState(false);
  const [referenceOvalScale, setReferenceOvalScale] = useState(1);
  const [shapeRenameDrafts, setShapeRenameDrafts] = useState<Record<string, string>>({});
  const [sceneRenameDrafts, setSceneRenameDrafts] = useState<Record<string, string>>({});
  const sceneImportInputRef = useRef<HTMLInputElement | null>(null);

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

  const handleSceneExport = (sceneId: string) => {
    const scene = scenes.find((entry) => entry.id === sceneId);
    if (!scene) return;
    const safeName = scene.name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-');
    const filename = `${safeName || 'scene'}.visoxid-scene.json`;
    const payload = JSON.stringify({ version: 1, scene }, null, 2);
    const blob = new Blob([payload], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  const handleSceneImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const [file] = event.target.files ?? [];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const result = importScene(data);
      if (result.ok) {
        pushWarning(`Imported scene "${result.name}"`, 'info');
      } else {
        pushWarning(result.error ?? 'File is not a valid scene', 'error');
      }
    } catch (error) {
      console.error(error);
      pushWarning('Failed to import scene file', 'error');
    }
    event.target.value = '';
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
    const center = { x: 25, y: 25 };
    let nodes = createCircleNodes(center, radius);
    let name = `Reference circle (${label} μm)`;
    if (referenceOvalEnabled) {
      const scale = Number.isFinite(referenceOvalScale) && referenceOvalScale > 0 ? referenceOvalScale : 1;
      const stretch = (point: Vec2 | null | undefined): Vec2 | null | undefined => {
        if (!point) return point ?? null;
        const dx = point.x - center.x;
        return { x: center.x + dx * scale, y: point.y };
      };
      nodes = nodes.map((node) => ({
        ...node,
        point: stretch(node.point)!,
        handleIn: stretch(node.handleIn),
        handleOut: stretch(node.handleOut),
      }));
      const horizontalDiameter = diameter * scale;
      const normalizedHorizontal = Math.round(horizontalDiameter * 10) / 10;
      const horizontalLabel = Number.isInteger(normalizedHorizontal)
        ? normalizedHorizontal.toFixed(0)
        : normalizedHorizontal.toFixed(1);
      name = `Reference oval (${label}×${horizontalLabel} μm)`;
    }
    addPath(nodes, {
      meta: {
        id: createId('path'),
        name,
        closed: true,
        visible: true,
        locked: false,
        color: '#2563eb',
        kind: 'reference',
        oxidationDirection: 'inward',
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
        <label className="flex items-center gap-2 text-[11px] uppercase tracking-wide text-muted">
          <input
            type="checkbox"
            checked={referenceOvalEnabled}
            onChange={(event) => {
              setReferenceOvalEnabled(event.target.checked);
              if (!event.target.checked) {
                setReferenceOvalScale(1);
              }
            }}
            className="h-4 w-4 rounded border border-border"
          />
          <span>Convert to oval</span>
        </label>
        {referenceOvalEnabled && (
          <label className="flex flex-col gap-1">
            <span className="text-[11px] uppercase tracking-wide text-muted">
              Horizontal diameter (
              {Number.isFinite(Number.parseFloat(referenceCircleDiameter))
                ? `${(Number.parseFloat(referenceCircleDiameter) * referenceOvalScale).toFixed(1)} μm`
                : '—'}
              )
            </span>
            <input
              type="range"
              min={0.5}
              max={2}
              step={0.05}
              value={referenceOvalScale}
              onChange={(event) => setReferenceOvalScale(Number(event.target.value))}
              className="accent-accent"
            />
            <div className="flex justify-between text-[10px] text-muted">
              <span>50%</span>
              <span>200%</span>
            </div>
          </label>
        )}
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
          <div className="flex items-center justify-between text-[11px] uppercase tracking-wide text-muted">
            <span>Saved scenes</span>
            <button
              type="button"
              className="rounded-lg border border-border px-2 py-1 text-[11px] text-muted hover:bg-border/20"
              onClick={() => sceneImportInputRef.current?.click()}
            >
              Import scene
            </button>
          </div>
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
                        onClick={() => handleSceneExport(scene.id)}
                      >
                        Export
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
          <input
            ref={sceneImportInputRef}
            type="file"
            accept="application/json"
            className="hidden"
            onChange={handleSceneImport}
          />
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
