import { useEffect } from 'react';
import { CanvasViewport } from './ui/CanvasViewport';
import { ToolPanel } from './ui/ToolPanel';
import { OxidationPanel } from './ui/OxidationPanel';
import { GridMirrorPanel } from './ui/GridMirrorPanel';
import { MeasurementPanel } from './ui/MeasurementPanel';
import { StatusBar } from './ui/StatusBar';
import { ImportExportPanel } from './ui/ImportExportPanel';
import { useKeyboardShortcuts } from './ui/useKeyboardShortcuts';
import { useWorkspaceStore } from './state';
import { createId } from './utils/ids';
import type { PathNode } from './types';

const createDemoNodes = (): PathNode[] => [
  {
    id: createId('node'),
    point: { x: 180, y: 240 },
    handleOut: { x: 260, y: 180 },
  },
  {
    id: createId('node'),
    point: { x: 360, y: 160 },
    handleIn: { x: 300, y: 140 },
    handleOut: { x: 420, y: 180 },
  },
  {
    id: createId('node'),
    point: { x: 480, y: 320 },
    handleIn: { x: 460, y: 220 },
    handleOut: { x: 520, y: 360 },
  },
  {
    id: createId('node'),
    point: { x: 340, y: 420 },
    handleIn: { x: 420, y: 400 },
    handleOut: { x: 260, y: 460 },
  },
  {
    id: createId('node'),
    point: { x: 200, y: 360 },
    handleIn: { x: 240, y: 420 },
  },
];

export const App = () => {
  useKeyboardShortcuts();
  const addPath = useWorkspaceStore((state) => state.addPath);
  const pushWarning = useWorkspaceStore((state) => state.pushWarning);
  const pathCount = useWorkspaceStore((state) => state.paths.length);

  useEffect(() => {
    if (pathCount === 0) {
      addPath(createDemoNodes(), {
        meta: {
          id: createId('path'),
          name: 'Demo contour',
          closed: false,
          visible: true,
          locked: false,
          color: '#2563eb',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      });
      pushWarning('Demo geometry loaded', 'info');
    }
  }, [addPath, pathCount, pushWarning]);

  return (
    <div className="min-h-screen bg-background px-6 py-8 text-text">
      <div className="mx-auto flex max-w-7xl flex-col gap-6">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">VISOXID Workbench</h1>
            <p className="text-sm text-muted">Oxidation-aware contour planning with live measurement feedback.</p>
          </div>
        </header>
        <main className="grid grid-cols-1 gap-6 lg:grid-cols-[280px_1fr_320px]">
          <div className="flex flex-col gap-4">
            <ToolPanel />
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
