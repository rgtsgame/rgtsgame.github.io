import { initRenderer, loadMap, render, updateRemotePlayers, updateViewModel, getCamera } from './renderer.js';
import { initInput, initGame, updateGame } from './game.js';
import { SyncManager } from './syncManager.js';
import { initCharacterPreview } from './characterPreview.js';

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
        this.ammoEl = document.getElementById('ammo-val');
        this.reserveEl = document.getElementById('reserve-val');
        this.reloadHint = document.getElementById('reload-hint');
        this.reserveEl = document.getElementById('reserve-val');
        this.weaponNameEl = document.getElementById('weapon-name');

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

    setAmmo(current, max, reserve = null) {
        if (this.ammoEl) this.ammoEl.textContent = current === Infinity ? '∞' : current;
        if (reserve !== null && this.reserveEl) {
            this.reserveEl.textContent = reserve === Infinity ? '∞' : reserve;
        }
        if (this.ammoEl) this.ammoEl.classList.toggle('low', current <= 5 && current !== Infinity);
    }

    showReloading() {
        if (this.reloadHint) this.reloadHint.classList.add('show');
        if (this.ammoEl) this.ammoEl.classList.add('reloading');
    }

    hideReloading() {
        if (this.reloadHint) this.reloadHint.classList.remove('show');
        if (this.ammoEl) this.ammoEl.classList.remove('reloading');
    }

    showAmmoWarning() {
        if (!this.ammoEl) return;
        this.ammoEl.classList.add('empty');
        setTimeout(() => this.ammoEl.classList.remove('empty'), 500);
    }

    addKillFeed(text, opts = {}) {
        if (!this.killfeed) return;

        const {
            duration = 4000,
            accent = null,
            type = 'info',
        } = opts;

        const entry = document.createElement('div');
        entry.className = `feed-entry feed-${type}`;
        entry.textContent = text;

        if (accent) entry.style.borderLeftColor = accent;

        this.killfeed.appendChild(entry);
        void entry.offsetWidth;
        entry.classList.add('enter');

        const exitTimer = setTimeout(() => {
            entry.classList.remove('enter');
            entry.classList.add('exit');
            setTimeout(() => entry.remove(), 400);
        }, duration);

        const MAX_ENTRIES = 6;
        while (this.killfeed.children.length > MAX_ENTRIES) {
            const oldest = this.killfeed.firstElementChild;
            if (!oldest) break;
            clearTimeout(oldest._exitTimer);
            oldest.classList.remove('enter');
            oldest.classList.add('exit');
            setTimeout(() => oldest.remove(), 400);
        }

        entry._exitTimer = exitTimer;
    }

    setWeaponName(name) {
        const el = document.getElementById('weapon-name');
        if (el) el.textContent = name;
    }

    highlightSlot(slotNum) {
        document.querySelectorAll('#hotbar .slot').forEach(el => el.classList.remove('active'));
        const target = document.getElementById(`slot-${slotNum}`);
        if (target) target.classList.add('active');
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

    showError(title, text = "") {
        canvas.style.display = "none";
        document.exitPointerLock();

        crosshair.classList.add('hidden');

        this.hudEl?.classList.add('hidden');

        document.getElementById("error-title").innerText = title;
        document.getElementById("error-text").innerText = text;
        document.getElementById("error-overlay").classList.add("show");
    }
}

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

export const soundManager = new SoundManager();
export const syncManager = new SyncManager();
export let hud = null;

soundManager.load('shoot', 'shoot.mp3');
soundManager.load('gun_reload', 'gun_reload.mp3');
soundManager.load('sword_attack', 'sword_attack.mp3');

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

        const displayName = localStorage.getItem('displayName');
        if (displayName) {
            document.getElementById("username-input").value = displayName;
        }

        document.getElementById("login-btn").innerText = displayName || "未設定名稱";

        document.getElementById("login-btn").removeEventListener("click", openLoginPopup);
        document.getElementById("login-btn").addEventListener("click", () => {
            localStorage.removeItem("authToken");
            localStorage.removeItem("uid");
            localStorage.removeItem("displayName");
            location.reload();
        });
    }
});

document.querySelectorAll('#hotbar .slot').forEach(slot => {
    slot.addEventListener('click', () => {
        const key = slot.dataset.key;
        import('./game.js').then(m => m.switchWeapon?.(parseInt(key)));
    });
});

document.getElementById("login-btn").addEventListener("click", openLoginPopup);

document.getElementById("settings").addEventListener("click", (e) => {
    if (e.ctrlKey) window.open(syncManager.serverUrl.replace("wss://", "https://").replace("/ws", "/admin.html"));
});

document.getElementById("error-back-btn").addEventListener("click", () => {
    isGameActive = false;

    document.getElementById("error-overlay").classList.remove("show");

    menuContainer.style.display = 'flex';
    setTimeout(() => {
        canvas.style.display = "";
        menuContainer.classList.remove("fade-out");
    }, 600);
});

export const loadingOverlay = document.getElementById('loading-overlay');
export const loadingText = document.getElementById('loading-text');
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

    menuContainer.classList.add('fade-out');
    setTimeout(() => menuContainer.style.display = 'none', 300);

    crosshair.classList.remove('hidden');

    hud.show();
    hud.setHealth(100);
    hud.setAmmo(30, 30, 90);
    hud.setWeaponName('AK-47');
    hud.highlightSlot(1);

    loadingOverlay.classList.add('show');
    loadingText.innerText = "正在加入遊戲...";

    syncManager.connectForGame();

    canvas.requestPointerLock();
});

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

    initCharacterPreview('character-preview');

    serverStatusText.innerText = "正在尋找伺服器...";
    await syncManager.fetchServerUrl();

    serverStatusText.innerText = "正在測試延遲...";
    const ping = await syncManager.pingServer();

    initGame(mapData);
    initInput(canvas);

    hud = new HUD();

    requestAnimationFrame(loop);

    if (ping !== null) {
        serverStatusText.innerHTML = `🟢 伺服器在線<br><span style="color: #4CAF50; font-size: 16px;">延遲: 約 ${ping}ms</span>`;
    } else {
        serverStatusText.innerHTML = `<span style="color: #F44336;">🔴 伺服器已離線</span>`;
    }

    playBtn.disabled = false;

    serverStatusText.classList.remove("pinging");
}

let _lastFrame = performance.now();

let _lastCamPos = null;

function loop() {
    requestAnimationFrame(loop);
    const now = performance.now();
    const dt = Math.min((now - _lastFrame) / 1000, 0.1);
    _lastFrame = now;

    updateGame();
    updateRemotePlayers(dt);

    const cam = getCamera();
    const moving = _lastCamPos
        ? cam.position.distanceToSquared(_lastCamPos) > 0.0001
        : false;
    _lastCamPos = cam.position.clone();

    updateViewModel(now / 1000, moving);

    syncManager.sync();
    render();
}

boot();