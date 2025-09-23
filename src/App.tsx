import { useEffect } from 'react';
import { CanvasViewport } from './ui/CanvasViewport';
import { ToolPanel } from './ui/ToolPanel';
import { ScenePanel } from './ui/ScenePanel';
import { OxidationPanel } from './ui/OxidationPanel';
import { GridMirrorPanel } from './ui/GridMirrorPanel';
import { MeasurementPanel } from './ui/MeasurementPanel';
import { StatusBar } from './ui/StatusBar';
import { ImportExportPanel } from './ui/ImportExportPanel';
import { useKeyboardShortcuts } from './ui/useKeyboardShortcuts';
import { useWorkspaceStore } from './state';
import { createId } from './utils/ids';
import { createCircleNodes } from './utils/presets';

export const App = () => {
  useKeyboardShortcuts();
  const addPath = useWorkspaceStore((state) => state.addPath);
  const pushWarning = useWorkspaceStore((state) => state.pushWarning);
  const pathCount = useWorkspaceStore((state) => state.paths.length);
  const bootstrapped = useWorkspaceStore((state) => state.bootstrapped);
  const markBootstrapped = useWorkspaceStore((state) => state.markBootstrapped);

  useEffect(() => {
    if (!bootstrapped && pathCount === 0) {
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
      });
      pushWarning('Demo geometry loaded', 'info');
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
        <main className="grid grid-cols-1 gap-6 xl:grid-cols-[280px_minmax(0,1fr)_320px]">
          <div className="flex flex-col gap-4">
            <ToolPanel />
            <ScenePanel />
            <ImportExportPanel />
          </div>
          <CanvasViewport />
          <div className="flex flex-col gap-4">
            <OxidationPanel />
            <GridMirrorPanel />
            <MeasurementPanel />
          </div>
        </main>
        <StatusBar />
      </div>
    </div>
  );
};

export default App;
