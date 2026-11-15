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
            this.serverUrl = `wss://${data.ws_url}`;
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
            this.socket.send(JSON.stringify([2, this.myId]));
            
            clearInterval(this.pingInterval);
            this.pingInterval = setInterval(() => {
                if (this.socket.readyState === WebSocket.OPEN) {
                    this.lastPingTime = performance.now();
                    this.socket.send(JSON.stringify([0]));
                }
            }, 2000);
        };

        this.socket.onmessage = (event) => {
            const data = JSON.parse(event.data);
            const packetId = data[0];

            if (packetId === 0) {
                this.currentPing = Math.round(performance.now() - this.lastPingTime);
                this.updatePingUI();
            }
            else if (packetId === 1) {
                // We will import these functions dynamically to avoid circular dependencies
                import('./renderer.js').then(module => {
                    module.updateRemotePlayer(data[1], data[2], data[3], data[4], data[5]);
                });
            } 
            else if (packetId === 2) {
                import('./renderer.js').then(module => {
                    module.spawnRemotePlayer(data[1], 0, 0, 0);
                });
            }
            else if (packetId === 3) {
                import('./renderer.js').then(module => {
                    module.removeRemotePlayer(data[1]);
                });
            }
        };

        this.socket.onclose = () => {
            clearInterval(this.pingInterval);
            const pingDisplay = document.getElementById('ping-display');
            if (pingDisplay) pingDisplay.innerText = `Disconnected`;
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

        // Import game.js dynamically to get player position without circular dependency
        import('./game.js').then(module => {
            const player = module.getLocalPlayer();
            if (!player) return;
            
            const x = Math.round(player.position.x * 100) / 100;
            const y = Math.round(player.position.y * 100) / 100;
            const z = Math.round(player.position.z * 100) / 100;
            const yaw = Math.round(module.getYaw() * 100) / 100;

            this.socket.send(JSON.stringify([1, x, y, z, yaw]));
        });
    }

    sendShoot() {
        if (this.socket && this.socket.readyState === WebSocket.OPEN) {
            this.socket.send(JSON.stringify([4]));
        }
    }
}