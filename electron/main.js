const { app, BrowserWindow, Menu, shell, ipcMain } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const net = require("node:net");
const http = require("node:http");
const { fork } = require("node:child_process");

let mainWindow = null;
let serverProcess = null;

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
    srv.on("error", reject);
  });
}

function waitForServer(url, timeoutMs = 25000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      const req = http.get(url, (res) => {
        if (res.statusCode && res.statusCode < 500) {
          resolve();
        } else {
          retry();
        }
      });
      req.on("error", () => retry());
      req.end();
    };
    const retry = () => {
      if (Date.now() - start > timeoutMs) {
        reject(new Error(`Timeout waiting for internal server at ${url}`));
      } else {
        setTimeout(check, 250);
      }
    };
    check();
  });
}

function resolveDataDir() {
  if (process.env.CORTEX_DATA_DIR?.trim()) {
    return path.resolve(process.env.CORTEX_DATA_DIR.trim());
  }
  // Store user notes in Documents/CortexMD by default so they are easily accessible in Windows Explorer
  const docs = app.getPath("documents");
  const dataDir = path.join(docs, "CortexMD");
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(path.join(dataDir, "vaults"), { recursive: true });
  fs.mkdirSync(path.join(dataDir, "backups"), { recursive: true });
  return dataDir;
}

function resolveServerPath() {
  if (app.isPackaged) {
    const packagedPath = path.join(process.resourcesPath, "standalone", "server.js");
    if (fs.existsSync(packagedPath)) return packagedPath;
  }
  return path.join(__dirname, "..", ".next", "standalone", "server.js");
}

async function startServer() {
  const isDev = process.env.ELECTRON_DEV === "true";
  if (isDev) {
    // In dev mode, connect directly to running next dev server
    return process.env.DEV_SERVER_URL || "http://localhost:3000";
  }

  const port = await getFreePort();
  const dataDir = resolveDataDir();
  const serverPath = resolveServerPath();

  if (!fs.existsSync(serverPath)) {
    throw new Error(
      `Standalone server file not found at ${serverPath}. Please build the project first with npm run build.`,
    );
  }

  const serverEnv = {
    ...process.env,
    PORT: String(port),
    HOSTNAME: "127.0.0.1",
    NODE_ENV: "production",
    STANDALONE_DESKTOP: "true",
    DESKTOP_AUTO_LOGIN: "true",
    CORTEX_DATA_DIR: dataDir,
  };

  process.env.CORTEX_DATA_DIR = dataDir;

  serverProcess = fork(serverPath, [], {
    env: serverEnv,
    stdio: "inherit",
  });

  serverProcess.on("exit", (code) => {
    if (code !== 0 && !app.isQuitting) {
      console.error(`CortexMD background server exited with code ${code}`);
    }
  });

  const targetUrl = `http://127.0.0.1:${port}`;
  await waitForServer(`${targetUrl}/api/health`);
  return targetUrl;
}

function setupIpc(dataDir) {
  ipcMain.handle("open-vault-folder", async () => {
    const vaultsDir = path.join(dataDir, "vaults");
    fs.mkdirSync(vaultsDir, { recursive: true });
    await shell.openPath(vaultsDir);
    return true;
  });

  ipcMain.handle("open-data-folder", async () => {
    await shell.openPath(dataDir);
    return true;
  });

  ipcMain.handle("get-desktop-info", () => {
    return {
      isDesktop: true,
      dataDir,
      version: app.getVersion(),
    };
  });
}

function buildMenu(dataDir) {
  const isMac = process.platform === "darwin";
  const template = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: "about" },
              { type: "separator" },
              { role: "services" },
              { type: "separator" },
              { role: "hide" },
              { role: "hideOthers" },
              { role: "unhide" },
              { type: "separator" },
              { role: "quit" },
            ],
          },
        ]
      : []),
    {
      label: "Bestand",
      submenu: [
        {
          label: "Open Kluis in Verkenner",
          accelerator: "CmdOrCtrl+O",
          click: () => {
            const vaultsDir = path.join(dataDir, "vaults");
            fs.mkdirSync(vaultsDir, { recursive: true });
            shell.openPath(vaultsDir);
          },
        },
        {
          label: "Open Data Map",
          click: () => {
            shell.openPath(dataDir);
          },
        },
        { type: "separator" },
        isMac ? { role: "close" } : { role: "quit", label: "Afsluiten" },
      ],
    },
    {
      label: "Bewerken",
      submenu: [
        { role: "undo", label: "Ongedaan maken" },
        { role: "redo", label: "Opnieuw uitvoeren" },
        { type: "separator" },
        { role: "cut", label: "Knippen" },
        { role: "copy", label: "Kopiëren" },
        { role: "paste", label: "Plakken" },
        { role: "selectAll", label: "Alles selecteren" },
      ],
    },
    {
      label: "Beeld",
      submenu: [
        { role: "reload", label: "Herladen" },
        { role: "forceReload", label: "Geforceerd herladen" },
        { role: "toggleDevTools", label: "Ontwikkelhulpprogramma's" },
        { type: "separator" },
        { role: "resetZoom", label: "Oorspronkelijke zoom" },
        { role: "zoomIn", label: "Inzoomen" },
        { role: "zoomOut", label: "Uitzoomen" },
        { type: "separator" },
        { role: "togglefullscreen", label: "Volledig scherm" },
      ],
    },
    {
      label: "Help",
      submenu: [
        {
          label: "CortexMD Documentatie",
          click: () => {
            shell.openExternal("https://github.com/LukaG712/CortexMD");
          },
        },
        {
          label: "Over CortexMD",
          click: () => {
            const { dialog } = require("electron");
            dialog.showMessageBox(mainWindow, {
              type: "info",
              title: "Over CortexMD",
              message: "CortexMD Standalone Desktop",
              detail: `Versie ${app.getVersion()}\nOffline Markdown & AI Knowledge Platform\nOpslaglocatie: ${dataDir}`,
            });
          },
        },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

async function createWindow() {
  const dataDir = resolveDataDir();
  setupIpc(dataDir);
  buildMenu(dataDir);

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: "#0b0d10",
    title: "CortexMD",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Handle external links in native system browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http:") || url.startsWith("https:")) {
      shell.openExternal(url);
      return { action: "deny" };
    }
    return { action: "allow" };
  });

  const appUrl = await startServer();
  await mainWindow.loadURL(appUrl);

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    try {
      await createWindow();
    } catch (err) {
      console.error("Failed to start CortexMD Desktop:", err);
      app.quit();
    }

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

function cleanUpServer() {
  if (serverProcess) {
    try {
      serverProcess.kill("SIGTERM");
    } catch {
      // ignore
    }
    serverProcess = null;
  }
}

app.on("before-quit", () => {
  app.isQuitting = true;
  cleanUpServer();
});

app.on("window-all-closed", () => {
  cleanUpServer();
  if (process.platform !== "darwin") {
    app.quit();
  }
});
