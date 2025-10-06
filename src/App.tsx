import { useEffect, useRef, type CSSProperties } from 'react';
import { CanvasViewport } from './ui/CanvasViewport';
import { DirectionalCompass } from './ui/DirectionalCompass';
import { ToolPanel } from './ui/ToolPanel';
import { OxidationPanel } from './ui/OxidationPanel';
import { GridMirrorPanel } from './ui/GridMirrorPanel';
import { MeasurementPanel } from './ui/MeasurementPanel';
import { StatusBar } from './ui/StatusBar';
import { ImportExportPanel } from './ui/ImportExportPanel';
import { ScenePanel } from './ui/ScenePanel';
import { PathTypePanel } from './ui/PathTypePanel';
import { useKeyboardShortcuts } from './ui/useKeyboardShortcuts';
import { useWorkspaceStore } from './state';
import { createId } from './utils/ids';
import { createCircleNodes } from './utils/presets';

interface SidebarToggleButtonProps {
  collapsed: boolean;
  onToggle: () => void;
}

const SidebarToggleButton = ({ collapsed, onToggle }: SidebarToggleButtonProps) => (
  <button
    type="button"
    className="self-end rounded-full border border-border bg-surface px-4 py-2 text-xs font-semibold uppercase tracking-wide text-accent shadow transition hover:bg-surface/90"
    onClick={onToggle}
  >
    {collapsed ? 'Expand panels' : 'Collapse panels'}
  </button>
);

export const App = () => {
  useKeyboardShortcuts();
  const addPath = useWorkspaceStore((state) => state.addPath);
  const pushWarning = useWorkspaceStore((state) => state.pushWarning);
  const pathCount = useWorkspaceStore((state) => state.paths.length);
  const bootstrapped = useWorkspaceStore((state) => state.bootstrapped);
  const markBootstrapped = useWorkspaceStore((state) => state.markBootstrapped);
  const panelCollapse = useWorkspaceStore((state) => state.panelCollapse);
  const setPanelCollapsed = useWorkspaceStore((state) => state.setPanelCollapsed);
  const rightCollapsed = panelCollapse.rightSidebar;

  const rightColumnWidth = rightCollapsed ? 'max-content' : '320px';

  const gridStyle = { ['--right-column' as const]: rightColumnWidth } as CSSProperties;

  const bootstrapGuard = useRef(false);

  useEffect(() => {
    if (bootstrapGuard.current) return;
    bootstrapGuard.current = true;
    if (!bootstrapped) {
      if (pathCount === 0) {
        addPath(createCircleNodes({ x: 25, y: 25 }, 18), {
          meta: {
            id: createId('path'),
            name: 'Reference circle',
            closed: true,
            visible: true,
            locked: false,
            color: '#2563eb',
            kind: 'oxided',
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
        });
        pushWarning('Demo geometry loaded', 'info');
      }
      markBootstrapped();
    }
  }, [addPath, bootstrapped, markBootstrapped, pathCount, pushWarning]);

  return (
    <div className="min-h-screen bg-background px-4 py-6 text-text sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-screen-2xl flex-col gap-6">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">VISOXID Workbench</h1>
            <p className="text-sm text-muted">Oxidation-aware contour planning with live measurement feedback.</p>
          </div>
        </header>
        <main
          className="grid grid-cols-1 gap-6 xl:[grid-template-columns:280px_minmax(0,1fr)_var(--right-column,320px)]"
          style={gridStyle}
        >
          <div className="flex flex-col gap-4">
            <DirectionalCompass />
            <ToolPanel />
            <ImportExportPanel />
            <GridMirrorPanel />
          </div>
          <CanvasViewport />
          <div className="flex flex-col items-stretch gap-4">
            <SidebarToggleButton
              collapsed={rightCollapsed}
              onToggle={() => setPanelCollapsed(!rightCollapsed)}
            />
            {!rightCollapsed && (
              <>
                <OxidationPanel />
                <PathTypePanel />
                <ScenePanel />
                <MeasurementPanel />
              </>
            )}
          </div>
        </main>
        <StatusBar />
      </div>
    </div>
  );
};

export default App;
