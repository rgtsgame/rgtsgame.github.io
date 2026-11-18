import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';
import { getLocalPlayer, getYaw, getPitch } from './game.js';
import { hud, loadingOverlay, loadingText } from './main.js';

const SUPABASE_URL = 'https://pajtakwbzhkgngfudloj.supabase.co';
const SUPABASE_KEY = 'sb_publishable_9LpfQ4jhWRmNOA5tE31VRw_vF2_2VSy';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

export class SyncManager {
    constructor() {
        this.socket = null;
        this.myId = "player_" + Math.random().toString(36).substring(2, 6);
        this.lastSendTime = 0;
        this.SEND_RATE = 50;
        this.pingInterval = null;
        this.lastPingTime = 0;
        this.currentPing = 0;
        this.serverUrl = null;
        this._syncCallCount = 0;
        this._syncSendCount = 0;
    }

    async fetchServerUrl() {
        try {
            const { data, error } = await supabase
                .from('server_config')
                .select('ws_url')
                .eq('id', 1)
                .single();

            if (error || !data || data.ws_url === 'none') {
                console.error("Could not find server URL.");
                return null;
            }
            this.serverUrl = `wss://${data.ws_url}/ws`;
            return this.serverUrl;
        } catch (err) {
            console.error("Supabase Error:", err);
            return null;
        }
    }

    pingServer() {
        return new Promise((resolve) => {
            if (!this.serverUrl) return resolve(null);

            const startTime = performance.now();
            try {
                const testSocket = new WebSocket(this.serverUrl);
                const timeout = setTimeout(() => {
                    testSocket.close();
                    resolve(null);
                }, 3000);

                testSocket.onopen = () => {
                    clearTimeout(timeout);
                    const ping = Math.round(performance.now() - startTime);
                    testSocket.close();
                    resolve(ping);
                };

                testSocket.onerror = () => {
                    clearTimeout(timeout);
                    resolve(null);
                };
            } catch (ex) {
                console.error(ex);
                resolve(null);
            }
        });
    }

    connectForGame() {
        if (!this.serverUrl) {
            console.error("No server URL available to connect.");
            return;
        }

        const customName = document.getElementById("username-input").value.trim() || "player_" + Math.random().toString(36).substring(2, 6);

        this.socket = new WebSocket(this.serverUrl);
        this.setupEvents(customName);
    }

    setupEvents(playerName) {
        this.socket.onopen = () => {
            console.log("Connected to game server!");
            this.socket.send(JSON.stringify([100, playerName]));

            loadingOverlay.classList.remove('show');

            clearInterval(this.pingInterval);
            this.pingInterval = setInterval(() => {
                if (this.socket.readyState === WebSocket.OPEN) {
                    this.lastPingTime = performance.now();
                    this.socket.send(JSON.stringify([0, Date.now()]));
                }
            }, 2000);
        };

        this.socket.onmessage = (event) => {
            let data;
            try { data = JSON.parse(event.data); } catch { return; }
            if (!Array.isArray(data) || data.length === 0) return;

            const packetId = data[0];

            if (packetId === 0) {
                this.currentPing = Math.round(performance.now() - this.lastPingTime);
                this.updatePingUI();
            }
            else if (packetId === 1) {
                const pid = data[1];
                if (pid === this.myId) return;
                import('./renderer.js').then(m => {
                    m.updateRemotePlayer(pid, data[2], data[3], data[4], data[5], data[6]);
                });
            }
            else if (packetId === 2) {
                const pid = data[1];
                if (pid === this.myId) return;
                import('./renderer.js').then(m => {
                    m.spawnRemotePlayer(pid, data[2] || 'player');
                });
            }
            else if (packetId === 3) {
                import('./renderer.js').then(m => m.removeRemotePlayer(data[1]));
            }
            else if (packetId === 4) {
                const shooterId = data[1];
                if (shooterId === this.myId) return;
                import('./renderer.js').then(m => {
                    m.spawnRemoteTracer(data[2], data[3], data[4], data[5], data[6], data[7]);
                });
                import('./game.js').then(g => {
                    const me = g.getLocalPlayer();
                    if (!me) return;

                    const dist = Math.hypot(
                        ox - me.position.x,
                        oy - me.position.y,
                        oz - me.position.z
                    );

                    // 0 → full volume, 50+ → silent
                    const volume = Math.max(0, 1 - dist / 50) * 0.6;
                    if (volume > 0.02) {
                        import('./main.js').then(m => {
                            m.soundManager?.play('shoot', volume, 1.0);
                        });
                    }
                });
            }
            else if (packetId === 5) {
                if (data[1] !== this.myId) return;
                import('./game.js').then(m => m.onHitConfirmed?.(data[2], data[3], data[7]));
            }
            else if (packetId === 6) {
                if (data[1] !== this.myId) return;
                import('./game.js').then(m => m.onLocalHealth?.(data[2]));
            }
            else if (packetId === 8) {
                const pid = data[1], status = data[2];
                const x = data[3], y = data[4], z = data[5];
                if (pid === this.myId) {
                    import('./game.js').then(m => {
                        if (status === 0) m.onLocalDeath?.();
                        else m.onLocalRespawn?.(x, y, z);
                    });
                } else {
                    import('./renderer.js').then(m => {
                        if (status === 0) m.hideRemotePlayer(pid);
                        else m.showRemotePlayer(pid, x, y, z);
                    });
                }
            }
            else if (packetId === 10) {
                import('./main.js').then(m => m.hud?.updateScoreboard(data[1]));
            }
            else if (packetId === 11) {
                if (data[1] === this.myId) return;
                import('./renderer.js').then(m => m.setRemotePlayerHealth(data[1], data[2]));
            }
            else if (packetId === 12) {
                const shooterName = data[2];
                const targetName = data[4];
                import('./main.js').then(m => {
                    const myName = this.myName;
                    let accent = null;
                    if (shooterName === myName) accent = '#4CAF50';
                    else if (targetName === myName) accent = '#F44336';
                    m.hud?.addKillFeed(`${shooterName} ✖ ${targetName}`, {
                        accent,
                        type: 'kill',
                    });
                });
            }
            else if (packetId === 13) {
                const joinPid = data[1];
                const joinName = data[2];
                if (joinPid === this.myId) return;
                import('./main.js').then(m => {
                    m.hud?.addKillFeed(`${joinName} 加入了戰場`, {
                        accent: '#4CAF50',
                        duration: 3000,
                        type: 'join',
                    });
                });
            }
            else if (packetId === 14) {
                const leftPid = data[1];
                const leftName = data[2];
                if (leftPid === this.myId) return;
                import('./main.js').then(m => {
                    m.hud?.addKillFeed(`${leftName} 離開了戰場`, {
                        accent: '#888888',
                        duration: 3000,
                        type: 'leave',
                    });
                });
            }
            else if (packetId === 17) {
                // [17, pid, weaponKey]
                const pid = data[1];
                const weaponKey = data[2];
                if (pid === this.myId) return;

                // Update the remote player's held weapon model
                import('./renderer.js').then(m => {
                    m.setRemotePlayerWeapon(pid, weaponKey);
                });
            }
            else if (packetId === 101) {
                this.myId = data[1];
                this.myName = data[2];
                console.log("[ws] joined as", this.myId, this.myName);
                import('./game.js').then(m => m.onServerJoined?.(this.myId));
            }
        };

        this.socket.onclose = (e) => {
            console.warn("[ws] closed:", e.code, e.reason);
            clearInterval(this.pingInterval);
            this.pingInterval = null;

            loadingOverlay.classList.remove('show');

            hud.showError("失去連線", "您已與伺服器中斷連線。");
        };

        this.socket.onerror = (e) => {
            console.error("[ws] error:", e);

            setTimeout(() => {
                hud.showError("無法連線至伺服器", "若此問題重複發生，請重新載入此頁面並查看伺服器線上狀態。");
            }, 10);
        };
    }

    updatePingUI() {
        const pingDisplay = document.getElementById('ping-display');
        if (pingDisplay) {
            pingDisplay.innerText = `Ping: ${this.currentPing}ms`;
            pingDisplay.style.color = this.currentPing < 100 ? '#4CAF50' : '#F44336';
        }
    }

    sync() {
        this._syncSendCount++;
        if (this._syncCallCount === 60) {
            console.log("[sync] debug after 1s:",
                "socket:", this.socket?.readyState,
                "player:", !!getLocalPlayer());
        }
        if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;

        const now = performance.now();
        if (now - this.lastSendTime < this.SEND_RATE) return;

        // getLocalPlayer is imported at top — no async, no delay
        const player = getLocalPlayer();
        if (!player) return;   // don't burn the throttle slot

        this.lastSendTime = now;

        const x = Math.round(player.position.x * 100) / 100;
        const y = Math.round(player.position.y * 100) / 100;
        const z = Math.round(player.position.z * 100) / 100;
        const rx = Math.round((getPitch?.() ?? 0) * 100) / 100;
        const ry = Math.round(getYaw() * 100) / 100;

        try {
            this.socket.send(JSON.stringify([1, x, y, z, rx, ry]));
        } catch (e) {
            console.warn("[sync] send failed:", e);
        }
    }

    send(packet) {
        if (this.socket && this.socket.readyState === WebSocket.OPEN) {
            this.socket.send(JSON.stringify(packet));
        }
    }

    sendShoot(origin, direction) {
        if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
        this.socket.send(JSON.stringify([
            4,
            origin.x, origin.y, origin.z,
            direction.x, direction.y, direction.z
        ]));
    }

    sendHit(targetId, dmg, point) {
        if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
        this.socket.send(JSON.stringify([
            9, targetId, dmg, point.x, point.y, point.z
        ]));
    }
}