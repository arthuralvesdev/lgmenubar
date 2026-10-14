#!/usr/bin/env -S node --no-warnings
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const WebOSClient = require("./webos");
const { loadConfig, updateConfig } = require("./config");

async function main() {
    const args = process.argv.slice(2);
    const cmd = args[0] || "status";
    const config = loadConfig();

    if (cmd === "pair") {
        const host = args[1] || config.host;
        if (!host) {
            console.error("Por favor, informe o IP da TV: lgtv pair <IP>");
            process.exit(1);
        }
        console.log(`\n=======================================================`);
        console.log(`Iniciando pareamento com LG webOS TV em ${host}...`);
        console.log(`=======================================================\n`);

        const client = new WebOSClient({ host });
        
        client.on("pairing_prompt", () => {
            console.log("\n>>> ATENÇÃO: OLHE PARA A TELA DA SUA TV LG! <<<");
            console.log("Uma notificação apareceu na TV solicitando permissão.");
            console.log("Use o controle remoto e selecione 'Sim' / 'Aceitar'.\n");
            console.log("Aguardando confirmação...");
        });

        try {
            await client.connect(90000);
            if (client.clientKey) {
                console.log("\n*** PAREAMENTO CONCLUÍDO COM SUCESSO! ***");
                console.log(`Chave de pareamento recebida: ${client.clientKey}`);
                updateConfig({ host, clientKey: client.clientKey });
                console.log("Configuração salva com sucesso em ~/.config/LGwebOS-menubar/config.json");
            }
            client.close();
            process.exit(0);
        } catch (err) {
            console.error("\nErro no pareamento:", err.message);
            client.close();
            process.exit(1);
        }
        return;
    }

    if (cmd === "discover") {
        console.log("Procurando TVs LG na rede local...");
        const devices = await WebOSClient.discover();
        if (devices.length === 0) {
            console.log("Nenhuma TV encontrada via SSDP.");
        } else {
            console.log(`Encontradas ${devices.length} TV(s):`);
            devices.forEach((d, i) => console.log(` [${i+1}] ${d.host} (${d.location})`));
        }
        return;
    }

    if (cmd === "on" || cmd === "wake") {
        console.log(`Enviando Wake-on-LAN para ${config.mac} (${config.host})...`);
        try {
            await WebOSClient.wake(config.mac, config.host);
            console.log("Sinal Wake-on-LAN enviado!");
        } catch (e) {
            console.error("Erro WOL:", e.message);
        }
        return;
    }

    const client = new WebOSClient({
        host: config.host,
        mac: config.mac,
        clientKey: config.clientKey
    });
    client.on("error", () => {});
    try {
        await client.connect(10000);
    } catch (e) {
        console.error(`Não foi possível conectar à TV (${config.host}):`, e.message);
        console.log("Dica: se a TV estiver desligada, use 'lgtv on' ou ligue com o controle.");
        console.log("Se ainda não realizou o pareamento, use 'lgtv pair'.");
        process.exit(1);
    }

    try {
        switch (cmd) {
            case "status": {
                const [vol, fg, sw, pwr] = await Promise.all([
                    client.getVolume().catch(() => null),
                    client.getForegroundApp().catch(() => null),
                    client.getSWInformation().catch(() => null),
                    client.getPowerState().catch(() => null)
                ]);
                console.log(`=== LG TV: ${config.name} (${config.host}) ===`);
                console.log(`Status de energia: ${pwr?.state || "Ligada"}`);
                console.log(`webOS: ${sw?.product_name || "webOS"} (v${sw?.major_ver}.${sw?.minor_ver}.${sw?.micro_ver})`);
                console.log(`App em execução: ${fg?.appId || "Nenhum"} (${fg?.title || ""})`);
                if (vol) {
                    const volumeVal = vol.volumeStatus ? vol.volumeStatus.volume : vol.volume;
                    const mutedVal = vol.volumeStatus ? vol.volumeStatus.muteStatus : vol.muted;
                    console.log(`Volume: ${volumeVal}% ${mutedVal ? "[MUDO]" : ""}`);
                }
                break;
            }

            case "off":
            case "turnoff": {
                console.log("Desligando a TV...");
                await client.turnOff();
                console.log("TV desligada.");
                break;
            }

            case "vol":
            case "volume": {
                const sub = args[1];
                if (sub === "+" || sub === "up") {
                    await client.volumeUp();
                    console.log("Volume aumentado.");
                } else if (sub === "-" || sub === "down") {
                    await client.volumeDown();
                    console.log("Volume diminuído.");
                } else if (!isNaN(parseInt(sub, 10))) {
                    const val = parseInt(sub, 10);
                    await client.setVolume(val);
                    console.log(`Volume ajustado para ${val}%.`);
                } else {
                    const v = await client.getVolume();
                    console.log("Volume atual:", v);
                }
                break;
            }

            case "mute": {
                const v = await client.getVolume();
                const isMuted = v.volumeStatus ? v.volumeStatus.muteStatus : v.muted;
                await client.setMute(!isMuted);
                console.log(`Mudo: ${!isMuted ? "ATIVADO" : "DESATIVADO"}`);
                break;
            }

            case "nav": {
                const buttonName = (args[1] || "").toUpperCase();
                const validButtons = ["UP", "DOWN", "LEFT", "RIGHT", "ENTER", "BACK", "HOME", "EXIT", "MENU", "RED", "GREEN", "YELLOW", "BLUE"];
                if (!validButtons.includes(buttonName)) {
                    console.log("Botões válidos:", validButtons.join(", "));
                    break;
                }
                await client.button(buttonName);
                console.log(`Botão ${buttonName} pressionado.`);
                break;
            }

            case "ok": {
                await client.button("ENTER");
                console.log("OK pressionado.");
                break;
            }

            case "back": {
                await client.button("BACK");
                console.log("BACK pressionado.");
                break;
            }

            case "home": {
                await client.button("HOME");
                console.log("HOME pressionado.");
                break;
            }

            case "play": {
                await client.mediaPlay();
                console.log("Play enviado.");
                break;
            }

            case "pause": {
                await client.mediaPause();
                console.log("Pause enviado.");
                break;
            }

            case "apps": {
                const res = await client.listLaunchPoints();
                console.log("Aplicativos instalados na TV:");
                (res.launchPoints || []).forEach(a => {
                    console.log(` - ${a.title.padEnd(25)} [${a.id}]`);
                });
                break;
            }

            case "inputs": {
                const res = await client.getExternalInputList();
                console.log("Entradas externas (HDMI):");
                (res.devices || []).forEach(d => {
                    console.log(` - ${d.label} [${d.id}] (conectado: ${d.connected})`);
                });
                break;
            }

            case "app": {
                const target = args[1];
                if (!target) {
                    console.log("Uso: lgtv app <nome_ou_id>");
                    break;
                }
                const res = await client.listLaunchPoints();
                const list = res.launchPoints || [];
                const matched = list.find(a => 
                    a.id.toLowerCase() === target.toLowerCase() ||
                    a.title.toLowerCase().includes(target.toLowerCase())
                );
                if (matched) {
                    console.log(`Iniciando ${matched.title} (${matched.id})...`);
                    await client.launch(matched.id);
                } else {
                    console.log(`Iniciando app id direto: ${target}...`);
                    await client.launch(target);
                }
                break;
            }

            case "input": {
                const target = args[1];
                if (!target) {
                    console.log("Uso: lgtv input <hdmi1|hdmi2|...>");
                    break;
                }
                const res = await client.getExternalInputList();
                const list = res.devices || [];
                const matched = list.find(d => 
                    d.id.toLowerCase().replace("_", "") === target.toLowerCase().replace("_", "") ||
                    d.label.toLowerCase().includes(target.toLowerCase())
                );
                if (matched) {
                    console.log(`Alternando para entrada ${matched.label} (${matched.id})...`);
                    await client.switchInput(matched.id);
                } else {
                    const fallbackId = target.toUpperCase().startsWith("HDMI") ? target.toUpperCase().replace("HDMI", "HDMI_") : target;
                    console.log(`Alternando para entrada ${fallbackId}...`);
                    await client.switchInput(fallbackId);
                }
                break;
            }

            default:
                console.log("Comandos disponíveis: status, pair, on, off, vol, mute, nav, ok, back, home, play, pause, apps, inputs, app, input, discover");
        }
    } finally {
        client.close();
    }
}

main().catch(err => {
    console.error("Erro:", err);
    process.exit(1);
});
