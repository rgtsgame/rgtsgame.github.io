import { initRenderer, loadMap, render, updateRemotePlayers } from './renderer.js';
import { initInput, initGame, updateGame } from './game.js';
import { SyncManager } from './syncManager.js';

// ============================================================
// HUD
// ============================================================
class HUD {
    constructor() {
        this.hpEl = document.getElementById('hp-val');
        this.hitmarker = document.getElementById('hitmarker');
        this.killfeed = document.getElementById('killfeed');
        this.deathOverlay = document.getElementById('death-overlay');
        this.respawnSec = document.getElementById('respawn-sec');
        this.sbBody = document.getElementById('sb-body');
        this.sbEl = document.getElementById('scoreboard');
        this.damageEl = document.getElementById('damage-flash');
        this.hudEl = document.getElementById('hud');

        document.addEventListener('keydown', e => {
            if (e.code === 'Tab') {
                e.preventDefault();
                this.sbEl?.classList.remove('hidden');
            }
        });
        document.addEventListener('keyup', e => {
            if (e.code === 'Tab') this.sbEl?.classList.add('hidden');
        });
    }

    show() { this.hudEl?.classList.remove('hidden'); }

    setHealth(v) {
        if (this.hpEl) this.hpEl.textContent = Math.round(v);
    }

    showHitmarker() {
        if (!this.hitmarker) return;
        this.hitmarker.classList.remove('show');
        void this.hitmarker.offsetWidth;
        this.hitmarker.classList.add('show');
    }

    flashDamage() {
        if (!this.damageEl) return;
        this.damageEl.classList.add('flash');
        setTimeout(() => this.damageEl.classList.remove('flash'), 200);
    }

    showDeathOverlay(seconds) {
        if (!this.deathOverlay) return;
        this.deathOverlay.classList.remove('hidden');
        let s = seconds;
        if (this.respawnSec) this.respawnSec.textContent = s;
        clearInterval(this._timer);
        this._timer = setInterval(() => {
            s--;
            if (this.respawnSec) this.respawnSec.textContent = Math.max(s, 0);
            if (s <= 0) clearInterval(this._timer);
        }, 1000);
    }

    hideDeathOverlay() {
        clearInterval(this._timer);
        this.deathOverlay?.classList.add('hidden');
    }

    addKillFeed(text) {
        if (!this.killfeed) return;
        const d = document.createElement('div');
        d.textContent = text;
        this.killfeed.prepend(d);
        setTimeout(() => d.remove(), 4000);
    }

    updateScoreboard(rows) {
        if (!this.sbBody) return;
        this.sbBody.innerHTML = '';
        for (const [id, name, kills, deaths] of rows) {
            const tr = document.createElement('tr');
            tr.innerHTML = `<td>${name}</td><td>${kills}</td><td>${deaths}</td>`;
            this.sbBody.appendChild(tr);
        }
    }
}

// ============================================================
// SOUND
// ============================================================
class SoundManager {
    constructor() {
        this.sounds = {};
        this.enabled = true;
    }

    load(name, url) {
        const audio = new Audio(url);
        audio.preload = 'auto';
        this.sounds[name] = audio;
    }

    play(name, volume = 1.0, pitch = 1.0) {
        if (!this.enabled || !this.sounds[name]) return;
        const sound = this.sounds[name].cloneNode();
        sound.volume = volume;
        sound.playbackRate = pitch;
        sound.play().catch(e => console.warn("Audio play blocked:", e));
    }
}

// ============================================================
// SHARED EXPORTS
// ============================================================
export const soundManager = new SoundManager();
export const syncManager = new SyncManager();
export let hud = null;

soundManager.load('shoot', 'shoot.mp3');

// ============================================================
// AUTH / MENU
// ============================================================
function openLoginPopup() {
    const parentOrigin = window.location.origin;
    window.open(
        `https://freegeometricgames.com/login?popup_origin=${encodeURIComponent(parentOrigin)}`,
        '_blank'
    );
}

window.addEventListener('message', (event) => {
    if (event.origin !== 'https://freegeometricgames.com') return;
    if (event.data.type === 'AUTH_SUCCESS') {
        const idToken = event.data.idToken;
        const payload = JSON.parse(atob(idToken.split('.')[1]));
        localStorage.setItem('authToken', idToken);
        localStorage.setItem('uid', payload.userId);
        localStorage.setItem('displayName', payload.name);
        location.reload();
    }
});

window.addEventListener("DOMContentLoaded", () => {
    if (localStorage.getItem("authToken")) {
        document.getElementById("login-btn").innerText = localStorage.getItem("displayName") || "未設定名稱";
        document.getElementById("login-btn").removeEventListener("click", openLoginPopup);
        document.getElementById("login-btn").addEventListener("click", () => {
            localStorage.removeItem("authToken");
            localStorage.removeItem("uid");
            localStorage.removeItem("displayName");
            location.reload();
        });
    }
});

document.getElementById("login-btn").addEventListener("click", openLoginPopup);

// ============================================================
// DOM REFS
// ============================================================
const loadingOverlay = document.getElementById('loading-overlay');
const loadingText = document.getElementById('loading-text');
const menuContainer = document.getElementById('menu-container');
const playBtn = document.getElementById('btn-play');
const crosshair = document.getElementById('crosshair');
const serverStatusText = document.querySelector('.server-status h2');
const canvas = document.getElementById('game-canvas');

initRenderer(canvas);

let isGameActive = false;
let mapData = null;

playBtn.addEventListener('click', () => {
    if (isGameActive) return;
    if (!mapData) {
        alert("Map not loaded yet!");
        return;
    }

    isGameActive = true;
    playBtn.innerText = "PLAYING";

    menuContainer.classList.add('fade-out');
    setTimeout(() => menuContainer.style.display = 'none', 300);

    crosshair.classList.remove('hidden');

    hud?.show();
    hud?.setHealth(100);

    syncManager.connectForGame();

    canvas.requestPointerLock();
});

// ============================================================
// BOOT
// ============================================================
async function boot() {
    loadingOverlay.classList.add('show');
    loadingText.innerText = "正在驗證遊戲...";

    try {
        const res = await fetch("https://freegeometricgames.com/api/rgts/verity");
        const data = await res.json();
        if (data.success !== true) {
            console.error("驗證失敗: ", data);
            alert("遊戲驗證失敗，請重新載入後再試一次，並確認您遊玩的是正版。");
            location.href = "https://rgtsgame.github.io";
            return;
        }
    } catch (err) {
        console.error("驗證失敗: ", err);
        alert("驗證失敗，請確認網路連線。");
        location.href = "https://rgtsgame.github.io";
        return;
    }

    loadingText.innerText = "正在載入地圖...";
    mapData = await loadMap('map.json');

    loadingText.innerText = "遊戲準備中...";

    loadingOverlay.classList.remove('show');
    menuContainer.classList.remove('fade-out');

    serverStatusText.innerText = "正在尋找伺服器...";
    await syncManager.fetchServerUrl();

    serverStatusText.innerText = "正在測試延遲...";
    const ping = await syncManager.pingServer();

    initGame(mapData);
    initInput(canvas);

    // Instantiate HUD after DOM is ready
    hud = new HUD();

    requestAnimationFrame(loop);

    if (ping !== null) {
        serverStatusText.innerHTML = `🟢 伺服器在線<br><span style="color: #4CAF50; font-size: 16px;">延遲: 約 ${ping}ms</span>`;
    } else {
        serverStatusText.innerHTML = `<span style="color: #F44336;">🔴 伺服器已離線</span>`;
    }

    serverStatusText.classList.remove("pinging");
}

function loop() {
    requestAnimationFrame(loop);
    const dt = 0.016;   // approximate — replace with real delta if you have one
    updateGame();
    updateRemotePlayers(dt);
    syncManager.sync();
    render();
}

boot();