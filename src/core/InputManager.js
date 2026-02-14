import EventEmitter from './EventEmitter.js';

export const DIRECTIONS = {
    N:  { x: 0, y: -1 },
    NE: { x: 1, y: -1 },
    E:  { x: 1, y: 0 },
    SE: { x: 1, y: 1 },
    S:  { x: 0, y: 1 },
    SW: { x: -1, y: 1 },
    W:  { x: -1, y: 0 },
    NW: { x: -1, y: -1 },
    NONE: { x: 0, y: 0 }
};

export default class InputManager extends EventEmitter {
    constructor(globalConfig) {
        super();
        this.keys = {};
        this.mouse = { x: 0, y: 0, left: false, right: false, middle: false, wheel: 0 };
        this.canvas = document.getElementById('game-canvas');
        
        this.initListeners();
    }

    initListeners() {
        window.addEventListener('keydown', (e) => {
            this.keys[e.code] = true;
            // Prevent default scrolling for game keys
            if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) {
                e.preventDefault();
            }

            // Only trigger discrete actions on keydown. 
            // Continuous movement is handled via polling in getMovementIntent().
            if (!this.isMovementKey(e.code)) {
                this.handleKeyInput(e.code);
            }
        });

        window.addEventListener('keyup', (e) => {
            this.keys[e.code] = false;
        });

        // Mouse Listeners
        if (this.canvas) {
            this.canvas.addEventListener('mousemove', (e) => {
                const rect = this.canvas.getBoundingClientRect();
                this.mouse.x = e.clientX - rect.left;
                this.mouse.y = e.clientY - rect.top;
            });

            this.canvas.addEventListener('mousedown', (e) => {
                if (e.button === 0) this.mouse.left = true;
                if (e.button === 1) this.mouse.middle = true;
                if (e.button === 2) this.mouse.right = true;
                
                this.emit('click', {
                    button: e.button, // 0: Left, 1: Middle, 2: Right
                    x: this.mouse.x,
                    y: this.mouse.y,
                    shift: !!(this.keys['ShiftLeft'] || this.keys['ShiftRight'])
                });
            });

            this.canvas.addEventListener('mouseup', (e) => {
                if (e.button === 0) this.mouse.left = false;
                if (e.button === 1) this.mouse.middle = false;
                if (e.button === 2) this.mouse.right = false;
            });

            this.canvas.addEventListener('wheel', (e) => {
                this.mouse.wheel = e.deltaY;
                this.emit('scroll', e.deltaY);
            }, { passive: true });
            
            // Disable context menu on canvas for Right Click usage
            this.canvas.addEventListener('contextmenu', e => e.preventDefault());
        }

        // Mobile / UI Button bindings
        const bindBtn = (id, code) => {
            const el = document.getElementById(id);
            if (el) {
                // For movement keys, simulate holding the key for the polling loop
                if (this.isMovementKey(code)) {
                    const setKey = (state) => { this.keys[code] = state; };
                    
                    el.addEventListener('mousedown', (e) => { e.preventDefault(); setKey(true); });
                    el.addEventListener('mouseup', (e) => { e.preventDefault(); setKey(false); });
                    el.addEventListener('mouseleave', (e) => { e.preventDefault(); setKey(false); });
                    
                    el.addEventListener('touchstart', (e) => { e.preventDefault(); setKey(true); });
                    el.addEventListener('touchend', (e) => { e.preventDefault(); setKey(false); });
                } else {
                    // For action keys, trigger the handler directly
                    const trigger = (e) => {
                        e.preventDefault();
                        this.handleKeyInput(code);
                    };
                    el.addEventListener('touchstart', trigger);
                    el.addEventListener('click', trigger);
                }
            }
        };

        bindBtn('btn-up', 'ArrowUp');
        bindBtn('btn-down', 'ArrowDown');
        bindBtn('btn-left', 'ArrowLeft');
        bindBtn('btn-right', 'ArrowRight');
        bindBtn('btn-attack', 'Space'); // Space is now Interact/Attack context
        bindBtn('btn-pickup', 'KeyR');
        bindBtn('btn-ability', 'KeyF');
    }

    isMovementKey(code) {
        return [
            'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
            'KeyW', 'KeyA', 'KeyS', 'KeyD',
            'Numpad8', 'Numpad2', 'Numpad4', 'Numpad6',
            'Numpad7', 'Numpad9', 'Numpad1', 'Numpad3',
            'KeyQ', 'KeyE', 'KeyZ', 'KeyC'
        ].includes(code);
    }

    handleKeyInput(code) {
        let intent = null;

        // Context-Sensitive Interact
        if (code === 'Space' || code === 'Enter') {
            intent = { type: 'INTERACT' };
        }
        
        // UI Toggles
        else if (code === 'KeyI') {
            intent = { type: 'TOGGLE_INVENTORY' };
        }
        else if (code === 'Escape') {
            intent = { type: 'TOGGLE_MENU' };
        }
        else if (code === 'Tab' || code === 'KeyO') {
            intent = { type: 'AUTO_EXPLORE' };
        }
        
        // Ability Slots 1-0 (Mapping to 0-9)
        else if (code.startsWith('Digit')) {
            const num = parseInt(code.replace('Digit', ''));
            if (!isNaN(num)) {
                // 1 -> 0, 2 -> 1, ... 0 -> 9
                const slot = num === 0 ? 9 : num - 1;
                intent = { type: 'USE_ABILITY_SLOT', slot };
            }
        }

        // Legacy / Mobile Fallbacks
        else if (code === 'KeyR') {
            intent = { type: 'PICKUP' };
        }
        else if (code === 'KeyF') {
            intent = { type: 'ABILITY' };
        }

        if (intent) {
            this.emit('intent', intent);
        }
    }

    getMovementIntent() {
        let x = 0;
        let y = 0;

        // North
        if (this.keys['ArrowUp'] || this.keys['KeyW'] || this.keys['Numpad8']) y -= 1;
        // South
        if (this.keys['ArrowDown'] || this.keys['KeyS'] || this.keys['Numpad2']) y += 1;
        // West
        if (this.keys['ArrowLeft'] || this.keys['KeyA'] || this.keys['Numpad4']) x -= 1;
        // East
        if (this.keys['ArrowRight'] || this.keys['KeyD'] || this.keys['Numpad6']) x += 1;
        
        // Diagonals (Overrides)
        if (this.keys['KeyQ'] || this.keys['Numpad7']) { x = -1; y = -1; } // NW
        if (this.keys['KeyE'] || this.keys['Numpad9']) { x = 1; y = -1; }  // NE
        if (this.keys['KeyZ'] || this.keys['Numpad1']) { x = -1; y = 1; }  // SW
        if (this.keys['KeyC'] || this.keys['Numpad3']) { x = 1; y = 1; }   // SE
        
        // Clamp to ensure valid direction vector (-1, 0, 1)
        const dir = { x: Math.sign(x), y: Math.sign(y) };
        const shift = !!(this.keys['ShiftLeft'] || this.keys['ShiftRight']);

        if (dir.x !== 0 || dir.y !== 0) {
            return { type: 'MOVE', direction: dir, shift };
        }
        return null;
    }

    getAttackIntent() {
        // Space/Enter are now handled via event-based 'INTERACT' intent in handleKeyInput.
        // We return null here to prevent the polling loop from firing continuous attacks.
        return null; 
    }

    getMouseState() {
        return { 
            ...this.mouse,
            shift: !!(this.keys['ShiftLeft'] || this.keys['ShiftRight'])
        };
    }
}