import { useWorkspaceStore } from '../state';

export const StatusBar = () => {
  const paths = useWorkspaceStore((state) => state.paths);
  const warnings = useWorkspaceStore((state) => state.warnings);
  const dismissWarning = useWorkspaceStore((state) => state.dismissWarning);
  const dirty = useWorkspaceStore((state) => state.dirty);

  return (
    <div className="flex items-center justify-between rounded-2xl border border-border bg-white/70 px-4 py-3 text-xs text-muted shadow">
      <div className="flex items-center gap-4">
        <span>
          <strong className="text-text">{paths.length}</strong> paths
        </span>
        <span>{dirty ? 'Unsaved changes' : 'Synced'}</span>
      </div>
      <div className="flex items-center gap-2">
        {warnings.map((warning) => (
          <button
            key={warning.id}
            type="button"
            className="rounded-full bg-warning/20 px-3 py-1 text-[11px] font-medium text-warning hover:bg-warning/30"
            onClick={() => dismissWarning(warning.id)}
          >
            {warning.message}
          </button>
        ))}
        {warnings.length === 0 && <span className="text-[11px]">All systems clear</span>}
      </div>
    </div>
  );
};
