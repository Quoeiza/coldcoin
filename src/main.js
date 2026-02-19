import GameLoop from './core/GameLoop.js';

const game = new GameLoop();
window.game = game;
window.onload = () => game.init();