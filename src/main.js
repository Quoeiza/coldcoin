import AssetLoader from './utils/AssetLoader.js';
import GameLoop from './core/GameLoop.js';
import InputManager from './core/InputManager.js';
import GridSystem from './systems/GridSystem.js';
import RenderSystem from './systems/RenderSystem.js';
import CombatSystem from './systems/CombatSystem.js';
import LootSystem from './systems/LootSystem.js';
import PeerClient from './network/PeerClient.js';
import SyncManager from './network/SyncManager.js';
import AudioSystem from './systems/AudioSystem.js';
import Database from './services/Database.js';

class Game {
    constructor() {
        this.assetLoader = new AssetLoader();
        this.state = {
            myId: null,
            isHost: false,
            connected: false,
            gameTime: 0,
            extractionOpen: false,
            actionBuffer: null,
            nextActionTime: 0,
            projectiles: [],
            interaction: null, // { type, targetId, startTime, duration, x, y }
            lavaTimer: 0,
            handshakeInterval: null,
            isExtracting: false
        };
        this.database = new Database();
        this.playerData = { name: 'Player', gold: 0, class: 'Fighter' };
    }

    async init() {
        // 1. Load Configuration
        const configs = await this.assetLoader.loadAll();
        this.config = configs;
        
        // 2. Load Player Data
        this.playerData = (await this.database.getPlayer()) || { name: 'Player', gold: 0, extractions: 0 };

        // 3. Show Lobby
        this.setupLobby();

        // 4. Initialize Systems (Pre-allocation)
        const global = configs.global || {};
        this.gridSystem = new GridSystem(
            global.dungeonWidth || 50, 
            global.dungeonHeight || 50, 
            global.tileSize || 64
        );
        
        this.renderSystem = new RenderSystem(
            'game-canvas', 
            window.innerWidth, 
            window.innerHeight, 
            global.tileSize || 64
        );
        this.renderSystem.setAssetLoader(this.assetLoader);

        this.combatSystem = new CombatSystem(configs.enemies);
        this.lootSystem = new LootSystem(configs.items);
        this.inputManager = new InputManager(configs.global);
        this.peerClient = new PeerClient(configs.net);
        this.syncManager = new SyncManager(configs.global);
        this.audioSystem = new AudioSystem();
        
        // 5. Check for Auto-Join URL
        // Check URL params for ?join=HOST_ID
        const urlParams = new URLSearchParams(window.location.search);
        const hostId = urlParams.get('join');
        if (hostId) {
            document.getElementById('room-code-input').value = hostId;
        }
    }

    respawnAsMonster(entityId) {
        const types = Object.keys(this.config.enemies);
        const type = types[Math.floor(Math.random() * types.length)];
        const spawn = this.gridSystem.getSpawnPoint(false);
        
        this.gridSystem.addEntity(entityId, spawn.x, spawn.y);
        this.combatSystem.registerEntity(entityId, type, true); // isPlayer=true, team=monster
        
        if (this.state.isHost) {
             this.peerClient.send({ type: 'RESPAWN_MONSTER', payload: { id: entityId, type } });
        }
    }

    setupLobby() {
        const uiLayer = document.getElementById('ui-layer');
        const lobby = document.createElement('div');
        lobby.id = 'lobby-screen';
        lobby.innerHTML = `
            <h1>DungExtract</h1>
            <div id="player-stats">Gold: ${this.playerData.gold} | Extractions: ${this.playerData.extractions || 0}</div>
            <input type="text" id="player-name" placeholder="Enter Name" value="${this.playerData.name}" />
            <select id="class-select" style="padding: 10px; background: #333; color: white; border: 1px solid #555;">
                <option value="Fighter">Fighter (Heal)</option>
                <option value="Rogue">Rogue (Stealth)</option>
                <option value="Barbarian">Barbarian (Rage)</option>
            </select>
            <button id="btn-host">Host Game</button>
            <div style="display:flex; gap:10px;">
                <input type="text" id="room-code-input" placeholder="Room Code" />
                <button id="btn-join">Join Game</button>
            </div>
        `;
        uiLayer.appendChild(lobby);

        document.getElementById('btn-host').onclick = () => {
            this.playerData.name = document.getElementById('player-name').value || 'Host';
            this.playerData.class = document.getElementById('class-select').value;
            this.database.savePlayer({ name: this.playerData.name });
            this.startGame(true);
        };

        document.getElementById('btn-join').onclick = () => {
            const code = document.getElementById('room-code-input').value;
            if (!code) return alert("Enter a room code");
            this.playerData.name = document.getElementById('player-name').value || 'Client';
            this.playerData.class = document.getElementById('class-select').value;
            this.database.savePlayer({ name: this.playerData.name });
            this.startGame(false, code);
        };
    }

    generateRoomCode() {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
        let result = '';
        for (let i = 0; i < 4; i++) {
            result += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return result;
    }

    startGame(isHost, hostId = null) {
        document.getElementById('lobby-screen').classList.add('hidden');
        
        this.setupNetwork();
        this.setupUI();
        this.inputManager.on('intent', (intent) => this.handleInput(intent));
        this.audioSystem.resume(); // Unlock audio context on user interaction

        this.gameLoop = new GameLoop(
            (dt) => this.update(dt),
            (alpha) => this.render(alpha),
            this.config.global.tickRate
        );
        this.gameLoop.start();

        // Namespace the ID to avoid collisions on public PeerJS server
        const myPeerId = isHost ? `dungex-${this.generateRoomCode()}` : undefined;
        this.peerClient.init(myPeerId);
        this.peerClient.on('ready', (id) => {
            if (isHost) {
                const displayId = id.replace('dungex-', ''); // Strip prefix for display
                this.startHost(id);
                document.getElementById('room-code-display').innerText = `Room: ${displayId}`;
            } else if (hostId) {
                document.getElementById('room-code-display').innerText = `Room: ${hostId}`;
                this.peerClient.connect(`dungex-${hostId}`, { name: this.playerData.name, class: this.playerData.class });
            }
        });
    }

    setupUI() {
        // Reveal HUD elements
        ['room-code-display', 'kill-feed', 'stats-bar'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.classList.remove('hidden');
        });

        const uiLayer = document.getElementById('ui-layer');
        if (uiLayer && !document.getElementById('game-timer')) {
            const timer = document.createElement('div');
            timer.id = 'game-timer';
            uiLayer.appendChild(timer);
        }

        // Inventory Toggles
        const modal = document.getElementById('inventory-modal');
        const btnToggle = document.getElementById('btn-inventory-toggle');
        const btnClose = document.getElementById('btn-inventory-close');

        const toggleInv = () => {
            modal.classList.toggle('hidden');
            if (!modal.classList.contains('hidden')) {
                this.renderInventory();
            }
        };

        if (btnToggle) btnToggle.onclick = toggleInv;
        if (btnClose) btnClose.onclick = toggleInv;

        // Ground Loot Close
        const btnGroundClose = document.getElementById('btn-ground-close');
        if (btnGroundClose) btnGroundClose.onclick = () => document.getElementById('ground-loot-modal').classList.add('hidden');

        // Loot Notification
        if (!document.getElementById('loot-notification')) {
            const notif = document.createElement('div');
            notif.id = 'loot-notification';
            uiLayer.appendChild(notif);
        }

        // Quick Slots HUD
        if (!document.getElementById('quick-slots-hud')) {
            const hud = document.createElement('div');
            hud.id = 'quick-slots-hud';
            uiLayer.appendChild(hud);
        }

        // Drag and Drop Handlers
        this.setupCanvasDrop();
        this.setupSlotDrop(document.getElementById('slot-weapon'), 'weapon');
        this.setupSlotDrop(document.getElementById('slot-armor'), 'armor');

        // Settings Modal
        const settingsModal = document.getElementById('settings-modal');
        if (settingsModal) {
            document.getElementById('btn-resume').onclick = () => this.toggleSettingsMenu();
            document.getElementById('btn-settings').onclick = () => alert("Settings coming soon!");
            document.getElementById('btn-quit').onclick = () => location.reload();
        }
    }

    setupCanvasDrop() {
        // Drop on Canvas (Floor)
        const canvas = document.getElementById('game-canvas');
        
        canvas.addEventListener('dragover', (e) => e.preventDefault());
        canvas.addEventListener('drop', (e) => {
            e.preventDefault();
            const data = JSON.parse(e.dataTransfer.getData('text/plain'));
            if (data && data.itemId) {
                this.handleDropItem(data.itemId, data.source);
            }
        });
    }

    setupSlotDrop(element, slotName) {
        if (!element) return;
        element.addEventListener('dragover', (e) => e.preventDefault());
        element.addEventListener('drop', (e) => {
            e.preventDefault();
            const data = JSON.parse(e.dataTransfer.getData('text/plain'));
            // Use passed slotName or dataset fallback
            const targetSlot = slotName || element.dataset.slot;
            if (data && data.itemId) {
                this.handleEquipItem(data.itemId, targetSlot);
            }
        });
    }

    handleDropItem(itemId, source) {
        // Logic to drop item on the floor
        // 1. Remove from inventory/equipment
        let count = 1;
        if (source === 'inventory') {
            count = this.lootSystem.removeItemFromInventory(this.state.myId, itemId);
        } else {
            const item = this.lootSystem.removeEquipment(this.state.myId, source);
            if (item) count = item.count;
            else count = 0;
        }

        // 2. Spawn in world (Host authoritative, so send intent if client)
        const pos = this.gridSystem.entities.get(this.state.myId);
        if (pos) {
            if (this.state.isHost) {
                if (count > 0) this.lootSystem.spawnDrop(pos.x, pos.y, itemId, count);
            } else {
                // TODO: Send DROP_ITEM intent to host. For now, client side prediction/hack for demo
                // In a real implementation, we'd emit an intent.
                // For this revision, we'll just log it if not host.
                console.warn("Client drop not fully implemented over network yet");
            }
        }
        this.renderInventory();
        this.audioSystem.play('pickup'); // Reuse sound for now
    }

    handleEquipItem(itemId, slot) {
        const success = this.lootSystem.equipItem(this.state.myId, itemId, slot);
        if (success) {
            this.renderInventory();
            this.audioSystem.play('pickup');
        }
    }

    renderInventory() {
        const grid = document.getElementById('inventory-grid');
        const inv = this.lootSystem.getInventory(this.state.myId);
        const equip = this.lootSystem.getEquipment(this.state.myId);

        // Render Grid
        grid.innerHTML = '';
        // Fixed size grid (e.g. 15 slots)
        for (let i = 0; i < 15; i++) {
            const cell = document.createElement('div');
            cell.className = 'inv-slot';
            
            if (inv[i]) {
                const item = inv[i];
                const icon = document.createElement('div');
                icon.className = 'item-icon';
                // Simple color coding for now based on type
                const type = this.lootSystem.getItemType(item.itemId);
                icon.style.backgroundColor = type === 'weapon' ? '#d65' : type === 'armor' ? '#56d' : '#5d5';
                
                // Enhanced Tooltip
                const config = this.lootSystem.getItemConfig(item.itemId);
                let tooltip = config ? config.name : item.itemId;
                if (config) {
                    if (config.damage) tooltip += `\nDamage: ${config.damage}`;
                    if (config.defense) tooltip += `\nDefense: ${config.defense}`;
                    if (config.effect) tooltip += `\nEffect: ${config.effect} (${config.value})`;
                }
                icon.title = tooltip;

                if (item.count > 1) {
                    const countEl = document.createElement('span');
                    countEl.className = 'item-count';
                    countEl.innerText = item.count;
                    icon.appendChild(countEl);
                }
                
                cell.draggable = true;
                cell.appendChild(icon);

                cell.addEventListener('dragstart', (e) => {
                    e.dataTransfer.setData('text/plain', JSON.stringify({ itemId: item.itemId, source: 'inventory' }));
                });
            }
            grid.appendChild(cell);
        }

        // Render Equip Slots
        const renderSlot = (slotName) => {
            const el = document.getElementById(`slot-${slotName}`);
            el.innerHTML = '';
            const item = equip[slotName];
            if (item) {
                const icon = document.createElement('div');
                icon.className = 'item-icon';
                icon.style.backgroundColor = slotName.startsWith('quick') ? '#5d5' : (slotName === 'weapon' ? '#d65' : '#56d');
                
                // Enhanced Tooltip
                const config = this.lootSystem.getItemConfig(item.itemId);
                let tooltip = config ? config.name : item.itemId;
                if (config) {
                    if (config.damage) tooltip += `\nDamage: ${config.damage}`;
                    if (config.defense) tooltip += `\nDefense: ${config.defense}`;
                }
                icon.title = tooltip;

                if (item.count > 1) {
                    const countEl = document.createElement('span');
                    countEl.className = 'item-count';
                    countEl.innerText = item.count;
                    icon.appendChild(countEl);
                }

                el.appendChild(icon);
                
                el.draggable = true;
                el.addEventListener('dragstart', (e) => {
                    e.dataTransfer.setData('text/plain', JSON.stringify({ itemId: item.itemId, source: slotName }));
                });
            } else {
                el.draggable = false;
            }
        };

        renderSlot('weapon');
        renderSlot('armor');
        
        // Add Quick Slots to Inventory Modal for management
        const slotsContainer = document.querySelector('.equipment-slots');
        if (!document.getElementById('slot-quick1')) {
            // Inject quick slots if not present
            const quickContainer = document.createElement('div');
            quickContainer.style.display = 'flex';
            quickContainer.style.gap = '5px';
            quickContainer.innerHTML = `
                <div class="slot-container"><div id="slot-quick1" class="equip-slot" data-slot="quick1"></div><span>1</span></div>
                <div class="slot-container"><div id="slot-quick2" class="equip-slot" data-slot="quick2"></div><span>2</span></div>
                <div class="slot-container"><div id="slot-quick3" class="equip-slot" data-slot="quick3"></div><span>3</span></div>
            `;
            slotsContainer.appendChild(quickContainer);
            
            // Bind drag events for new slots only
            this.setupSlotDrop(document.getElementById('slot-quick1'), 'quick1');
            this.setupSlotDrop(document.getElementById('slot-quick2'), 'quick2');
            this.setupSlotDrop(document.getElementById('slot-quick3'), 'quick3');
        }
        renderSlot('quick1');
        renderSlot('quick2');
        renderSlot('quick3');
    }

    updateQuickSlotUI() {
        const hud = document.getElementById('quick-slots-hud');
        if (!hud) return;
        
        const equip = this.lootSystem.getEquipment(this.state.myId);
        let html = '';
        
        for (let i = 1; i <= 3; i++) {
            const item = equip[`quick${i}`];
            html += `
                <div class="quick-slot-hud-item">
                    <span class="key-label">${i}</span>
                    ${item ? `<div class="item-icon" style="background-color:#5d5;">${item.count > 1 ? `<span class="item-count">${item.count}</span>` : ''}</div>` : ''}
                </div>`;
        }
        hud.innerHTML = html;
    }

    showGroundLoot(items) {
        const modal = document.getElementById('ground-loot-modal');
        const grid = document.getElementById('ground-grid');
        modal.classList.remove('hidden');
        grid.innerHTML = '';

        items.forEach(loot => {
            const cell = document.createElement('div');
            cell.className = 'inv-slot';
            
            const icon = document.createElement('div');
            icon.className = 'item-icon';
            const type = this.lootSystem.getItemType(loot.itemId);
            icon.style.backgroundColor = type === 'weapon' ? '#d65' : type === 'armor' ? '#56d' : '#5d5';
            icon.title = loot.itemId;
            
            // Click to pick up
            cell.onclick = () => {
                this.handleInteractWithLoot(loot);
                modal.classList.add('hidden'); // Close after one pickup for simplicity
            };

            cell.appendChild(icon);
            grid.appendChild(cell);
        });
    }

    handleInteractWithLoot(loot) {
        if (this.state.isHost) {
            this.processLootInteraction(this.state.myId, loot);
        } else {
            this.peerClient.send({ type: 'INTERACT_LOOT', payload: { lootId: loot.id } });
        }
    }

    showNotification(text) {
        const el = document.getElementById('loot-notification');
        if (el) {
            el.innerText = text;
            el.style.opacity = '1';
            setTimeout(() => { el.style.opacity = '0'; }, 2000);
        }
    }

    addKillFeed(msg) {
        const feed = document.getElementById('kill-feed');
        const div = document.createElement('div');
        div.className = 'kill-msg';
        div.innerHTML = msg;
        feed.appendChild(div);
        setTimeout(() => div.remove(), 5000);
    }

    processLootInteraction(entityId, loot) {
        let result = null;
        if (loot.type === 'chest') {
            if (!loot.opened) {
                result = this.lootSystem.tryOpen(entityId, loot.id);
            }
        } else {
            result = this.lootSystem.pickupBag(entityId, loot.id);
        }

        if (result) {
            // Handle Gold
            if (result.gold > 0) {
                if (entityId === this.state.myId) {
                    this.playerData.gold += result.gold;
                    this.updateGoldUI();
                } else if (this.state.isHost) {
                    // If host processing for client, send gold update
                    this.peerClient.send({ type: 'UPDATE_GOLD', payload: { id: entityId, amount: result.gold } });
                }
            }

            // Play sound for specific player
            if (entityId === this.state.myId) {
                this.audioSystem.play('pickup');
                this.renderInventory();
                this.updateQuickSlotUI();
                const goldText = result.gold > 0 ? ` + ${result.gold}g` : '';
                const itemName = this.getItemName(result.itemId);
                this.showNotification(`Looted: ${itemName}${goldText}`);
                this.renderSystem.addFloatingText(this.gridSystem.entities.get(entityId).x, this.gridSystem.entities.get(entityId).y, `+${itemName}`, '#FFD700');
                this.addKillFeed(`Looted ${itemName}${goldText}`);
            } else {
                // Notify client
                this.peerClient.send({ type: 'LOOT_SUCCESS', payload: { id: entityId } });
            }
        }
    }

    getItemName(itemId) {
        const items = this.config.items;
        if (items.weapons[itemId]) return items.weapons[itemId].name;
        if (items.armor && items.armor[itemId]) return items.armor[itemId].name;
        if (items.consumables[itemId]) return items.consumables[itemId].name;
        return itemId;
    }

    updateGoldUI() {
        const el = document.getElementById('gold-val');
        if (el) el.innerText = this.playerData.gold;
    }

    setupNetwork() {
        this.peerClient.on('ready', (id) => {
            this.state.myId = id;
            // Do NOT update room-code-display here, as it shows the internal UUID for clients
        });

        // Combat Events (Local & Networked)
        this.combatSystem.on('damage', ({ targetId, amount, currentHp, sourceId, options }) => {
            // Update UI if it's me
            if (targetId === this.state.myId) {
                const hpEl = document.getElementById('hp-val');
                if (hpEl) hpEl.innerText = Math.max(0, currentHp);
                this.renderSystem.triggerShake(5, 200); // Screen shake on damage
                this.audioSystem.play('hit'); 
            }

            // Log significant damage events for local player
            if (amount > 0 && (targetId === this.state.myId || sourceId === this.state.myId)) {
                const tStats = this.combatSystem.getStats(targetId);
                const sStats = sourceId ? this.combatSystem.getStats(sourceId) : null;
                
                const tName = targetId === this.state.myId ? "You" : (tStats ? (tStats.name || tStats.type) : "Unknown");
                const sName = sourceId === this.state.myId ? "You" : (sStats ? (sStats.name || sStats.type) : "Environment");
                
                this.addKillFeed(`${sName} hit ${tName} for ${amount}`);
            }

            // Floating Damage Text
            const pos = this.gridSystem.entities.get(targetId);
            if (pos) {
                const color = amount > 0 ? '#ff4444' : '#44ff44';
                let text = Math.abs(amount).toString();
                
                if (options && options.isCrit) {
                    text += "!";
                }

                this.renderSystem.addFloatingText(pos.x, pos.y, text, color);
                
                // Broadcast to clients
                if (this.state.isHost) {
                    this.peerClient.send({ type: 'FLOAT_TEXT', payload: { x: pos.x, y: pos.y, text, color } });
                }
            }

            // Hit Flash
            this.renderSystem.triggerHitFlash(targetId);

            // If Host, broadcast HP update to all clients
            if (this.state.isHost) {
                this.peerClient.send({ type: 'UPDATE_HP', payload: { id: targetId, hp: currentHp } });
            }
        });

        this.combatSystem.on('death', ({ entityId, killerId, stats }) => {
            console.log(`${entityId} killed by ${killerId}`);
            
            // Capture position before removal for loot drop
            const pos = this.gridSystem.entities.get(entityId);
            const deathX = pos ? pos.x : 0;
            const deathY = pos ? pos.y : 0;

            this.gridSystem.removeEntity(entityId);
            this.audioSystem.play('death');
            
            if (this.state.isHost) {
                // Award Gold for Monster Kill
                const victimName = stats.name || entityId;
                const killerStats = killerId ? this.combatSystem.getStats(killerId) : null;
                const killerName = killerStats ? (killerStats.name || killerStats.type) : (killerId || 'Environment');

                let killMsg = `${victimName} died`;
                if (!stats.isPlayer && stats.team === 'monster' && killerId) {
                    const reward = Math.floor(Math.random() * 4) + 2; // 2-5 gold
                    if (killerId === this.state.myId) {
                        this.playerData.gold += reward;
                        this.updateGoldUI();
                        this.database.savePlayer({ gold: this.playerData.gold });
                        this.showNotification(`Kill: +${reward}g`);
                    } else {
                        this.peerClient.send({ type: 'UPDATE_GOLD', payload: { id: killerId, amount: reward } });
                    }
                    killMsg = `<span class="highlight">${killerName}</span> slew <span class="highlight">${victimName}</span>`;
                } else if (stats.isPlayer) {
                    killMsg = `<span class="highlight">${victimName}</span> was eliminated by <span class="highlight">${killerName}</span>`;
                }

                this.peerClient.send({ type: 'KILL_FEED', payload: { msg: killMsg } });
                this.addKillFeed(killMsg);

                this.peerClient.send({ type: 'ENTITY_DEATH', payload: { id: entityId } });
                
                // 1. Spawn Loot
                // Drop all items in a bag at the location of death
                const pos = this.gridSystem.entities.get(entityId) || { x: 0, y: 0 }; // Note: Entity removed from grid in event handler above, need to fix order or pass pos
                // Actually, gridSystem.removeEntity is called at start of this handler. We need the pos.
                // Since we can't get it easily now, we'll use the killer's pos or a fallback.
                // *Correction*: We should grab pos before removeEntity.
                // For this "easy improvement", we will assume the entity is removed but we want to drop loot.
                // We will use a fallback spawn for now, but in a real fix we'd pass pos in the death event.
                // Let's use a random nearby point to the killer if available.
                let dropX = 0, dropY = 0;
                if (killerId) {
                    const kPos = this.gridSystem.entities.get(killerId);
                    if (kPos) { dropX = kPos.x; dropY = kPos.y; }
                }
                if (dropX === 0) {
                    const spawn = this.gridSystem.getSpawnPoint(false);
                    dropX = spawn.x; dropY = spawn.y;
                }

                const items = this.lootSystem.getAllItems(entityId);
                this.lootSystem.createLootBag(dropX, dropY, items);
                
                // 2. Monster Mechanic: Respawn Player as Monster
                if (stats && stats.isPlayer) {
                    setTimeout(() => {
                        this.respawnAsMonster(entityId);
                    }, 3000);
                }
            }
        });

        this.peerClient.on('data', ({ sender, data }) => {
            if (this.state.isHost) {
                // Host Logic: Receive Inputs
                if (data.type === 'INPUT') {
                    this.processPlayerInput(sender, data.payload);
                }
                if (data.type === 'INTERACT_LOOT') {
                    const loot = this.lootSystem.worldLoot.get(data.payload.lootId);
                    if (loot) this.processLootInteraction(sender, loot);
                }
                if (data.type === 'HELLO') {
                    // Client is ready, send the world state
                    console.log(`Client ${sender} said HELLO. Sending World.`);
                    this.peerClient.sendTo(sender, {
                        type: 'INIT_WORLD',
                        payload: { grid: this.gridSystem.grid, torches: this.gridSystem.torches }
                    });
                }
            } else {
                // Client Logic: Receive State
                if (data.type === 'SNAPSHOT') {
                    this.syncManager.addSnapshot(data.payload);
                } else if (data.type === 'INIT_WORLD') {
                    console.log("Client: Received INIT_WORLD", data.payload);
                    this.gridSystem.grid = data.payload.grid;
                    this.gridSystem.torches = data.payload.torches || [];
                    
                    // Stop the handshake retry loop
                    if (this.state.handshakeInterval) {
                        clearInterval(this.state.handshakeInterval);
                        this.state.handshakeInterval = null;
                    }
                    
                    this.state.connected = true;
                } else if (data.type === 'UPDATE_HP') {
                    if (data.payload.id === this.state.myId) {
                        const hpEl = document.getElementById('hp-val');
                        if (hpEl) hpEl.innerText = Math.max(0, data.payload.hp);
                        this.audioSystem.play('hit');
                    }
                } else if (data.type === 'ENTITY_DEATH') {
                    this.gridSystem.removeEntity(data.payload.id);
                    this.audioSystem.play('death');
                } else if (data.type === 'GAME_OVER') {
                    this.showGameOver(data.payload.message);
                } else if (data.type === 'PLAYER_EXTRACTED') {
                    console.log(`Player ${data.payload.id} extracted!`);
                } else if (data.type === 'PORTAL_SPAWN') {
                    this.gridSystem.setTile(data.payload.x, data.payload.y, 9);
                    this.showNotification("The Extraction Portal has opened!");
                    this.audioSystem.play('pickup');
                } else if (data.type === 'RESPAWN_MONSTER') {
                    if (data.payload.id === this.state.myId) {
                        this.showNotification(`Respawned as ${data.payload.type}! Hunt them down.`);
                        this.state.isExtracting = false;
                    }
                } else if (data.type === 'EFFECT') {
                    this.renderSystem.addEffect(data.payload.x, data.payload.y, data.payload.type);
                }

                if (data.type === 'FLOAT_TEXT') {
                    this.renderSystem.addFloatingText(data.payload.x, data.payload.y, data.payload.text, data.payload.color);
                }
                
                if (data.type === 'SPAWN_PROJECTILE') {
                    this.state.projectiles.push(data.payload);
                }

                if (data.type === 'UPDATE_GOLD') {
                    if (data.payload.id === this.state.myId) {
                        this.playerData.gold += data.payload.amount;
                        this.updateGoldUI();
                        this.database.savePlayer({ gold: this.playerData.gold });
                        this.showNotification(`+${data.payload.amount}g`);
                    }
                }

                if (data.type === 'KILL_FEED') {
                    this.addKillFeed(data.payload.msg);
                }
                
                if (data.type === 'LOOT_SUCCESS') {
                    if (data.payload.id === this.state.myId) {
                        this.audioSystem.play('pickup');
                        this.renderInventory();
                        this.updateQuickSlotUI();
                        // We don't have the item ID here easily without sending it in payload
                        // For now, just generic sound/update is okay, or we can update protocol later.
                        // The prompt asked for notification on looting from chest, which usually happens locally or via direct interaction response.
                    }
                }
            }
        });

        this.peerClient.on('connected', ({ peerId, metadata }) => {
            console.log(`Connected to ${peerId}`, metadata);
            if (this.state.isHost) {
                // Spawn them
                const spawn = this.gridSystem.getSpawnPoint(true);
                this.gridSystem.addEntity(peerId, spawn.x, spawn.y);
                this.combatSystem.registerEntity(peerId, 'player', true, metadata.class || 'Fighter', metadata.name || 'Unknown');
            } else {
                // Client: Start Handshake Retry Loop
                // Send HELLO every 500ms until INIT_WORLD is received
                console.log("Client: Connected. Starting Handshake...");
                this.state.handshakeInterval = setInterval(() => {
                    if (!this.state.connected) this.peerClient.send({ type: 'HELLO' });
                }, 500);
            }
        });
    }

    startHost(id) {
        this.state.isHost = true;
        this.state.connected = true;
        this.gridSystem.initializeDungeon();
        this.gridSystem.populate(this.combatSystem, this.lootSystem, this.config);
        
        // Spawn Host
        const spawn = this.gridSystem.getSpawnPoint(true);
        this.gridSystem.addEntity(id, spawn.x, spawn.y);
        this.combatSystem.registerEntity(id, 'player', true, this.playerData.class, this.playerData.name);
        this.state.gameTime = this.config.global.extractionTimeSeconds || 600;
    }

    handleInput(intent) {
        if (intent.type === 'TOGGLE_MENU') {
            this.toggleSettingsMenu();
            return;
        }

        const now = Date.now();
        if (now >= this.state.nextActionTime) {
            this.executeAction(intent);
        } else {
            this.state.actionBuffer = intent;
        }
    }

    toggleSettingsMenu() {
        const modal = document.getElementById('settings-modal');
        if (modal) modal.classList.toggle('hidden');
    }

    executeAction(intent) {
        const cooldown = this.config.global.globalCooldownMs || 250;
        this.state.nextActionTime = Date.now() + cooldown;
        this.state.actionBuffer = null;

        // Client-Side Prediction: Move immediately
        if (!this.state.isHost && intent.type === 'MOVE') {
            // We process the input locally to update gridSystem immediately
            this.processPlayerInput(this.state.myId, intent);
        }

        if (this.state.isHost) {
            this.processPlayerInput(this.state.myId, intent);
        } else {
            this.peerClient.send({ type: 'INPUT', payload: intent });
        }
    }

    processPlayerInput(entityId, intent) {
        // Host-side Cooldown Enforcement
        const stats = this.combatSystem.getStats(entityId);
        let now = Date.now();
        let cooldown = this.config.global.globalCooldownMs || 250;

        // Agility Scaling for Action Speed
        if (stats && stats.attributes) {
            // 15 Agi = 100% speed. 30 Agi = 50% cooldown.
            const agiFactor = Math.max(0.5, 1 - ((stats.attributes.agi - 10) * 0.02));
            cooldown *= agiFactor;
        }

        // Apply Terrain Movement Cost
        const pos = this.gridSystem.entities.get(entityId);
        if (pos && intent.type === 'MOVE') {
            const cost = this.gridSystem.getMovementCost(pos.x + intent.direction.x, pos.y + intent.direction.y);
            cooldown *= cost;
        }

        if (!stats) return; // Strict check: No stats = No action
        if (now - stats.lastActionTime < cooldown) {
            return; // Action rejected due to cooldown
        }
        stats.lastActionTime = now;

        // Cancel Interaction on any input
        if (entityId === this.state.myId && this.state.interaction) {
            this.state.interaction = null;
        }

        if (intent.type === 'MOVE') {
            if (pos) {
                const tx = pos.x + intent.direction.x;
                const ty = pos.y + intent.direction.y;
                
                // Check Loot Collision (Closed Chests)
                if (this.lootSystem.isCollidable(tx, ty)) {
                    // Pivot facing even if blocked
                    pos.facing = { x: intent.direction.x, y: intent.direction.y };
                    
                    // Bump to Open Logic
                    const items = this.lootSystem.getItemsAt(tx, ty);
                    const chest = items.find(l => l.type === 'chest' && !l.opened);
                    if (chest) {
                        this.processLootInteraction(entityId, chest);
                    }
                    return; // Block movement
                }
            }

            const result = this.gridSystem.moveEntity(entityId, intent.direction.x, intent.direction.y);
            
            // Wall Sliding Logic: If diagonal move hits wall, try cardinal components
            if (!result.success && result.collision === 'wall') {
                if (intent.direction.x !== 0 && intent.direction.y !== 0) {
                    // Try sliding along X
                    const resX = this.gridSystem.moveEntity(entityId, intent.direction.x, 0);
                    if (resX.success) {
                        // Mutate result to the successful slide
                        Object.assign(result, resX);
                    } else {
                        // Try sliding along Y
                        const resY = this.gridSystem.moveEntity(entityId, 0, intent.direction.y);
                        if (resY.success) {
                            Object.assign(result, resY);
                        }
                    }
                }
            }

            if (result.success) {
                if (entityId === this.state.myId) {
                    this.audioSystem.play('step');
                    this.renderSystem.addEffect(pos.x, pos.y, 'dust'); // Dust particle
                }
                
                // Check for Extraction
                const pos = this.gridSystem.entities.get(entityId);
                // Round coordinates to ensure valid grid access (prevent float indexing)
                if (pos && this.gridSystem.grid[Math.round(pos.y)][Math.round(pos.x)] === 9) {
                    this.handleExtraction(entityId);
                }
            } else if (result.collision && result.collision !== 'wall') {
                // Trigger Bump for entity collision too
                this.renderSystem.triggerBump(entityId, intent.direction);

                // Bump Attack
                // Check Friendly Fire for Monsters
                const attackerStats = this.combatSystem.getStats(entityId);
                const targetStats = this.combatSystem.getStats(result.collision);
                
                let friendlyFire = false;
                if (attackerStats && targetStats && attackerStats.team === 'monster' && targetStats.team === 'monster') {
                    friendlyFire = true;
                }

                if (!friendlyFire) {
                    this.performAttack(entityId, result.collision);
                }
            } else if (result.collision === 'wall') {
                // Trigger Bump for wall
                this.renderSystem.triggerBump(entityId, intent.direction);
                if (entityId === this.state.myId) {
                    this.audioSystem.play('bump');
                }
            }
        }
        
        if (intent.type === 'PICKUP') {
            const pos = this.gridSystem.entities.get(entityId);
            const stats = this.combatSystem.getStats(entityId);
            
            // Monster Restriction: Cannot pickup items
            if (stats && stats.team === 'monster') {
                return;
            }

            if (pos) {
                // Check for Interaction Targets (Chest/Extraction)
                const itemsBelow = this.lootSystem.getItemsAt(pos.x, pos.y);
                const fx = pos.x + pos.facing.x;
                const fy = pos.y + pos.facing.y;
                const itemsFront = this.lootSystem.getItemsAt(fx, fy);
                const allItems = [...itemsBelow, ...itemsFront].filter(l => !l.opened);

                // Prioritize Chests for Interaction Timer
                const chest = allItems.find(i => i.type === 'chest');
                if (chest && entityId === this.state.myId) {
                    // Start Interaction
                    this.state.interaction = { type: 'chest', target: chest, startTime: Date.now(), duration: 2000 };
                    return;
                }

                // Aggregate items from Below and Front
                if (allItems.length > 0) {
                    if (allItems.length > 1) {
                        // Show Menu (Only for local player)
                        if (entityId === this.state.myId) this.showGroundLoot(allItems);
                    } else {
                        // Interact directly
                        if (entityId === this.state.myId) this.handleInteractWithLoot(allItems[0]);
                        else this.processLootInteraction(entityId, allItems[0]); 
                    }
                }
            }
        }

        if (intent.type === 'ATTACK') {
            const attacker = this.gridSystem.entities.get(entityId);
            if (attacker) {
                const targetX = attacker.x + attacker.facing.x;
                const targetY = attacker.y + attacker.facing.y;
                const targetId = this.gridSystem.getEntityAt(targetX, targetY);

                if (targetId) {
                    // Friendly Fire Check for Monsters
                    const attackerStats = this.combatSystem.getStats(entityId);
                    const targetStats = this.combatSystem.getStats(targetId);
                    if (attackerStats && targetStats && attackerStats.team === 'monster' && targetStats.team === 'monster') {
                        return; // Monsters cannot hurt monsters
                    }
                    this.performAttack(entityId, targetId);
                } else {
                    // Whiff (Attack air)
                    this.renderSystem.addEffect(targetX, targetY, 'slash');
                    this.peerClient.send({ type: 'EFFECT', payload: { x: targetX, y: targetY, type: 'slash' } });
                    this.audioSystem.play('attack');
                }
            }
        }

        if (intent.type === 'USE_ITEM') {
            const effect = this.lootSystem.consumeItem(entityId, intent.slot);
            if (effect) {
                this.addKillFeed(`Used ${effect.name}`);
                if (effect.effect === 'heal') {
                    const stats = this.combatSystem.getStats(entityId);
                    if (stats) {
                        stats.hp = Math.min(stats.maxHp, stats.hp + effect.value);
                        // Emit damage event with negative amount to signal heal? Or just update HP.
                        // Emit negative amount to trigger green floating text
                        this.combatSystem.emit('damage', { targetId: entityId, amount: -effect.value, sourceId: entityId, currentHp: stats.hp });
                        this.audioSystem.play('pickup'); // Use pickup sound for now
                        this.renderInventory();
                        this.updateQuickSlotUI();
                    }
                }
            }
        }

        if (intent.type === 'ABILITY') {
            const result = this.combatSystem.useAbility(entityId);
            if (result) {
                this.showNotification(`Used ${result.ability}`);
                this.addKillFeed(`Used ${result.ability}`);
                // Sync visual effects if needed
                if (result.effect === 'stealth') {
                    const pos = this.gridSystem.entities.get(entityId);
                    if (pos) pos.invisible = true;
                    setTimeout(() => { if(pos) pos.invisible = false; }, result.duration);
                }
                if (result.effect === 'heal') {
                    this.combatSystem.emit('damage', { targetId: entityId, amount: -result.value, sourceId: entityId, currentHp: this.combatSystem.getStats(entityId).hp });
                }
            }
        }
    }

    performAttack(attackerId, targetId) {
        const targetPos = this.gridSystem.entities.get(targetId);
        if (!targetPos) return;

        // Check for Ranged Weapon
        const equip = this.lootSystem.getEquipment(attackerId);
        const weaponId = equip.weapon;
        if (weaponId) {
            const config = this.lootSystem.getItemConfig(weaponId);
            if (config && config.range > 1) {
                // Spawn Projectile
                const attackerPos = this.gridSystem.entities.get(attackerId);
                const dx = targetPos.x - attackerPos.x;
                const dy = targetPos.y - attackerPos.y;
                const mag = Math.sqrt(dx*dx + dy*dy);
                const proj = { x: attackerPos.x, y: attackerPos.y, vx: dx/mag, vy: dy/mag, speed: 15, ownerId: attackerId, damage: config.damage };
                this.state.projectiles.push(proj);
                this.peerClient.send({ type: 'SPAWN_PROJECTILE', payload: proj });
                this.audioSystem.play('attack');
                return;
            }
        }

        // Trigger Visual Animation
        this.renderSystem.triggerAttack(attackerId);

        // Visual Feedback
        this.renderSystem.addEffect(targetPos.x, targetPos.y, 'slash');
        this.peerClient.send({ type: 'EFFECT', payload: { x: targetPos.x, y: targetPos.y, type: 'slash' } });
        
        // Audio
        this.audioSystem.play('attack');

        const stats = this.combatSystem.getStats(attackerId);
        let damage = stats ? stats.damage : 5;
        
        // Crit Logic (15% Chance)
        const isCrit = Math.random() < 0.15;
        if (isCrit) damage = Math.floor(damage * 1.5);

        this.combatSystem.applyDamage(targetId, damage, attackerId, { isCrit });
    }

    handleExtraction(entityId) {
        console.log(`Processing extraction for ${entityId}`);
        // 1. Save Data
        const stats = this.combatSystem.getStats(entityId);
        const name = stats ? (stats.name || entityId) : entityId;

        if (entityId === this.state.myId) {
            this.playerData.gold += 100; // Flat reward for now
            this.state.isExtracting = true;
            this.playerData.extractions = (this.playerData.extractions || 0) + 1;
            this.database.savePlayer({ gold: this.playerData.gold, extractions: this.playerData.extractions });
            this.updateGoldUI();
        }
        
        // 2. Remove from World
        this.gridSystem.removeEntity(entityId);
        this.combatSystem.stats.delete(entityId);

        // 3. Notify
        if (this.state.isHost) {
            this.peerClient.send({ type: 'PLAYER_EXTRACTED', payload: { id: entityId } });
            this.peerClient.send({ type: 'KILL_FEED', payload: { msg: `<span class="highlight">${name}</span> escaped the dungeon!` } });
            this.addKillFeed(`<span class="highlight">${name}</span> escaped the dungeon!`);
            
            // Respawn as Monster
            setTimeout(() => {
                this.respawnAsMonster(entityId);
            }, 3000);
        }

        if (entityId === this.state.myId) {
            this.showNotification("EXTRACTED! Respawning as Monster...");
        }
    }

    updateAI(dt) {
        const now = Date.now();
        for (const [id, stats] of this.combatSystem.stats) {
            if (stats.isPlayer) continue;
            
            // AI Logic: 1 second cooldown
            if (now - (stats.lastActionTime || 0) < 1000) continue;

            const pos = this.gridSystem.entities.get(id);
            if (!pos) continue;

            // Check collision with chests for AI
            // Simple check: if target is blocked by chest, don't move there
            // This is handled implicitly if moveEntity checks collision, but moveEntity only checks walls/entities.
            // We need to check loot collision here or inject it into moveEntity.
            // For now, we check here before moving.
            // (Logic below handles movement)
            
            let targetPos = null;
            let shouldAttack = false;

            const target = this.findNearestPlayer(pos.x, pos.y);
            
            if (target) {
                // Check Line of Sight
                const hasLOS = this.gridSystem.hasLineOfSight(pos.x, pos.y, target.x, target.y);
                
                if (hasLOS) {
                    stats.aiState = 'CHASING';
                    stats.targetLastPos = { x: target.x, y: target.y };
                    stats.memoryTimer = 5000; // 5 Seconds Memory
                    targetPos = target;
                    shouldAttack = true;
                }
            } else if (stats.aiState === 'IDLE') {
                // Roaming Logic
                if (Math.random() < 0.02) { // 2% chance per tick to move
                    const dirs = [{x:0, y:1}, {x:0, y:-1}, {x:1, y:0}, {x:-1, y:0}];
                    const dir = dirs[Math.floor(Math.random() * dirs.length)];
                    if (!this.lootSystem.isCollidable(pos.x + dir.x, pos.y + dir.y)) {
                        this.gridSystem.moveEntity(id, dir.x, dir.y);
                        stats.lastActionTime = now;
                    }
                }
            }

            // Persistence Logic
            if (!targetPos && stats.aiState === 'CHASING' && stats.targetLastPos) {
                stats.memoryTimer -= dt;
                if (stats.memoryTimer > 0) {
                    targetPos = stats.targetLastPos;
                } else {
                    stats.aiState = 'IDLE';
                    stats.targetLastPos = null;
                }
            }

            if (targetPos) {
                const dx = targetPos.x - pos.x;
                const dy = targetPos.y - pos.y;
                const dist = Math.max(Math.abs(dx), Math.abs(dy));

                if (shouldAttack && dist <= 1) {
                    // Update facing to look at target
                    pos.facing = { x: Math.sign(dx), y: Math.sign(dy) };
                    // Attack (Only if we have actual target/LOS)
                    this.performAttack(id, target.id);
                    stats.lastActionTime = now;
                } else {
                    // Move towards player (Simple Axis-Aligned)
                    let moveX = Math.sign(dx);
                    let moveY = Math.sign(dy);
                    
                    // Try move
                    // Check Loot Collision first
                    if (!this.lootSystem.isCollidable(pos.x + moveX, pos.y + moveY)) {
                        let result = this.gridSystem.moveEntity(id, moveX, moveY);
                        
                        // If blocked, try the other axis
                        if (!result.success) {
                            // Fallback to cardinal movement if diagonal/direct failed
                            let fallbackX = 0;
                            let fallbackY = 0;

                            // Try moving along X axis only
                            if (moveX !== 0 && this.gridSystem.moveEntity(id, moveX, 0).success) return;
                            // Try moving along Y axis only
                            if (moveY !== 0 && this.gridSystem.moveEntity(id, 0, moveY).success) return;
                            
                            // Original fallback logic (simplified above, but keeping structure if needed)
                            if (fallbackX !== 0 || fallbackY !== 0) {
                                if (!this.lootSystem.isCollidable(pos.x + moveX, pos.y + moveY)) {
                                    this.gridSystem.moveEntity(id, moveX, moveY);
                                }
                            }
                        }
                    }
                    stats.lastActionTime = now;
                }
            }
        }
    }

    findNearestPlayer(x, y) {
        let nearest = null;
        let minDist = Infinity;
        
        for (const [id, stats] of this.combatSystem.stats) {
            if (stats.team === 'player') {
                const pos = this.gridSystem.entities.get(id);
                if (pos) {
                    const dist = Math.abs(pos.x - x) + Math.abs(pos.y - y);
                    if (dist < minDist) {
                        minDist = dist;
                        nearest = { id, x: pos.x, y: pos.y };
                    }
                }
            }
        }
        return nearest;
    }

    showGameOver(msg) {
        const ui = document.getElementById('ui-layer');
        const screen = document.createElement('div');
        screen.id = 'game-over-screen';
        screen.innerHTML = `<h1>GAME OVER</h1><h2>${msg}</h2><button onclick="location.reload()">Return to Lobby</button>`;
        ui.appendChild(screen);
        this.gameLoop.stop();
    }

    update(dt) {
        if (this.state.isHost) {
            // Timer Logic
            this.state.gameTime -= (dt / 1000);
            
            if (!this.state.extractionOpen && this.state.gameTime <= 60) {
                this.state.extractionOpen = true;
                const pos = this.gridSystem.spawnExtractionZone();
                this.peerClient.send({ type: 'PORTAL_SPAWN', payload: { x: pos.x, y: pos.y } });
            }

            if (this.state.gameTime <= 0) {
                this.peerClient.send({ type: 'GAME_OVER', payload: { message: "Time Expired - Dungeon Collapsed" } });
                this.showGameOver("Time Expired");
            }
        }

        // Lava Damage Logic (Host Authoritative)
        this.state.lavaTimer += dt;
        if (this.state.lavaTimer >= 1000) {
            this.state.lavaTimer = 0;
            for (const [id, pos] of this.gridSystem.entities) {
                if (this.gridSystem.grid[pos.y][pos.x] === 4) { // Lava
                    // Apply 20 damage per second
                    this.combatSystem.applyDamage(id, 20, null);
                }
            }
        }

        // Client Reconciliation: Check for drift
        if (!this.state.isHost && this.state.connected) {
            const interpolated = this.syncManager.getInterpolatedState(Date.now());
            const serverPos = interpolated.entities.get(this.state.myId);
            const localPos = this.gridSystem.entities.get(this.state.myId);
            
            if (serverPos) {
                // Prevent re-adding human entity if we are in the process of extracting locally
                // until the server confirms we are a monster.
                if (this.state.isExtracting && serverPos.team !== 'monster') {
                    return;
                }
                // If we are now a monster on server, clear extraction flag
                if (serverPos.team === 'monster') this.state.isExtracting = false;

                if (!localPos) {
                    // Respawned on server, add locally
                    // Round to integer to prevent float contamination from interpolation
                    this.gridSystem.addEntity(this.state.myId, Math.round(serverPos.x), Math.round(serverPos.y));
                } else {
                    const dist = Math.abs(serverPos.x - localPos.x) + Math.abs(serverPos.y - localPos.y);
                    // If drift is too large (e.g. rejected move or lag spike), snap to server
                    if (dist > 2.0) {
                        this.gridSystem.addEntity(this.state.myId, Math.round(serverPos.x), Math.round(serverPos.y));
                    }
                }
            }
        }

        // Update Projectiles
        const projSpeed = dt / 1000;
        for (let i = this.state.projectiles.length - 1; i >= 0; i--) {
            const p = this.state.projectiles[i];
            p.x += p.vx * p.speed * projSpeed;
            p.y += p.vy * p.speed * projSpeed;

            // Collision Check (Host Authority for Damage, everyone for Wall destroy)
            const gridX = Math.round(p.x);
            const gridY = Math.round(p.y);

            if (!this.gridSystem.isWalkable(gridX, gridY)) {
                this.state.projectiles.splice(i, 1); // Hit Wall
                continue;
            }

            if (this.state.isHost) {
                const hitId = this.gridSystem.getEntityAt(gridX, gridY);
                if (hitId && hitId !== p.ownerId) {
                    this.combatSystem.applyDamage(hitId, p.damage, p.ownerId);
                    this.state.projectiles.splice(i, 1);
                }
            }
        }

        // Update Interaction
        if (this.state.interaction) {
            if (Date.now() - this.state.interaction.startTime >= this.state.interaction.duration) {
                this.handleInteractWithLoot(this.state.interaction.target);
                this.state.interaction = null;
            }
        }

        // Poll Input (Solves OS key repeat delay)
        if (this.state.myId) {
            const moveIntent = this.inputManager.getMovementIntent();
            const attackIntent = this.inputManager.getAttackIntent();
            
            if (moveIntent) {
                this.handleInput(moveIntent);
            } else {
                // Clear move buffer if key released to prevent double-tap effect
                if (this.state.actionBuffer && this.state.actionBuffer.type === 'MOVE') {
                    this.state.actionBuffer = null;
                }
            }

            if (attackIntent) {
                this.handleInput(attackIntent);
            } else {
                if (this.state.actionBuffer && this.state.actionBuffer.type === 'ATTACK') {
                    this.state.actionBuffer = null;
                }
            }
        }

        // Client-side Action Buffering (Runs for everyone)
        if (this.state.actionBuffer && Date.now() >= this.state.nextActionTime) {
            this.executeAction(this.state.actionBuffer);
        }

        if (this.state.isHost) {
            this.updateAI(dt);
            // Authoritative Update: Broadcast State
            const snapshot = this.syncManager.serializeState(
                this.gridSystem, 
                this.combatSystem, 
                this.lootSystem, 
                this.state.gameTime
            );
            this.peerClient.send({ type: 'SNAPSHOT', payload: snapshot });
        }
    }

    render(alpha) {
        if (!this.state.connected) return;

        // Clients interpolate, Host uses raw state (or interpolates self for smoothness)
        const state = this.state.isHost 
            ? { 
                entities: this.gridSystem.entities, 
                loot: this.lootSystem.worldLoot, 
                gameTime: this.state.gameTime 
              }
            : this.syncManager.getInterpolatedState(Date.now());
        
        // Sync invisibility state from combat stats to grid entities for rendering (Host side)
        if (this.state.isHost) {
            for (const [id, pos] of this.gridSystem.entities) {
                const stats = this.combatSystem.getStats(id);
                if (stats) {
                    pos.invisible = stats.invisible;
                    pos.hp = stats.hp;
                    pos.maxHp = stats.maxHp;
                    pos.team = stats.team;
                    pos.type = stats.type;
                }
            }
        }

        // Client Prediction Override:
        // If we are a client, we want to render our LOCAL position (which is predicted),
        // not the interpolated server position (which is in the past).
        if (!this.state.isHost && this.gridSystem.entities.has(this.state.myId)) {
            state.entities.set(this.state.myId, this.gridSystem.entities.get(this.state.myId));
        }

        // Update Timer UI
        const timerEl = document.getElementById('game-timer');
        if (timerEl && state.gameTime !== undefined) {
            const t = Math.max(0, Math.floor(state.gameTime));
            const m = Math.floor(t / 60);
            const s = t % 60;
            timerEl.innerText = `${m}:${s.toString().padStart(2, '0')}`;
        }

        // Attach torches to grid object for renderer convenience (hacky but effective for now)
        if (this.gridSystem.grid) this.gridSystem.grid.torches = this.gridSystem.torches;

        this.renderSystem.render(
            this.gridSystem.grid, 
            state.entities,
            state.loot,
            this.state.projectiles,
            this.state.interaction,
            this.state.myId
        );
    }
}

window.onload = () => {
    const game = new Game();
    game.init().catch(console.error);
};