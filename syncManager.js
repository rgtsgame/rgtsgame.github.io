import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';

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
    }

    // Step 1: Fetch URL from Supabase
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

    // Step 2: Ping test for the Main Menu
    pingServer() {
        return new Promise((resolve) => {
            if (!this.serverUrl) return resolve(null);

            const startTime = performance.now();
            try {
                const testSocket = new WebSocket(this.serverUrl);

                // If it takes longer than 3 seconds, consider it offline
                const timeout = setTimeout(() => {
                    testSocket.close();
                    resolve(null);
                }, 3000);

                testSocket.onopen = () => {
                    clearTimeout(timeout);
                    const ping = Math.round(performance.now() - startTime);
                    testSocket.close(); // Close the test socket
                    resolve(ping);
                };

                testSocket.onerror = () => {
                    clearTimeout(timeout);
                    resolve(null);
                };
            }
            catch (ex) {
                console.error(ex);
                resolve(null);
            }
        });
    }

    // Step 3: Real connection for Gameplay
    connectForGame() {
        if (!this.serverUrl) {
            console.error("No server URL available to connect.");
            return;
        }

        this.socket = new WebSocket(this.serverUrl);
        this.setupEvents();
    }

    setupEvents() {
        this.socket.onopen = () => {
            console.log("Connected to game server!");

            this.socket.send(JSON.stringify([100, this.myId]));

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
            try {
                data = JSON.parse(event.data);
            } catch {
                return;
            }
            if (!Array.isArray(data) || data.length === 0) return;

            const packetId = data[0];

            if (packetId === 0) {
                this.currentPing = Math.round(performance.now() - this.lastPingTime);
                this.updatePingUI();
            }

            else if (packetId === 1) {
                const pid = data[1];
                if (pid === this.myId) return;
                const x = data[2];
                const y = data[3];
                const z = data[4];
                const rx = data[5];
                const ry = data[6];
                import('./renderer.js').then(m => {
                    m.updateRemotePlayer(pid, x, y, z, rx, ry);
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
                const pid = data[1];
                import('./renderer.js').then(m => {
                    m.removeRemotePlayer(pid);
                });
            }

            else if (packetId === 4) {
                const shooterId = data[1];
                if (shooterId === this.myId) return;
                const ox = data[2], oy = data[3], oz = data[4];
                const dx = data[5], dy = data[6], dz = data[7];
                import('./renderer.js').then(m => {
                    m.spawnRemoteTracer(ox, oy, oz, dx, dy, dz);
                });
                import('./main.js').then(m => {
                    m.soundManager?.play('shoot', 0.4, 1.0);
                });
            }

            else if (packetId === 5) {
                const shooterId = data[1];
                if (shooterId !== this.myId) return;
                const targetId = data[2];
                const dmg = data[3];
                const isKill = data[7];
                import('./game.js').then(m => {
                    m.onHitConfirmed?.(targetId, dmg, isKill);
                });
            }

            else if (packetId === 6) {
                const targetId = data[1];
                if (targetId !== this.myId) return;
                const health = data[2];
                import('./game.js').then(m => {
                    m.onLocalHealth?.(health);
                });
            }

            else if (packetId === 8) {
                const pid = data[1];
                const status = data[2];
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
                import('./main.js').then(m => {
                    m.hud?.updateScoreboard(data[1]);
                });
            }

            else if (packetId === 101) {
                this.myId = data[1];
                this.myName = data[2];
                console.log("[ws] joined as", this.myId, this.myName);
                import('./game.js').then(m => m.onServerJoined?.(this.myId));
            }
        };

        this.socket.onerror = (e) => {
            console.error("[ws] error:", e);
        };

        this.socket.onclose = (e) => {
            console.warn("[ws] closed:", e.code, e.reason);
            clearInterval(this.pingInterval);
            this.pingInterval = null;
            const pingDisplay = document.getElementById('ping-display');
            if (pingDisplay) {
                pingDisplay.innerText = `Disconnected`;
                pingDisplay.style.color = '#F44336';
            }
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
        if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
        const now = performance.now();
        if (now - this.lastSendTime < this.SEND_RATE) return;
        this.lastSendTime = now;

        import('./game.js').then(module => {
            const player = module.getLocalPlayer();
            if (!player) return;
            const yaw = module.getYaw();
            const pitch = module.getPitch?.() ?? 0;

            const x = Math.round(player.position.x * 100) / 100;
            const y = Math.round(player.position.y * 100) / 100;
            const z = Math.round(player.position.z * 100) / 100;
            const rx = Math.round(pitch * 100) / 100;
            const ry = Math.round(yaw * 100) / 100;

            this.socket.send(JSON.stringify([1, x, y, z, rx, ry]));
        });
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