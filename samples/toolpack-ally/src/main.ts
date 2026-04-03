import { app, BrowserWindow } from 'electron';
import path from 'node:path';

const createWindow = (): void => {
  const mainWindow = new BrowserWindow({
    width: 960,
    height: 640,
    title: 'Toolpack Ally',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'index.html'));

  if (process.env.ELECTRON_DEVTOOLS === 'true') {
    mainWindow.webContents.openDevTools();
  }
};

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
