// Renderer logic for LGwebOS menubar
(() => {
    const api = window.api;

let currentState = {};
let allApps = [];
let toastTimer = null;

// Brand themes definition matching BrandTheme.swift
const BRAND_THEMES = {
    netflix: { color: "linear-gradient(135deg, rgba(229, 9, 20, 0.4) 0%, rgba(20, 24, 33, 0.95) 100%)", border: "#e50914", tagline: "Uma grande história está esperando por você." },
    youtube: { color: "linear-gradient(135deg, rgba(255, 0, 0, 0.35) 0%, rgba(20, 24, 33, 0.95) 100%)", border: "#ff0000", tagline: "Tudo o que você ama, na tela grande." },
    amazon: { color: "linear-gradient(135deg, rgba(0, 168, 225, 0.35) 0%, rgba(20, 24, 33, 0.95) 100%)", border: "#00a8e1", tagline: "Hora da pipoca." },
    prime: { color: "linear-gradient(135deg, rgba(0, 168, 225, 0.35) 0%, rgba(20, 24, 33, 0.95) 100%)", border: "#00a8e1", tagline: "Hora da pipoca." },
    disney: { color: "linear-gradient(135deg, rgba(17, 60, 207, 0.4) 0%, rgba(20, 24, 33, 0.95) 100%)", border: "#113ccf", tagline: "Um universo de histórias." },
    spotify: { color: "linear-gradient(135deg, rgba(30, 215, 96, 0.35) 0%, rgba(20, 24, 33, 0.95) 100%)", border: "#1ed760", tagline: "No clima certo. Aperte o play." },
    twitch: { color: "linear-gradient(135deg, rgba(145, 70, 255, 0.35) 0%, rgba(20, 24, 33, 0.95) 100%)", border: "#9146ff", tagline: "Sua comunidade, ao vivo." },
    playstation: { color: "linear-gradient(135deg, rgba(0, 67, 156, 0.4) 0%, rgba(20, 24, 33, 0.95) 100%)", border: "#00439c", tagline: "Sua próxima aventura começa aqui." },
    ps5: { color: "linear-gradient(135deg, rgba(0, 67, 156, 0.4) 0%, rgba(20, 24, 33, 0.95) 100%)", border: "#00439c", tagline: "Sua próxima aventura começa aqui." },
    default: { color: "linear-gradient(135deg, rgba(232, 43, 89, 0.25) 0%, rgba(20, 24, 33, 0.95) 100%)", border: "#e82b59", tagline: "Sua TV LG. Seu controle." }
};

function getThemeForApp(id, title) {
    const key = (id + " " + title).toLowerCase();
    for (const [k, v] of Object.entries(BRAND_THEMES)) {
        if (k !== "default" && key.includes(k)) return v;
    }
    return BRAND_THEMES.default;
}

function showToast(msg, duration = 3000) {
    const toast = document.getElementById("toast");
    if (!toast) return;
    toast.textContent = msg;
    toast.classList.remove("hidden");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
        toast.classList.add("hidden");
    }, duration);
}

// Tab navigation
document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
        document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
        document.querySelectorAll(".tab-pane").forEach(p => p.classList.remove("active"));
        btn.classList.add("active");
        const tabId = btn.getAttribute("data-tab");
        const pane = document.getElementById(tabId);
        if (pane) pane.classList.add("active");
        if (tabId === "tab-activity") loadActivity();
        if (tabId === "tab-picture") loadPictureSettings();
    });
});

// Update UI with TV state
function updateUI(state) {
    currentState = state;

    document.getElementById("tv-name").textContent = state.name || "ArthurTV";

    // Status dot & banner
    const dot = document.getElementById("status-dot");
    const statusText = document.getElementById("status-text");
    const btnPower = document.getElementById("btn-power");

    dot.className = "status-dot";
    const pwrBadge = document.getElementById("power-badge");
    const pwrPill = document.getElementById("hero-power-pill");
    const pwrPillText = document.getElementById("hero-power-text");
    const btnHeroWake = document.getElementById("btn-hero-wake");

    const pState = (state.powerState || "").toLowerCase();
    const isTvOn = state.isTvOn || (state.connected && pState === "active");
    const isStandby = pState === "suspend";

    if (state.connecting) {
        if (pwrBadge) {
            pwrBadge.className = "power-badge tv-standby";
            pwrBadge.textContent = "CONECTANDO...";
        }
        if (pwrPill) {
            pwrPill.className = "power-pill standby";
            pwrPillText.textContent = "CONECTANDO...";
        }
    } else if (isTvOn) {
        if (pwrBadge) {
            pwrBadge.className = "power-badge tv-on";
            pwrBadge.textContent = "TV LIGADA";
        }
        if (pwrPill) {
            pwrPill.className = "power-pill on";
            pwrPillText.textContent = "LIGADA (TELA ATIVA)";
        }
        if (btnHeroWake) btnHeroWake.classList.add("hidden");
    } else if (isStandby) {
        if (pwrBadge) {
            pwrBadge.className = "power-badge tv-standby";
            pwrBadge.textContent = "EM STANDBY";
        }
        if (pwrPill) {
            pwrPill.className = "power-pill standby";
            pwrPillText.textContent = "STANDBY (TELA APAGADA)";
        }
        if (btnHeroWake) btnHeroWake.classList.remove("hidden");
    } else {
        if (pwrBadge) {
            pwrBadge.className = "power-badge tv-off";
            pwrBadge.textContent = "TV DESLIGADA";
        }
        if (pwrPill) {
            pwrPill.className = "power-pill off";
            pwrPillText.textContent = "TV DESLIGADA";
        }
        if (btnHeroWake) btnHeroWake.classList.remove("hidden");
    }

    if (state.connected) {
        dot.classList.add("connected");
        statusText.textContent = `${state.model || "LG webOS"} · Conectado`;
        btnPower.classList.add("on");
    } else if (state.connecting) {
        dot.classList.add("connecting");
        statusText.textContent = state.pairing ? "Aguardando pareamento na TV..." : "Conectando...";
        btnPower.classList.remove("on");
    } else {
        dot.classList.add("error");
        statusText.textContent = "TV Desconectada";
        btnPower.classList.remove("on");
    }

    // Pairing prompt notification box
    const promptBox = document.getElementById("pairing-prompt-box");
    if (state.promptActive || state.pairing) {
        promptBox.classList.remove("hidden");
    } else {
        promptBox.classList.add("hidden");
    }

    // Hero card
    const heroCard = document.getElementById("hero-card");
    const heroTitle = document.getElementById("hero-title");
    const heroAppTitle = document.getElementById("hero-app-title");
    const heroTagline = document.getElementById("hero-tagline");

    const theme = getThemeForApp(state.foregroundId || "", state.foregroundTitle || "");
    heroCard.style.background = theme.color;
    heroCard.style.borderColor = theme.border;

    if (isTvOn) {
        heroAppTitle.textContent = state.foregroundTitle ? state.foregroundTitle.toUpperCase() : "TV LIGADA";
        heroTitle.textContent = state.foregroundTitle || "TV Ligada";
        heroTagline.textContent = theme.tagline || "Sua TV LG. Seu controle.";
    } else if (isStandby) {
        heroAppTitle.textContent = "STANDBY";
        heroTitle.textContent = "TV em Modo de Espera";
        heroTagline.textContent = "A tela está apagada. Clique abaixo para ligá-la.";
    } else if (state.connecting) {
        heroAppTitle.textContent = "CONECTANDO...";
        heroTitle.textContent = "Buscando TV na rede...";
        heroTagline.textContent = "Aguardando resposta da TV...";
    } else {
        heroAppTitle.textContent = "DESLIGADA";
        heroTitle.textContent = "TV Desligada";
        heroTagline.textContent = "A TV está desligada. Envie um sinal Wake-on-LAN para ligar.";
    }

    // Volume
    const volSlider = document.getElementById("volume-slider");
    const volBadge = document.getElementById("volume-val-badge");
    const btnMute = document.getElementById("btn-mute");

    volSlider.value = state.volume || 0;
    volBadge.textContent = `${state.volume || 0}%${state.muted ? " [MUDO]" : ""}`;
    btnMute.style.color = state.muted ? "#e82b59" : "inherit";

    // Apps
    if (state.apps && state.apps.length > 0) {
        allApps = state.apps;
        renderApps(allApps);
    }

    // Inputs
    if (state.inputs) {
        renderInputs(state.inputs, state.foregroundId);
    }

    // Toast notices
    if (state.error) {
        showToast("⚠️ " + state.error, 4000);
    } else if (state.notice) {
        showToast(state.notice, 3500);
    }
}

function renderInputs(inputs, currentAppId) {
    const container = document.getElementById("inputs-list");
    container.innerHTML = "";
    inputs.forEach(inp => {
        const chip = document.createElement("div");
        chip.className = "input-chip";
        const isActive = inp.appId && inp.appId === currentAppId;
        if (isActive) chip.classList.add("active");
        chip.textContent = inp.label;
        chip.addEventListener("click", () => {
            api.switchInput(inp.id);
        });
        container.appendChild(chip);
    });
}

function renderApps(apps) {
    const grid = document.getElementById("apps-grid");
    grid.innerHTML = "";
    apps.forEach(app => {
        const tile = document.createElement("div");
        tile.className = "app-tile";
        tile.title = app.title;

        const icon = document.createElement("img");
        icon.className = "app-icon";
        if (app.icon) {
            icon.src = `../assets/${app.icon}`;
        } else {
            icon.src = "../assets/lg.png";
        }
        icon.onerror = () => { icon.src = "../assets/lg.png"; };

        const title = document.createElement("span");
        title.className = "app-title";
        title.textContent = app.title;

        tile.appendChild(icon);
        tile.appendChild(title);

        tile.addEventListener("click", () => {
            api.launchApp(app.id);
            showToast(`Iniciando ${app.title}...`);
        });

        grid.appendChild(tile);
    });
}

// App Search filter
document.getElementById("apps-search").addEventListener("input", (e) => {
    const term = e.target.value.toLowerCase();
    const filtered = allApps.filter(a => a.title.toLowerCase().includes(term));
    renderApps(filtered);
});

// Volume control
const volumeSlider = document.getElementById("volume-slider");
let volDebounce = null;
volumeSlider.addEventListener("input", (e) => {
    const val = parseInt(e.target.value, 10);
    document.getElementById("volume-val-badge").textContent = `${val}%`;
    clearTimeout(volDebounce);
    volDebounce = setTimeout(() => {
        api.setVolume(val);
    }, 150);
});

document.getElementById("btn-mute").addEventListener("click", () => api.toggleMute());
document.getElementById("btn-vol-down").addEventListener("click", () => api.volumeStep(false));
document.getElementById("btn-vol-up").addEventListener("click", () => api.volumeStep(true));

// Power button
document.getElementById("btn-power").addEventListener("click", () => {
    if (currentState && (currentState.connected || currentState.isTvOn || currentState.powerState === "Active" || currentState.powerState === "Suspend")) {
        api.turnOff();
        showToast("Enviando comando para desligar a TV...");
    } else {
        api.turnOn();
        showToast("Enviando sinal para ligar a TV...");
    }
});

const btnHeroWake = document.getElementById("btn-hero-wake");
if (btnHeroWake) {
    btnHeroWake.addEventListener("click", () => {
        api.turnOn();
        showToast("Enviando sinal para ligar a TV...");
    });
}
// Window controls
document.getElementById("btn-win-min").addEventListener("click", () => api.minimizeWindow());
document.getElementById("btn-win-close").addEventListener("click", () => api.hideWindow());

// Quick action buttons
document.getElementById("quick-playpause").addEventListener("click", () => api.mediaControl("play"));
document.getElementById("quick-home").addEventListener("click", () => api.pressButton("HOME"));
document.getElementById("quick-back").addEventListener("click", () => api.pressButton("BACK"));

// Remote buttons
document.getElementById("dpad-up").addEventListener("click", () => api.pressButton("UP"));
document.getElementById("dpad-down").addEventListener("click", () => api.pressButton("DOWN"));
document.getElementById("dpad-left").addEventListener("click", () => api.pressButton("LEFT"));
document.getElementById("dpad-right").addEventListener("click", () => api.pressButton("RIGHT"));
document.getElementById("dpad-ok").addEventListener("click", () => api.pressButton("ENTER"));

document.getElementById("nav-back").addEventListener("click", () => api.pressButton("BACK"));
document.getElementById("nav-home").addEventListener("click", () => api.pressButton("HOME"));
document.getElementById("nav-exit").addEventListener("click", () => api.pressButton("EXIT"));

document.getElementById("btn-play").addEventListener("click", () => api.mediaControl("play"));
document.getElementById("btn-pause").addEventListener("click", () => api.mediaControl("pause"));
document.getElementById("btn-rewind").addEventListener("click", () => api.mediaControl("rewind"));
document.getElementById("btn-forward").addEventListener("click", () => api.mediaControl("fastForward"));

// Touchpad pointer
const touchpad = document.getElementById("touchpad-area");
let lastPointerPos = null;
touchpad.addEventListener("mousedown", (e) => {
    lastPointerPos = { x: e.clientX, y: e.clientY };
});

window.addEventListener("mouseup", () => {
    lastPointerPos = null;
});

touchpad.addEventListener("click", () => {
    api.clickPointer();
});

touchpad.addEventListener("mousemove", (e) => {
    if (!lastPointerPos) return;
    const dx = Math.round((e.clientX - lastPointerPos.x) * 2.2);
    const dy = Math.round((e.clientY - lastPointerPos.y) * 2.2);
    lastPointerPos = { x: e.clientX, y: e.clientY };
    if (dx !== 0 || dy !== 0) {
        api.movePointer(dx, dy);
    }
});

// Picture settings
async function loadPictureSettings() {
    const pic = await api.getPicture();
    if (pic) {
        if (pic.backlight != null) {
            document.getElementById("pic-backlight").value = pic.backlight;
            document.getElementById("pic-backlight-val").textContent = pic.backlight;
        }
        if (pic.brightness != null) {
            document.getElementById("pic-brightness").value = pic.brightness;
            document.getElementById("pic-brightness-val").textContent = pic.brightness;
        }
        if (pic.contrast != null) {
            document.getElementById("pic-contrast").value = pic.contrast;
            document.getElementById("pic-contrast-val").textContent = pic.contrast;
        }
        if (pic.color != null) {
            document.getElementById("pic-color").value = pic.color;
            document.getElementById("pic-color-val").textContent = pic.color;
        }
    }
}

["backlight", "brightness", "contrast", "color"].forEach(key => {
    const el = document.getElementById("pic-" + key);
    const badge = document.getElementById("pic-" + key + "-val");
    if (el && badge) {
        el.addEventListener("input", (e) => { badge.textContent = e.target.value; });
    }
});

document.getElementById("btn-apply-picture").addEventListener("click", async () => {
    const settings = {
        backlight: parseInt(document.getElementById("pic-backlight").value, 10),
        brightness: parseInt(document.getElementById("pic-brightness").value, 10),
        contrast: parseInt(document.getElementById("pic-contrast").value, 10),
        color: parseInt(document.getElementById("pic-color").value, 10)
    };
    await api.setPicture(settings);
    showToast("Ajustes de imagem enviados para a TV.");
});

// Activity
async function loadActivity() {
    const usage = await api.getUsage(1);
    const container = document.getElementById("usage-list");
    container.innerHTML = "";
    const today = new Date().toISOString().slice(0, 10);
    const todayUsage = usage[today] || {};
    const entries = Object.entries(todayUsage);
    if (entries.length === 0) {
        container.innerHTML = "<p style='color: rgba(255,255,255,0.4); font-size:11px;'>Nenhuma atividade registrada hoje.</p>";
        return;
    }
    entries.sort((a, b) => b[1].seconds - a[1].seconds);
    entries.forEach(([appId, item]) => {
        const row = document.createElement("div");
        row.style.display = "flex";
        row.style.justifyContent = "space-between";
        row.style.padding = "6px 0";
        row.style.borderBottom = "1px solid rgba(255,255,255,0.05)";

        const name = document.createElement("span");
        name.textContent = item.title || appId;
        name.style.fontSize = "12px";

        const mins = Math.max(1, Math.round(item.seconds / 60));
        const time = document.createElement("span");
        time.textContent = `${mins} min`;
        time.style.color = "rgba(255,255,255,0.5)";
        time.style.fontSize = "11px";

        row.appendChild(name);
        row.appendChild(time);
        container.appendChild(row);
    });
}

// Settings modal
const settingsPanel = document.getElementById("settings-panel");
document.getElementById("btn-settings").addEventListener("click", async () => {
    const cfg = await api.getConfig();
    document.getElementById("cfg-host").value = cfg.host || "";
    document.getElementById("cfg-name").value = cfg.name || "";
    document.getElementById("cfg-mac").value = cfg.mac || "";
    settingsPanel.classList.remove("hidden");
});

document.getElementById("btn-close-settings").addEventListener("click", () => {
    settingsPanel.classList.add("hidden");
});

document.getElementById("btn-save-cfg").addEventListener("click", async () => {
    const updated = {
        host: document.getElementById("cfg-host").value.trim(),
        name: document.getElementById("cfg-name").value.trim(),
        mac: document.getElementById("cfg-mac").value.trim()
    };
    await api.saveConfig(updated);
    settingsPanel.classList.add("hidden");
    api.connect();
    showToast("Configuração salva. Conectando...");
});

document.getElementById("btn-pair-tv").addEventListener("click", () => {
    settingsPanel.classList.add("hidden");
    api.pair();
    showToast("Iniciando pareamento. Olhe para a tela da TV!");
});

document.getElementById("btn-discover-tv").addEventListener("click", async () => {
    showToast("Buscando TVs na rede local (SSDP)...", 5000);
    const devs = await api.discover();
    if (devs && devs.length > 0) {
        document.getElementById("cfg-host").value = devs[0].host;
        showToast(`TV encontrada no IP ${devs[0].host}!`);
    } else {
        showToast("Nenhuma TV respondeu à busca SSDP.");
    }
});

// Listen to backend events
api.onUpdate((state) => {
    updateUI(state);
});

api.onPrompt(() => {
    document.getElementById("pairing-prompt-box").classList.remove("hidden");
});

    // Initial state fetch
    api.getState().then(updateUI);
})();
