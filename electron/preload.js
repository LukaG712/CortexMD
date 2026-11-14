const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("cortexDesktop", {
  isDesktop: true,
  openVaultFolder: () => ipcRenderer.invoke("open-vault-folder"),
  openDataFolder: () => ipcRenderer.invoke("open-data-folder"),
  getDesktopInfo: () => ipcRenderer.invoke("get-desktop-info"),
});
