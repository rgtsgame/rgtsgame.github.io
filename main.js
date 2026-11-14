import { initRenderer, loadMap, render } from './renderer.js';
import { initInput, initGame, updateGame } from './game.js';

function openLoginPopup() {
    const width = 500;
    const height = 600;
    const left = (screen.width / 2) - (width / 2);
    const top = (screen.height / 2) - (height / 2);

    const parentOrigin = window.location.origin;

    window.open(
        `https://freegeometricgames.com/login?popup_origin=${encodeURIComponent(parentOrigin)}`,
        'LoginPopup',
        `width=${width},height=${height},left=${left},top=${top}`
    );
}

window.addEventListener('message', (event) => {
    //if (event.origin !== 'https://freegeometricgames.com') return;

    if (event.data.type === 'AUTH_SUCCESS') {
        const idToken = event.data.idToken;
        alert(idToken);
        localStorage.setItem('authToken', idToken);
    }
});

document.getElementById("login-btn").addEventListener("click", () => openLoginPopup());

const loadingOverlay = document.getElementById('loading-overlay');
const loadingText = document.getElementById('loading-text');

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

async function boot() {
    if (!await verity()) return;

    loadingText.innerText = "正在載入地圖...";

    const mapData = await loadMap('map.json');

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
