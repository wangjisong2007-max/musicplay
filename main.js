// MusicPlay — Electron 主进程
const { app, BrowserWindow, ipcMain, globalShortcut } = require('electron');
const path = require('path');
const { spawn } = require('child_process');

let mainWindow = null;
let serverProcess = null;
const SERVER_PORT = 3000;

function startServer() {
  return new Promise((resolve) => {
    serverProcess = spawn('node', [path.join(__dirname, 'server.js')], {
      env: { ...process.env, PORT: String(SERVER_PORT) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    serverProcess.stdout.on('data', (d) => {
      const msg = d.toString();
      if (msg.includes('listening')) resolve();
    });
    serverProcess.stderr.on('data', (d) => process.stderr.write(d));
    serverProcess.on('error', () => resolve()); // fallback
    setTimeout(resolve, 3000);
  });
}

async function createWindow() {
  await startServer();

  mainWindow = new BrowserWindow({
    width: 1200, height: 750,
    minWidth: 800, minHeight: 500,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadURL(`http://127.0.0.1:${SERVER_PORT}`);
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => {
  if (serverProcess) serverProcess.kill();
  app.quit();
});
app.on('before-quit', () => {
  if (serverProcess) serverProcess.kill();
});
