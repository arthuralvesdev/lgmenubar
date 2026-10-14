const fs = require("fs");
const path = require("path");
const os = require("os");

const CONFIG_DIR = path.join(os.homedir(), ".config", "LGwebOS-menubar");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");
const USAGE_FILE = path.join(CONFIG_DIR, "usage.json");
const EVENTS_FILE = path.join(CONFIG_DIR, "events.json");

const DEFAULT_CONFIG = {
    host: "",
    name: "LG TV",
    model: "LG webOS TV",
    mac: "",
    clientKey: null,
    favorites: ["netflix", "youtube.leanback.v4", "amazon", "com.disney.disneyplus-prod"],
    autoReconnect: true
};

function ensureDir() {
    if (!fs.existsSync(CONFIG_DIR)) {
        fs.mkdirSync(CONFIG_DIR, { recursive: true });
    }
}

function loadConfig() {
    ensureDir();
    if (!fs.existsSync(CONFIG_FILE)) {
        saveConfig(DEFAULT_CONFIG);
        return { ...DEFAULT_CONFIG };
    }
    try {
        const raw = fs.readFileSync(CONFIG_FILE, "utf8");
        return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
    } catch (e) {
        return { ...DEFAULT_CONFIG };
    }
}

function saveConfig(cfg) {
    ensureDir();
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), "utf8");
}

function updateConfig(partial) {
    const current = loadConfig();
    const updated = { ...current, ...partial };
    saveConfig(updated);
    return updated;
}

function loadUsage() {
    ensureDir();
    if (!fs.existsSync(USAGE_FILE)) return {};
    try {
        return JSON.parse(fs.readFileSync(USAGE_FILE, "utf8"));
    } catch (_) {
        return {};
    }
}

function saveUsage(usage) {
    ensureDir();
    fs.writeFileSync(USAGE_FILE, JSON.stringify(usage, null, 2), "utf8");
}

function recordUsage(appId, title, durationSeconds = 10) {
    const usage = loadUsage();
    const dateKey = new Date().toISOString().slice(0, 10);
    if (!usage[dateKey]) usage[dateKey] = {};
    if (!usage[dateKey][appId]) {
        usage[dateKey][appId] = { title, seconds: 0 };
    }
    usage[dateKey][appId].seconds += durationSeconds;
    usage[dateKey][appId].title = title || usage[dateKey][appId].title;
    saveUsage(usage);
}

module.exports = {
    CONFIG_DIR,
    CONFIG_FILE,
    loadConfig,
    saveConfig,
    updateConfig,
    loadUsage,
    saveUsage,
    recordUsage
};
