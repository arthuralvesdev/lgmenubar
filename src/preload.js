const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
    getState: () => ipcRenderer.invoke("tv:get-state"),
    getConfig: () => ipcRenderer.invoke("tv:get-config"),
    saveConfig: (cfg) => ipcRenderer.invoke("tv:save-config", cfg),
    connect: () => ipcRenderer.invoke("tv:connect"),
    disconnect: () => ipcRenderer.invoke("tv:disconnect"),
    pair: () => ipcRenderer.invoke("tv:pair"),
    power: () => ipcRenderer.invoke("tv:power"),
    setVolume: (val) => ipcRenderer.invoke("tv:set-volume", val),
    volumeStep: (up) => ipcRenderer.invoke("tv:volume-step", up),
    toggleMute: () => ipcRenderer.invoke("tv:toggle-mute"),
    pressButton: (name) => ipcRenderer.invoke("tv:press-button", name),
    movePointer: (dx, dy) => ipcRenderer.invoke("tv:move-pointer", dx, dy),
    clickPointer: () => ipcRenderer.invoke("tv:click-pointer"),
    launchApp: (id) => ipcRenderer.invoke("tv:launch-app", id),
    switchInput: (id) => ipcRenderer.invoke("tv:switch-input", id),
    mediaControl: (cmd) => ipcRenderer.invoke("tv:media-control", cmd),
    getPicture: () => ipcRenderer.invoke("tv:get-picture"),
    setPicture: (settings) => ipcRenderer.invoke("tv:set-picture", settings),
    getUsage: (days) => ipcRenderer.invoke("tv:get-usage", days),
    discover: () => ipcRenderer.invoke("tv:discover"),
    onUpdate: (cb) => {
        const handler = (_event, data) => cb(data);
        ipcRenderer.on("tv:state", handler);
        return () => ipcRenderer.removeListener("tv:state", handler);
    },
    onPrompt: (cb) => {
        const handler = (_event, data) => cb(data);
        ipcRenderer.on("tv:prompt", handler);
        return () => ipcRenderer.removeListener("tv:prompt", handler);
    },
    minimizeWindow: () => ipcRenderer.invoke("win:minimize"),
    hideWindow: () => ipcRenderer.invoke("win:hide")
});
