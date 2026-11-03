const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("lattice", {
  invoke: (command, args) => ipcRenderer.invoke("lattice:invoke", command, args),
  onMenuAction: (callback) => {
    const listener = (_event, action, payload) => callback(action, payload);
    ipcRenderer.on("lattice:menu-action", listener);
    return () => ipcRenderer.removeListener("lattice:menu-action", listener);
  },
});
