import * as THREE from 'three';
import { initRenderer, loadMap, render } from './renderer.js';
import { initInput, initGame, updateGame } from './game.js';

// --- Sound Manager ---
class SoundManager {
  constructor() {
    this.sounds = {};
    this.enabled = true;
  }

  // Load a sound file
  load(name, url) {
    const audio = new Audio(url);
    audio.preload = 'auto';
    this.sounds[name] = audio;
  }

  // Play a sound (clones it so overlapping sounds don't cut each other off)
  play(name, volume = 1.0, pitch = 1.0) {
    if (!this.enabled || !this.sounds[name]) return;
    
    const sound = this.sounds[name].cloneNode();
    sound.volume = volume;
    sound.playbackRate = pitch;
    sound.play().catch(e => console.warn("Audio play blocked:", e));
  }
}

// Initialize and export the sound manager
export const soundManager = new SoundManager();
soundManager.load('shoot', 'shoot.mp3');

// --- Boot Game ---
const canvas = document.getElementById('game-canvas');
initRenderer(canvas);

// Load map data once, then hand it to both renderer and game
const mapData = await loadMap('map.json');
initGame(mapData);
initInput(canvas);

// --- Game Loop ---
function loop() {
  requestAnimationFrame(loop);
  updateGame();
  render();
}

async function verity() {
    const res = await fetch("https://freegeometricgames.com/api/rgts/verity");

    if (res.status === 200 && res.json.success === true) loop();
    else {
        alert("遊戲驗證失敗，請重新載入後再試一次，並確認您遊玩的是正版。");
        location.href = "https://rgtsgame.github.io";
    }
}
verity();
