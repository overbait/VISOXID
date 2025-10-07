import { app, BrowserWindow } from 'electron';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let mainWindow;

function getDistIndexPath() {
  const htmlPath = join(__dirname, '..', 'dist', 'index.html');
  if (!existsSync(htmlPath)) {
    throw new Error(
      'Missing dist/index.html. Run "npm run build" before launching the desktop shell.'
    );
  }
  return htmlPath;
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1280,
    height: 900,
    minWidth: 1024,
    minHeight: 720,
    autoHideMenuBar: true,
    webPreferences: {
      sandbox: false,
    },
  });

  window.loadFile(getDistIndexPath());

  window.on('closed', () => {
    mainWindow = null;
  });

  return window;
}

app.on('ready', () => {
  mainWindow = createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    mainWindow = createWindow();
  }
});
