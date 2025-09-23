import type { JsonProject, WorkspaceState } from '../types';

const PROJECT_VERSION = 1;

export const exportProjectToJSON = (state: WorkspaceState): string => {
  const payload: JsonProject = {
    version: PROJECT_VERSION,
    metadata: {
      name: 'VISOXID Workspace',
      exportedAt: new Date().toISOString(),
    },
    payload: state,
  };
  return JSON.stringify(payload, null, 2);
};

export const importProjectFromJSON = (json: string): JsonProject => {
  const payload = JSON.parse(json) as JsonProject;
  if (payload.version !== PROJECT_VERSION) {
    throw new Error('Unsupported project version');
  }
  return payload;
};

export const exportProjectToPNG = async (): Promise<Blob> => {
  // Stub implementation for future raster export integration
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 768;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#0f172a';
    ctx.font = '20px Inter, sans-serif';
    ctx.fillText('PNG export will arrive soon.', 40, 80);
  }
  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob ?? new Blob()), 'image/png'));
};

export const exportProjectToSVG = async (): Promise<Blob> => {
  const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="768">
  <rect width="100%" height="100%" fill="#f8fafc" />
  <text x="48" y="96" font-family="Inter, sans-serif" font-size="24" fill="#0f172a">
    SVG export is not implemented yet.
  </text>
</svg>`;
  return new Blob([svgContent], { type: 'image/svg+xml' });
};
