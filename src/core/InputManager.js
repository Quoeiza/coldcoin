import EventEmitter from './EventEmitter.js';

export default class InputManager extends EventEmitter {
    constructor(globalConfig) {
        super();
        this.keys = {};
        
        this.initListeners();
    }

    initListeners() {
        window.addEventListener('keydown', (e) => {
            this.keys[e.code] = true;
            this.handleInput(e.code);
        });

        window.addEventListener('keyup', (e) => {
            this.keys[e.code] = false;
        });

        // Mobile / UI Button bindings
        const bindBtn = (id, code) => {
            const el = document.getElementById(id);
            if (el) {
                el.addEventListener('touchstart', (e) => {
                    e.preventDefault();
                    this.handleInput(code);
                });
                el.addEventListener('click', (e) => {
                    this.handleInput(code);
                });
            }
        };

        bindBtn('btn-up', 'ArrowUp');
        bindBtn('btn-down', 'ArrowDown');
        bindBtn('btn-left', 'ArrowLeft');
        bindBtn('btn-right', 'ArrowRight');
        bindBtn('btn-attack', 'Space');
        bindBtn('btn-pickup', 'KeyR');
        bindBtn('btn-ability', 'KeyF');
    }

    handleInput(code) {
        let intent = null;

        switch(code) {
            case 'ArrowUp':
            case 'KeyW':
            case 'Numpad8':
                intent = { type: 'MOVE', direction: { x: 0, y: -1 } };
                break;
            case 'ArrowDown':
            case 'KeyS':
            case 'Numpad2':
                intent = { type: 'MOVE', direction: { x: 0, y: 1 } };
                break;
            case 'ArrowLeft':
            case 'KeyA':
            case 'Numpad4':
                intent = { type: 'MOVE', direction: { x: -1, y: 0 } };
                break;
            case 'ArrowRight':
            case 'KeyD':
            case 'Numpad6':
                intent = { type: 'MOVE', direction: { x: 1, y: 0 } };
                break;
            case 'KeyQ':
            case 'Numpad7':
                intent = { type: 'MOVE', direction: { x: -1, y: -1 } };
                break;
            case 'KeyE':
            case 'Numpad9':
                intent = { type: 'MOVE', direction: { x: 1, y: -1 } };
                break;
            case 'KeyZ':
            case 'Numpad1':
                intent = { type: 'MOVE', direction: { x: -1, y: 1 } };
                break;
            case 'KeyX':
            case 'Numpad3':
                intent = { type: 'MOVE', direction: { x: 1, y: 1 } };
                break;
            case 'Space':
            case 'Enter':
                intent = { type: 'ATTACK' };
                break;
            case 'KeyR':
                intent = { type: 'PICKUP' };
                break;
            case 'KeyF':
                intent = { type: 'ABILITY' };
                break;
            case 'Digit1':
                intent = { type: 'USE_ITEM', slot: 'quick1' };
                break;
            case 'Digit2':
                intent = { type: 'USE_ITEM', slot: 'quick2' };
                break;
            case 'Digit3':
                intent = { type: 'USE_ITEM', slot: 'quick3' };
                break;
            case 'Escape':
                intent = { type: 'TOGGLE_MENU' };
                break;
        }

        if (intent) {
            this.emit('intent', intent);
        }
    }
}