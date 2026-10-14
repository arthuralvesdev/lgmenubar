const { app, BrowserWindow, Tray, Menu, ipcMain, screen, nativeImage } = require("electron");
const path = require("path");
const fs = require("fs");
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const WebOSClient = require("./webos");
const { loadConfig, updateConfig, loadUsage, recordUsage } = require("./config");

let tray = null;
let window = null;
let client = null;
let reconnectTimer = null;
let pollTimer = null;

let state = {
    connected: false,
    connecting: false,
    pairing: false,
    promptActive: false,
    name: "LG TV",
    host: "",
    mac: "",
    model: "LG webOS TV",
    volume: 0,
    muted: false,
    hasVolume: false,
    foregroundId: "",
    foregroundTitle: "TV is on",
    apps: [],
    inputs: [],
    picture: {},
    error: null,
    notice: null
};

// Load app catalog
let catalog = [];
try {
    const catalogPath = path.join(__dirname, "app-catalog.json");
    if (fs.existsSync(catalogPath)) {
        catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
    }
} catch (_) {}

function getCatalogApp(id) {
    return catalog.find(a => a.id === id);
}

function notifyState() {
    if (window && !window.isDestroyed()) {
        window.webContents.send("tv:state", state);
    }
    updateTrayMenu();
}

function updateTrayMenu() {
    if (!tray) return;
    const contextMenu = Menu.buildFromTemplate([
        {
            label: `${state.name} (${state.connected ? "Ligada" : "Desconectada"})`,
            enabled: false
        },
        { type: "separator" },
        {
            label: state.connected ? "Desligar TV" : "Ligar TV (Wake-on-LAN)",
            click: () => handlePower()
        },
        {
            label: state.muted ? "Desativar Mudo" : "Ativar Mudo",
            enabled: state.connected,
            click: () => handleToggleMute()
        },
        {
            label: "Aumentar Volume (+)",
            enabled: state.connected,
            click: () => handleVolumeStep(true)
        },
        {
            label: "Diminuir Volume (-)",
            enabled: state.connected,
            click: () => handleVolumeStep(false)
        },
        { type: "separator" },
        {
            label: window && window.isVisible() ? "Ocultar Controle" : "Abrir Controle",
            click: () => toggleWindow()
        },
        {
            label: "Sair",
            click: () => {
                app.isQuitting = true;
                app.quit();
            }
        }
    ]);
    tray.setContextMenu(contextMenu);
    tray.setToolTip(`LGwebOS - ${state.name} (${state.connected ? "Conectado" : "Desconectado"})`);
}

function createWindow() {
    const startInTray = process.argv.includes("--tray");
    window = new BrowserWindow({
        width: 360,
        height: 720,
        show: !startInTray,
        frame: false,
        resizable: false,
        skipTaskbar: false,
        backgroundColor: "#0f1115",
        webPreferences: {
            preload: path.join(__dirname, "preload.js"),
            contextIsolation: true,
            nodeIntegration: false
        }
    });

    window.loadFile(path.join(__dirname, "renderer", "index.html"));

    window.webContents.on("did-finish-load", () => {
        notifyState();
    });
    window.webContents.on("console-message", (_event, level, message, line, sourceId) => {
        console.log(`[Renderer Log L${level}] ${message} (${sourceId}:${line})`);
    });
    window.on("blur", () => {
        if (process.argv.includes("--hide-on-blur") && window && window.isVisible()) {
            window.hide();
        }
    });

    window.on("closed", () => {
        window = null;
    });
}

function positionWindow() {
    if (!window || !tray) return;
    const trayBounds = tray.getBounds();
    const windowBounds = window.getBounds();
    const display = screen.getDisplayNearestPoint({ x: trayBounds.x, y: trayBounds.y }) || screen.getPrimaryDisplay();
    const workArea = display.workArea;

    let x = Math.round(trayBounds.x + (trayBounds.width / 2) - (windowBounds.width / 2));
    let y = Math.round(trayBounds.y + trayBounds.height + 4);

    // Keep window inside work area bounds
    if (x + windowBounds.width > workArea.x + workArea.width) {
        x = workArea.x + workArea.width - windowBounds.width - 10;
    }
    if (x < workArea.x) {
        x = workArea.x + 10;
    }

    if (y + windowBounds.height > workArea.y + workArea.height) {
        // Tray might be at bottom
        y = Math.round(trayBounds.y - windowBounds.height - 4);
    }

    window.setPosition(x, y, false);
}

function toggleWindow() {
    if (!window) return;
    if (window.isVisible()) {
        window.hide();
    } else {
        positionWindow();
        window.show();
        window.focus();
        notifyState();
    }
}

async function connectToTV(isPairing = false) {
    const config = loadConfig();
    state.host = config.host;
    state.name = config.name;
    state.mac = config.mac;
    console.log("[LGwebOS] Initiating connect to TV:", config.host, "key:", config.clientKey ? "PRESENT" : "MISSING");

    if (client) {
        client.close();
        client = null;
    }

    state.connecting = true;
    state.error = null;
    state.notice = isPairing ? "Iniciando pareamento..." : "Conectando à TV...";
    notifyState();

    client = new WebOSClient({
        host: config.host,
        mac: config.mac,
        clientKey: config.clientKey
    });

    client.on("pairing_prompt", () => {
        state.pairing = true;
        state.promptActive = true;
        state.notice = "Aceite a conexão na tela da sua TV agora!";
        notifyState();
        if (window && !window.isDestroyed()) {
            window.webContents.send("tv:prompt", true);
        }
    });

    client.on("paired", (key) => {
        state.pairing = false;
        state.promptActive = false;
        updateConfig({ clientKey: key });
        state.notice = "Pareamento realizado com sucesso!";
        notifyState();
    });

    client.on("close", () => {
        state.connected = false;
        state.connecting = false;
        state.pairing = false;
        notifyState();
        scheduleReconnect();
    });

    client.on("error", (err) => {
        state.error = err.message || "Erro de conexão";
        notifyState();
    });

    try {
        await client.connect(isPairing ? 90000 : 15000);
        state.connected = true;
        state.connecting = false;
        state.pairing = false;
        state.error = null;
        state.notice = null;
        console.log("[LGwebOS] Connected to TV successfully!");
        // Fetch TV metadata
        try {
            const sys = await client.getSystemInfo();
            if (sys && sys.modelName) {
                state.model = sys.modelName;
                updateConfig({ model: sys.modelName });
            }
        } catch (_) {}

        await refreshTVState();

        // Subscriptions for instant updates
        try {
            client.subscribe("audio/getVolume", (vol) => {
                const p = vol.volumeStatus || vol;
                if (typeof p.volume === "number") {
                    state.volume = p.volume;
                    state.hasVolume = true;
                }
                if (typeof (p.muteStatus ?? p.muted) === "boolean") {
                    state.muted = Boolean(p.muteStatus ?? p.muted);
                }
                notifyState();
            });

            client.subscribe("com.webos.applicationManager/getForegroundAppInfo", (fg) => {
                updateForeground(fg);
            });
        } catch (_) {}

        startPolling();
        notifyState();
    } catch (e) {
        console.error("[LGwebOS] Connection error:", e.message);
        state.connected = false;
        state.connecting = false;
        state.pairing = false;
        state.error = e.message;
        notifyState();
        scheduleReconnect();
    }
}

function scheduleReconnect() {
    clearTimeout(reconnectTimer);
    const config = loadConfig();
    if (config.autoReconnect && !state.connecting && !state.connected) {
        reconnectTimer = setTimeout(() => {
            connectToTV(false);
        }, 10000);
    }
}

function startPolling() {
    clearInterval(pollTimer);
    pollTimer = setInterval(async () => {
        if (state.connected && client) {
            try {
                await refreshTVState();
            } catch (_) {}
        }
    }, 20000);
}

async function refreshTVState() {
    if (!client || !state.connected) return;
    try {
        const [vol, fg, launchRes, inputsRes, pic] = await Promise.all([
            client.getVolume().catch(() => null),
            client.getForegroundApp().catch(() => null),
            client.listLaunchPoints().catch(() => null),
            client.getExternalInputList().catch(() => null),
            client.getPictureSettings().catch(() => null)
        ]);

        if (vol) {
            const p = vol.volumeStatus || vol;
            if (typeof p.volume === "number") {
                state.volume = p.volume;
                state.hasVolume = true;
            }
            if (typeof (p.muteStatus ?? p.muted) === "boolean") {
                state.muted = Boolean(p.muteStatus ?? p.muted);
            }
        }

        if (fg) {
            updateForeground(fg);
        }

        if (launchRes && launchRes.launchPoints) {
            const seen = new Set();
            state.apps = launchRes.launchPoints.filter(a => {
                if (seen.has(a.id)) return false;
                seen.add(a.id);
                return true;
            }).map(a => {
                const cat = getCatalogApp(a.id);
                return {
                    id: a.id,
                    title: cat?.title || a.title,
                    icon: cat?.icon || null
                };
            });
        }

        if (inputsRes && inputsRes.devices) {
            state.inputs = inputsRes.devices.map(d => {
                let label = d.label || d.id;
                if (d.subList && d.subList.length > 0 && d.subList[0].osdName) {
                    label = d.subList[0].osdName;
                }
                return {
                    id: d.id,
                    label,
                    appId: d.appId || "",
                    connected: Boolean(d.connected)
                };
            });
        }

        if (pic && pic.settings) {
            state.picture = pic.settings;
        }

        notifyState();
    } catch (_) {}
}

function updateForeground(fg) {
    state.foregroundId = fg.appId || "";
    if (state.foregroundId.startsWith("com.webos.app.hdmi")) {
        const inputNum = state.foregroundId.replace("com.webos.app.hdmi", "");
        const matched = state.inputs.find(i => i.id.replace("_", "") === "HDMI" + inputNum);
        state.foregroundTitle = matched ? `${matched.label} · HDMI ${inputNum}` : `HDMI ${inputNum}`;
    } else {
        const found = state.apps.find(a => a.id === state.foregroundId);
        state.foregroundTitle = fg.title || found?.title || "TV is on";
    }
    if (state.connected && state.foregroundId) {
        recordUsage(state.foregroundId, state.foregroundTitle, 20);
    }
    notifyState();
}

async function handlePower() {
    if (state.connected && client) {
        try {
            await client.turnOff();
            state.connected = false;
            client.close();
            state.notice = "TV desligada.";
            notifyState();
        } catch (e) {
            state.error = e.message;
            notifyState();
        }
    } else {
        const config = loadConfig();
        try {
            await WebOSClient.wake(config.mac, config.host);
            state.notice = "Sinal Wake-on-LAN enviado para ligar a TV!";
            notifyState();
            setTimeout(() => connectToTV(false), 3000);
        } catch (e) {
            state.error = e.message;
            notifyState();
        }
    }
}

async function handleVolumeStep(up) {
    if (!client || !state.connected) return;
    try {
        if (up) await client.volumeUp();
        else await client.volumeDown();
        await refreshTVState();
    } catch (e) {
        state.error = e.message;
        notifyState();
    }
}

async function handleToggleMute() {
    if (!client || !state.connected) return;
    try {
        await client.setMute(!state.muted);
        state.muted = !state.muted;
        notifyState();
    } catch (e) {
        state.error = e.message;
        notifyState();
    }
}

// IPC Handlers
ipcMain.handle("win:minimize", () => {
    if (window) window.hide();
    return true;
});
ipcMain.handle("win:hide", () => {
    if (window) window.hide();
    return true;
});
ipcMain.handle("tv:get-state", () => state);
ipcMain.handle("tv:get-config", () => loadConfig());
ipcMain.handle("tv:save-config", (_e, cfg) => {
    updateConfig(cfg);
    state.host = cfg.host || state.host;
    state.name = cfg.name || state.name;
    state.mac = cfg.mac || state.mac;
    notifyState();
    return true;
});

ipcMain.handle("tv:connect", () => connectToTV(false));
ipcMain.handle("tv:disconnect", () => {
    if (client) {
        client.close();
        client = null;
    }
    state.connected = false;
    notifyState();
    return true;
});

ipcMain.handle("tv:pair", () => connectToTV(true));
ipcMain.handle("tv:power", handlePower);

ipcMain.handle("tv:set-volume", async (_e, val) => {
    if (!client || !state.connected) return;
    try {
        await client.setVolume(val);
        state.volume = val;
        notifyState();
    } catch (e) {
        state.error = e.message;
        notifyState();
    }
});

ipcMain.handle("tv:volume-step", (_e, up) => handleVolumeStep(up));
ipcMain.handle("tv:toggle-mute", handleToggleMute);

ipcMain.handle("tv:press-button", async (_e, name) => {
    if (!client || !state.connected) return;
    try {
        await client.button(name);
    } catch (e) {
        state.error = e.message;
        notifyState();
    }
});

ipcMain.handle("tv:move-pointer", async (_e, dx, dy) => {
    if (!client || !state.connected) return;
    try {
        await client.move(dx, dy);
    } catch (_) {}
});

ipcMain.handle("tv:click-pointer", async () => {
    if (!client || !state.connected) return;
    try {
        await client.click();
    } catch (_) {}
});

ipcMain.handle("tv:launch-app", async (_e, appId) => {
    if (!client || !state.connected) return;
    try {
        await client.launch(appId);
        setTimeout(refreshTVState, 1000);
    } catch (e) {
        state.error = e.message;
        notifyState();
    }
});

ipcMain.handle("tv:switch-input", async (_e, inputId) => {
    if (!client || !state.connected) return;
    try {
        await client.switchInput(inputId);
        setTimeout(refreshTVState, 1000);
    } catch (e) {
        state.error = e.message;
        notifyState();
    }
});

ipcMain.handle("tv:media-control", async (_e, cmd) => {
    if (!client || !state.connected) return;
    try {
        if (cmd === "play") await client.mediaPlay();
        else if (cmd === "pause") await client.mediaPause();
        else if (cmd === "stop") await client.mediaStop();
        else if (cmd === "rewind") await client.mediaRewind();
        else if (cmd === "fastForward") await client.mediaFastForward();
    } catch (e) {
        state.error = e.message;
        notifyState();
    }
});

ipcMain.handle("tv:get-picture", async () => {
    if (!client || !state.connected) return state.picture;
    try {
        const res = await client.getPictureSettings();
        if (res && res.settings) {
            state.picture = res.settings;
            return res.settings;
        }
    } catch (_) {}
    return state.picture;
});

ipcMain.handle("tv:set-picture", async (_e, settings) => {
    if (!client || !state.connected) return;
    try {
        await client.setPictureSettings(settings);
        state.picture = { ...state.picture, ...settings };
        state.notice = "Ajustes de imagem aplicados na TV.";
        notifyState();
    } catch (e) {
        state.error = e.message;
        notifyState();
    }
});

ipcMain.handle("tv:get-usage", () => loadUsage());

ipcMain.handle("tv:discover", async () => {
    return await WebOSClient.discover();
});

app.whenReady().then(() => {
    createWindow();

    // Setup Tray
    const iconPath = path.join(__dirname, "assets", "lg.png");
    let trayIcon = nativeImage.createFromPath(iconPath);
    if (!trayIcon.isEmpty()) {
        trayIcon = trayIcon.resize({ width: 22, height: 22 });
    }
    tray = new Tray(trayIcon);
    updateTrayMenu();

    tray.on("click", () => {
        toggleWindow();
    });

    // Auto connect on startup
    connectToTV(false);
});

app.on("window-all-closed", (e) => {
    // Keep running in tray
    e.preventDefault();
});
