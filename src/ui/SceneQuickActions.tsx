import { useWorkspaceStore } from '../state';

export const SceneQuickActions = () => {
  const selectedPathIds = useWorkspaceStore((state) => state.selectedPathIds);
  const removePath = useWorkspaceStore((state) => state.removePath);
  const resetScene = useWorkspaceStore((state) => state.resetScene);

  const selectedPathId = selectedPathIds[0];

  return (
    <div className="rounded-2xl border border-border/70 bg-white/70 p-4 text-xs text-muted">
      <div className="text-[11px] uppercase tracking-wide text-muted">Scene actions</div>
      <div className="mt-3 flex flex-col gap-2">
        <button
          type="button"
          className="toolbar-button w-full"
          onClick={() => selectedPathId && removePath(selectedPathId)}
          disabled={!selectedPathId}
        >
          Delete selected path
        </button>
        <button type="button" className="toolbar-button w-full" onClick={() => resetScene()}>
          Reset canvas
        </button>
      </div>
    </div>
  );
};
