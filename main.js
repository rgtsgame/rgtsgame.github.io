import { initRenderer, loadMap, render } from './renderer.js';
import { initInput, initGame, updateGame } from './game.js';
import { SyncManager } from './syncManager.js';

const syncManager = new SyncManager();

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

const loadingOverlay = document.getElementById('loading-overlay');
const loadingText = document.getElementById('loading-text');
const menuContainer = document.getElementById('menu-container');
const playBtn = document.getElementById('btn-play');
const serverStatusText = document.querySelector('.server-status h2');

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
soundManager.load('shoot', 'shoot.mp3');

const canvas = document.getElementById('game-canvas');
initRenderer(canvas);

let isGameActive = false;
let mapData = null;

async function boot() {
    if (!await verity()) return;

    loadingText.innerText = "正在載入地圖...";

    const mapData = await loadMap('map.json');

    loadingText.innerText = "正在尋找伺服器...";
    await syncManager.fetchServerUrl();
    
    loadingText.innerText = "正在連線至伺服器...";
    const ping = await syncManager.pingServer();

    if (ping !== null) {
        serverStatusText.innerHTML = `伺服器在線<br><span style="color: #4CAF50; font-size: 16px;">延遲: ${ping}ms</span>`;
    } else {
        serverStatusText.innerHTML = `<span style="color: #F44336;">伺服器已離線</span>`;
    }

    loadingText.innerText = "遊戲準備中...";

    initGame(mapData);
    initInput(canvas);

    loadingOverlay.classList.remove('show');
}

function loop() {
    requestAnimationFrame(loop);
    updateGame();
    render();
}

async function verity() {
    loadingOverlay.classList.add('show');
    loadingText.innerText = "正在驗證遊戲...";

    let success = false;

    try {
        await fetch("https://freegeometricgames.com/api/rgts/verity").then((res) => res.json())
            .then((data) => {
                if (data.success === true) {
                    loop();
                    success = data.success;
                }
                else {
                    console.error("驗證失敗: " + data);
                    alert("遊戲驗證失敗，請重新載入後再試一次，並確認您遊玩的是正版。");
                    location.href = "https://rgtsgame.github.io";

                    success = false;
                }
            });
    }
    catch (err) {
        console.error("驗證失敗: " + err);
        alert("遊戲驗證失敗，請重新載入後再試一次，並確認您遊玩的是正版。");
        location.href = "https://rgtsgame.github.io";
    }

    return success;
}

boot();