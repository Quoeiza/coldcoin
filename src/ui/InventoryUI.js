export class InventoryUI {
    constructor(lootSystem) {
        this.lootSystem = lootSystem;
        this.handleEquipItem = null;
    }

    init() {
        this._setupSlotDrop(document.getElementById('slot-weapon'), 'weapon');
        this._setupSlotDrop(document.getElementById('slot-armor'), 'armor');
    }

    setCallbacks(handleEquipItem) {
        this.handleEquipItem = handleEquipItem;
    }

    renderInventory(myId) {
        const grid = document.getElementById('inventory-grid');
        const inv = this.lootSystem.getInventory(myId);
        const equip = this.lootSystem.getEquipment(myId);

        if (!grid || !inv || !equip) {
            console.error("Inventory UI elements not found or data missing.");
            return;
        }

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
                // Simple colour coding based on type
                const type = this.lootSystem.getItemType(item.itemId);
                icon.style.backgroundColor = type === 'weapon' ? '#d65' : type === 'armor' ? '#56d' : '#5d5';
                
                const config = this.lootSystem.getItemConfig(item.itemId);
                let tooltip = config ? config.name : item.itemId;
                if (config) {
                    if (config.damage) tooltip += `
Damage: ${config.damage}`;
                    if (config.defense) tooltip += `
Defense: ${config.defense}`;
                    if (config.effect) tooltip += `
Effect: ${config.effect} (${config.value})`;
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
            if (!el) return;
            el.innerHTML = '';
            const item = equip[slotName];
            if (item) {
                const icon = document.createElement('div');
                icon.className = 'item-icon';
                icon.style.backgroundColor = slotName.startsWith('quick') ? '#5d5' : (slotName === 'weapon' ? '#d65' : '#56d');
                
                const config = this.lootSystem.getItemConfig(item.itemId);
                let tooltip = config ? config.name : item.itemId;
                if (config) {
                    if (config.damage) tooltip += `
Damage: ${config.damage}`;
                    if (config.defense) tooltip += `
Defense: ${config.defense}`;
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
        
        const slotsContainer = document.querySelector('.equipment-slots');
        if (slotsContainer && !document.getElementById('slot-quick1')) {
            const quickContainer = document.createElement('div');
            quickContainer.style.display = 'flex';
            quickContainer.style.gap = '5px';
            quickContainer.innerHTML = `
                <div class="slot-container"><div id="slot-quick1" class="equip-slot" data-slot="quick1"></div><span>1</span></div>
                <div class="slot-container"><div id="slot-quick2" class="equip-slot" data-slot="quick2"></div><span>2</span></div>
                <div class="slot-container"><div id="slot-quick3" class="equip-slot" data-slot="quick3"></div><span>3</span></div>
            `;
            slotsContainer.appendChild(quickContainer);
            
            this._setupSlotDrop(document.getElementById('slot-quick1'), 'quick1');
            this._setupSlotDrop(document.getElementById('slot-quick2'), 'quick2');
            this._setupSlotDrop(document.getElementById('slot-quick3'), 'quick3');
        }
        renderSlot('quick1');
        renderSlot('quick2');
        renderSlot('quick3');
    }

    updateQuickSlotUI(myId) {
        const hud = document.getElementById('quick-slots-hud');
        if (!hud) return;
        
        const equip = this.lootSystem.getEquipment(myId);
        if (!equip) return;
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

    _setupSlotDrop(element, slotName) {
        if (!element) return;
        element.addEventListener('dragover', (e) => e.preventDefault());
        element.addEventListener('drop', (e) => {
            e.preventDefault();
            const data = JSON.parse(e.dataTransfer.getData('text/plain'));
            const targetSlot = slotName || element.dataset.slot;
            if (data && data.itemId && this.handleEquipItem) {
                this.handleEquipItem(data.itemId, targetSlot);
            }
        });
    }
}
