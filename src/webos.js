// WebOS client implementation for LG webOS TVs
const EventEmitter = require("events");
const dgram = require("dgram");
const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const WebSocket = require("ws");
class WebOSClient extends EventEmitter {
    constructor(options = {}) {
        super();
        this.host = options.host || "";
        this.mac = options.mac || "";
        this.name = options.name || "LG TV";
        this.clientKey = options.clientKey || null;
        this.port = options.port || 3001;
        this.ws = null;
        this.pointerWs = null;
        this.pointerSocketPath = null;
        this.connected = false;
        this.callbacks = new Map();
        this.subscriptions = new Map();
        this.reqId = 1;
        this.registrationPayload = options.registrationPayload || null;
    }

    _loadRegistrationPayload() {
        if (this.registrationPayload) return this.registrationPayload;
        const regPath = path.join(__dirname, "registration.json");
        if (fs.existsSync(regPath)) {
            return JSON.parse(fs.readFileSync(regPath, "utf8"));
        }
        return {
            forcePairing: false,
            pairingType: "PROMPT",
            manifest: {
                manifestVersion: 1,
                appVersion: "1.1",
                permissions: [
                    "LAUNCH", "CONTROL_AUDIO", "CONTROL_INPUT_MEDIA_PLAYBACK", "CONTROL_INPUT_TV",
                    "CONTROL_POWER", "READ_APP_STATUS", "READ_CURRENT_CHANNEL", "READ_INPUT_DEVICE_LIST",
                    "READ_RUNNING_APPS", "READ_POWER_STATE", "READ_SETTINGS"
                ]
            }
        };
    }

    connect(timeoutMs = 90000) {
        return new Promise((resolve, reject) => {
            if (this.connected && this.ws) {
                return resolve(true);
            }

            const url = `wss://${this.host}:${this.port}/`;
            const payload = JSON.parse(JSON.stringify(this._loadRegistrationPayload()));
            if (this.clientKey) {
                payload["client-key"] = this.clientKey;
            }

            let timeoutHandle = null;
            if (timeoutMs > 0) {
                timeoutHandle = setTimeout(() => {
                    this.close();
                    reject(new Error("A TV está desligada ou não respondeu na rede (timeout " + (timeoutMs / 1000) + "s)."));
                }, timeoutMs);
            }

            try {
                this.ws = new WebSocket(url, {
                    rejectUnauthorized: false
                });
            } catch (err) {
                clearTimeout(timeoutHandle);
                return reject(err);
            }
            this.ws.on("open", () => {
                this.emit("open");
                const registerReq = {
                    type: "register",
                    id: "register_0",
                    payload
                };
                this.ws.send(JSON.stringify(registerReq));
            });

            this.ws.on("message", (data) => {
                try {
                    const msg = JSON.parse(data.toString());
                    this._handleMessage(msg, resolve, reject, timeoutHandle);
                } catch (e) {
                    this.emit("error", e);
                }
            });

            this.ws.on("error", (err) => {
                if (this.listenerCount("error") > 0) {
                    this.emit("error", err);
                }
            });

            this.ws.on("close", (code, reason) => {
                this.connected = false;
                this.emit("close", { code, reason });
            });
        });
    }

    _handleMessage(msg, resolveConnect, rejectConnect, timeoutHandle) {
        this.emit("message", msg);

        if (msg.id === "register_0") {
            if (msg.type === "response" && msg.payload && msg.payload.pairingType === "PROMPT") {
                this.emit("pairing_prompt", msg.payload);
            } else if (msg.type === "registered") {
                this.connected = true;
                clearTimeout(timeoutHandle);
                if (msg.payload && msg.payload["client-key"]) {
                    this.clientKey = msg.payload["client-key"];
                    this.emit("paired", this.clientKey);
                }
                if (resolveConnect) resolveConnect(true);
            } else if (msg.type === "error") {
                clearTimeout(timeoutHandle);
                if (rejectConnect) rejectConnect(new Error(msg.error || "TV registration rejected"));
            }
            return;
        }

        // Subscriptions
        if (msg.id && this.subscriptions.has(msg.id)) {
            const subFn = this.subscriptions.get(msg.id);
            if (msg.payload) {
                subFn(msg.payload);
            }
        }

        // Request callbacks
        if (msg.id && this.callbacks.has(msg.id)) {
            const { resolve, reject } = this.callbacks.get(msg.id);
            this.callbacks.delete(msg.id);
            if (msg.type === "error") {
                reject(new Error(msg.error || "TV command failed"));
            } else if (msg.payload && msg.payload.returnValue === false) {
                reject(new Error(msg.payload.errorText || "Command returned false"));
            } else {
                resolve(msg.payload || {});
            }
        }
    }

    request(uri, payload = {}, timeoutMs = 15000) {
        return new Promise((resolve, reject) => {
            if (!this.connected || !this.ws) {
                return reject(new Error("Not connected to TV"));
            }

            const id = "req_" + (this.reqId++);
            const timer = setTimeout(() => {
                if (this.callbacks.has(id)) {
                    this.callbacks.delete(id);
                    reject(new Error(`Request ${uri} timed out after ${timeoutMs}ms`));
                }
            }, timeoutMs);

            this.callbacks.set(id, {
                resolve: (data) => {
                    clearTimeout(timer);
                    resolve(data);
                },
                reject: (err) => {
                    clearTimeout(timer);
                    reject(err);
                }
            });

            const req = {
                type: "request",
                id,
                uri: uri.startsWith("ssap://") ? uri : "ssap://" + uri,
                payload
            };

            this.ws.send(JSON.stringify(req));
        });
    }

    subscribe(uri, callback) {
        if (!this.connected || !this.ws) {
            throw new Error("Not connected to TV");
        }
        const id = "sub_" + (this.reqId++);
        this.subscriptions.set(id, callback);
        const req = {
            type: "subscribe",
            id,
            uri: uri.startsWith("ssap://") ? uri : "ssap://" + uri
        };
        this.ws.send(JSON.stringify(req));
        return id;
    }

    unsubscribe(id) {
        if (this.subscriptions.has(id)) {
            this.subscriptions.delete(id);
            if (this.ws && this.connected) {
                this.ws.send(JSON.stringify({ type: "unsubscribe", id }));
            }
        }
    }

    // Pointer input socket
    async _ensurePointerSocket() {
        if (this.pointerWs && this.pointerWs.readyState === WebSocket.OPEN) {
            return this.pointerWs;
        }

        const res = await this.request("com.webos.service.networkinput/getPointerInputSocket");
        if (!res || !res.socketPath) {
            throw new Error("Could not get pointer input socket from TV");
        }
        this.pointerSocketPath = res.socketPath;

        return new Promise((resolve, reject) => {
            try {
                this.pointerWs = new WebSocket(this.pointerSocketPath, {
                    rejectUnauthorized: false
                });
                this.pointerWs.on("open", () => resolve(this.pointerWs));
                this.pointerWs.on("error", (e) => reject(e));
                this.pointerWs.on("close", () => { this.pointerWs = null; });
            } catch (err) {
                reject(err);
            }
        });
    }

    async button(name) {
        try {
            const pWs = await this._ensurePointerSocket();
            pWs.send(`type:button\nname:${name}\n\n`);
        } catch (e) {
            // Fallback: system.launcher / media control / tv channel
            if (name === "HOME") {
                return this.request("system.launcher/open", { id: "com.webos.app.home" });
            }
            throw e;
        }
    }

    async move(dx, dy) {
        const pWs = await this._ensurePointerSocket();
        pWs.send(`type:move\ndx:${dx}\ndy:${dy}\ndown:0\n\n`);
    }

    async click() {
        const pWs = await this._ensurePointerSocket();
        pWs.send("type:click\n\n");
    }

    // High level TV APIs
    async getPowerState() {
        return this.request("com.webos.service.tvpower/power/getPowerState");
    }

    async turnOff() {
        try {
            return await this.request("system/turnOff");
        } catch (_) {
            try {
                return await this.request("com.webos.service.tvpower/power/turnOff");
            } catch (_) {
                return await this.button("POWER");
            }
        }
    }

    static wake(mac, targetHost = "255.255.255.255") {
        return new Promise((resolve, reject) => {
            const cleanMac = mac.replace(/[:-]/g, "");
            if (cleanMac.length !== 12) {
                return reject(new Error("Invalid MAC address: " + mac));
            }
            const macBytes = Buffer.from(cleanMac, "hex");
            const magicPacket = Buffer.concat([
                Buffer.alloc(6, 0xff),
                ...Array(16).fill(macBytes)
            ]);

            const client = dgram.createSocket("udp4");
            client.bind(() => {
                client.setBroadcast(true);
                client.send(magicPacket, 9, targetHost, (err) => {
                    client.send(magicPacket, 9, "255.255.255.255", () => {
                        client.close();
                        if (err) reject(err);
                        else resolve(true);
                    });
                });
            });
        });
    }

    async getVolume() {
        return this.request("audio/getVolume");
    }

    async setVolume(volume) {
        return this.request("audio/setVolume", { volume: Math.max(0, Math.min(100, Math.round(volume))) });
    }

    async volumeUp() {
        return this.request("audio/volumeUp");
    }

    async volumeDown() {
        return this.request("audio/volumeDown");
    }

    async setMute(mute) {
        return this.request("audio/setMute", { mute: Boolean(mute) });
    }

    async getForegroundApp() {
        return this.request("com.webos.applicationManager/getForegroundAppInfo");
    }

    async listLaunchPoints() {
        return this.request("com.webos.applicationManager/listLaunchPoints");
    }

    async launch(appId, params = {}) {
        return this.request("system.launcher/launch", { id: appId, params });
    }

    async closeApp(appId) {
        return this.request("system.launcher/close", { id: appId });
    }

    async getExternalInputList() {
        return this.request("tv/getExternalInputList");
    }

    async switchInput(inputId) {
        return this.request("tv/switchInput", { inputId });
    }

    async mediaPlay() {
        return this.request("media.controls/play");
    }

    async mediaPause() {
        return this.request("media.controls/pause");
    }

    async mediaStop() {
        return this.request("media.controls/stop");
    }

    async mediaRewind() {
        return this.request("media.controls/rewind");
    }

    async mediaFastForward() {
        return this.request("media.controls/fastForward");
    }

    async insertText(text) {
        return this.request("com.webos.service.ime/insertText", { text, replace: 0 });
    }

    async sendEnter() {
        return this.request("com.webos.service.ime/sendEnterKey");
    }

    async getPictureSettings() {
        return this.request("settings/getSystemSettings", {
            category: "picture",
            keys: ["contrast", "backlight", "brightness", "color"]
        });
    }

    async setPictureSettings(settings) {
        return this.request("settings/setSystemSettings", {
            category: "picture",
            settings
        });
    }

    async getSystemInfo() {
        return this.request("system/getSystemInfo");
    }

    async getSWInformation() {
        return this.request("com.webos.service.update/getCurrentSWInformation");
    }

    close() {
        this.connected = false;
        if (this.pointerWs) {
            try {
                this.pointerWs.on("error", () => {});
                if (typeof this.pointerWs.terminate === "function") this.pointerWs.terminate();
                else this.pointerWs.close();
            } catch (_) {}
            this.pointerWs = null;
        }
        if (this.ws) {
            try {
                this.ws.on("error", () => {});
                if (typeof this.ws.terminate === "function") this.ws.terminate();
                else this.ws.close();
            } catch (_) {}
            this.ws = null;
        }
        this.callbacks.clear();
        this.subscriptions.clear();
    }

    // SSDP Discovery
    static discover(timeoutMs = 4000) {
        return new Promise((resolve) => {
            const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });
            const devices = new Map();

            const query = [
                "M-SEARCH * HTTP/1.1",
                "HOST: 239.255.255.250:1900",
                "MAN: \"ssdp:discover\"",
                "MX: 2",
                "ST: urn:lge-com:service:webos-second-screen:1",
                "", ""
            ].join("\r\n");

            socket.on("message", (msg, rinfo) => {
                const text = msg.toString();
                const locationMatch = text.match(/LOCATION:\s*(http:\/\/[^\r\n]+)/i);
                if (locationMatch && locationMatch[1]) {
                    const loc = locationMatch[1].trim();
                    if (!devices.has(rinfo.address)) {
                        devices.set(rinfo.address, { host: rinfo.address, location: loc });
                    }
                }
            });

            socket.bind(() => {
                socket.setBroadcast(true);
                socket.setMulticastTTL(2);
                socket.send(query, 1900, "239.255.255.250");
            });

            setTimeout(() => {
                try { socket.close(); } catch (_) {}
                resolve(Array.from(devices.values()));
            }, timeoutMs);
        });
    }
}

module.exports = WebOSClient;
