import * as THREE from 'three';
import { initRenderer, loadMap, render } from './renderer.js';
import { initInput, initGame, updateGame } from './game.js';

const canvas = document.getElementById('game-canvas');
initRenderer(canvas);

// Load map data once, then hand it to both renderer and game
const mapData = await loadMap('map.json');
initGame(mapData);
initInput(canvas);

function loop() {
  requestAnimationFrame(loop);
  updateGame();
  render();
}
loop();