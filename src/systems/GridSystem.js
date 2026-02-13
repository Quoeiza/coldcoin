export default class GridSystem {
    constructor(width, height, tileSize) {
        this.width = width;
        this.height = height;
        this.tileSize = tileSize;
        this.grid = []; // 0: Floor, 1: Wall
        this.torches = []; // Array of {x, y}
        this.entities = new Map(); // Map<EntityID, {x, y, facing: {x, y}}>
        this.spatialMap = new Map(); // Map<"x,y", EntityID> - Optimization for O(1) lookups
    }

    initializeDungeon() {
        // 1. Fill with walls
        this.grid = new Array(this.height).fill(0).map(() => new Array(this.width).fill(1));
        this.rooms = [];
        this.torches = [];

        const rooms = [];
        this.spatialMap.clear();
        const maxRooms = 10;
        const minSize = 5;
        const maxSize = 12;

        // 2. Place Rooms
        for (let i = 0; i < maxRooms; i++) {
            const w = Math.floor(Math.random() * (maxSize - minSize + 1)) + minSize;
            const h = Math.floor(Math.random() * (maxSize - minSize + 1)) + minSize;
            const x = Math.floor(Math.random() * (this.width - w - 2)) + 1;
            const y = Math.floor(Math.random() * (this.height - h - 2)) + 1;

            const newRoom = { x, y, w, h, cx: x + Math.floor(w/2), cy: y + Math.floor(h/2) };

            // Check overlap (simple check)
            const failed = rooms.some(r => 
                x < r.x + r.w && x + w > r.x && y < r.y + r.h && y + h > r.y
            );

            if (!failed) {
                this.createRoom(newRoom);
                
                // 3. Connect to previous room
                if (rooms.length > 0) {
                    const prev = rooms[rooms.length - 1];
                    this.createCorridor(prev.cx, prev.cy, newRoom.cx, newRoom.cy);
                }
                rooms.push(newRoom);
                this.rooms.push(newRoom);
            }
        }

        // 4. Generate Environmental Features (Lakes)
        const features = [2, 3, 4]; // Water, Mud, Lava
        for (let i = 0; i < 8; i++) {
            const type = features[Math.floor(Math.random() * features.length)];
            let cx = Math.floor(Math.random() * (this.width - 4)) + 2;
            let cy = Math.floor(Math.random() * (this.height - 4)) + 2;
            
            // Random Walk for organic shape
            for (let j = 0; j < 15; j++) {
                if (cx > 0 && cx < this.width - 1 && cy > 0 && cy < this.height - 1) {
                    if (this.grid[cy][cx] === 0) { // Only replace floor
                        this.grid[cy][cx] = type;
                    }
                }
                cx += Math.floor(Math.random() * 3) - 1;
                cy += Math.floor(Math.random() * 3) - 1;
            }
        }

        // 5. Place Wall Torches
        for (let y = 1; y < this.height - 1; y++) {
            for (let x = 1; x < this.width - 1; x++) {
                if (this.grid[y][x] === 1) {
                    // Check if adjacent to floor
                    let hasFloor = false;
                    if (this.grid[y+1][x] === 0) hasFloor = true;
                    else if (this.grid[y-1][x] === 0) hasFloor = true;
                    else if (this.grid[y][x+1] === 0) hasFloor = true;
                    else if (this.grid[y][x-1] === 0) hasFloor = true;

                    if (hasFloor && Math.random() < 0.05) {
                        this.grid[y][x] = 5; // Wall Torch
                        this.torches.push({ x, y });
                    }
                }
            }
        }
    }

    createRoom(room) {
        for (let y = room.y; y < room.y + room.h; y++) {
            for (let x = room.x; x < room.x + room.w; x++) {
                this.grid[y][x] = 0;
            }
        }
    }

    createCorridor(x1, y1, x2, y2) {
        // Horizontal then Vertical
        const startX = Math.min(x1, x2);
        const endX = Math.max(x1, x2);
        for (let x = startX; x <= endX; x++) this.grid[y1][x] = 0;
        
        const startY = Math.min(y1, y2);
        const endY = Math.max(y1, y2);
        for (let y = startY; y <= endY; y++) this.grid[y][x2] = 0;
    }

    isWalkable(x, y) {
        if (x < 0 || x >= this.width || y < 0 || y >= this.height) return false;
        const t = this.grid[y][x];
        return t === 0 || t === 2 || t === 3 || t === 4 || t === 9;
    }

    getMovementCost(x, y) {
        if (x < 0 || x >= this.width || y < 0 || y >= this.height) return 1.0;
        const t = this.grid[y][x];
        if (t === 2 || t === 3) return 2.0; // Water/Mud slows significantly
        if (t === 4) return 1.5; // Lava slows
        return 1.0;
    }

    hasLineOfSight(x0, y0, x1, y1) {
        // Ensure integers and finite numbers
        x0 = Math.floor(x0); y0 = Math.floor(y0);
        x1 = Math.floor(x1); y1 = Math.floor(y1);
        if (!Number.isFinite(x0) || !Number.isFinite(y0) || !Number.isFinite(x1) || !Number.isFinite(y1)) return false;

        let dx = Math.abs(x1 - x0);
        let dy = Math.abs(y1 - y0);
        let sx = (x0 < x1) ? 1 : -1;
        let sy = (y0 < y1) ? 1 : -1;
        let err = dx - dy;

        let loops = 0;
        while (true) {
            if (loops++ > 100) return false; // Safety break
            if (x0 === x1 && y0 === y1) return true;
            
            // Bounds check
            if (y0 < 0 || y0 >= this.height || x0 < 0 || x0 >= this.width) return false;

            // Check wall (blocking)
            if (this.grid[y0][x0] === 1 || this.grid[y0][x0] === 5) return false;

            let e2 = 2 * err;
            if (e2 > -dy) { err -= dy; x0 += sx; }
            if (e2 < dx) { err += dx; y0 += sy; }
        }
    }

    // Returns true if move successful
    moveEntity(entityId, dx, dy) {
        const pos = this.entities.get(entityId);
        if (!pos) return false;

        // Update facing direction regardless of collision
        if (dx !== 0 || dy !== 0) {
            pos.facing = { x: dx, y: dy };
        }

        const newX = pos.x + dx;
        const newY = pos.y + dy;

        // Diagonal check: Prevent moving through hard corners (two adjacent walls)
        if (dx !== 0 && dy !== 0) {
            if (!this.isWalkable(pos.x + dx, pos.y) && !this.isWalkable(pos.x, pos.y + dy)) {
                return { success: false, collision: 'wall' };
            }
        }

        if (this.isWalkable(newX, newY)) {
            // Check for entity collision (very basic O(N) for now)
            const otherId = this.getEntityAt(newX, newY);
            if (otherId && otherId !== entityId) {
                return { success: false, collision: otherId };
            }
            this.updateSpatialMap(entityId, pos.x, pos.y, newX, newY);
            pos.x = newX;
            pos.y = newY;
            return { success: true, x: newX, y: newY };
        }
        
        return { success: false, collision: 'wall' };
    }

    updateSpatialMap(id, oldX, oldY, newX, newY) {
        this.spatialMap.delete(`${oldX},${oldY}`);
        this.spatialMap.set(`${newX},${newY}`, id);
    }

    getEntityAt(x, y) {
        return this.spatialMap.get(`${x},${y}`) || null;
    }

    addEntity(id, x, y) {
        this.entities.set(id, { x, y, facing: { x: 0, y: 1 } });
        this.spatialMap.set(`${x},${y}`, id);
    }

    removeEntity(id) {
        const pos = this.entities.get(id);
        if (pos) {
            const key = `${pos.x},${pos.y}`;
            if (this.spatialMap.get(key) === id) {
                this.spatialMap.delete(key);
            }
        }
        this.entities.delete(id);
    }

    getValidSpawnLocations() {
        const locations = [];
        for (let y = 0; y < this.height; y++) {
            for (let x = 0; x < this.width; x++) {
                if (this.grid[y][x] === 0) { // Only spawn on clean floor
                    locations.push({ x, y });
                }
            }
        }
        return locations;
    }

    getSpawnPoint() {
        // Find a random floor tile
        let attempts = 0;
        while(attempts < 100) {
            const x = Math.floor(Math.random() * this.width);
            const y = Math.floor(Math.random() * this.height);
            if (this.grid[y][x] === 0 && !this.getEntityAt(x, y)) {
                return { x, y };
            }
            attempts++;
        }
        return { x: 1, y: 1 }; // Fallback
    }

    getChestSpawnLocations() {
        const locs = [];
        if (!this.rooms) return locs;
        
        for (const r of this.rooms) {
            // Add corners (guaranteed to be inside room and usually safe from center-corridors)
            locs.push({ x: r.x, y: r.y });
            locs.push({ x: r.x + r.w - 1, y: r.y });
            locs.push({ x: r.x, y: r.y + r.h - 1 });
            locs.push({ x: r.x + r.w - 1, y: r.y + r.h - 1 });
        }
        return locs;
    }

    setTile(x, y, value) {
        if (x >= 0 && x < this.width && y >= 0 && y < this.height) {
            this.grid[y][x] = value;
        }
    }

    spawnExtractionZone() {
        const pos = this.getSpawnPoint();
        this.setTile(pos.x, pos.y, 9); // 9 = Extraction Zone
        return pos;
    }

    populate(combatSystem, lootSystem, config) {
        let validTiles = this.getValidSpawnLocations();
        // Fisher-Yates shuffle to randomize spawn order
        for (let i = validTiles.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [validTiles[i], validTiles[j]] = [validTiles[j], validTiles[i]];
        }

        // Spawn Enemies
        const enemyTypes = Object.keys(config.enemies || {});
        const enemyCount = 15; 
        
        for (let i = 0; i < enemyCount; i++) {
            if (validTiles.length === 0 || enemyTypes.length === 0) break;
            const pos = validTiles.pop();
            const type = enemyTypes[Math.floor(Math.random() * enemyTypes.length)];
            const id = `enemy_${Date.now()}_${i}`;
            this.addEntity(id, pos.x, pos.y);
            combatSystem.registerEntity(id, type, false);
        }

        // Spawn Loot
        const chestLocs = this.getChestSpawnLocations();
        // Shuffle chest locations
        for (let i = chestLocs.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [chestLocs[i], chestLocs[j]] = [chestLocs[j], chestLocs[i]];
        }

        const lootTable = config.items.loot_table_tier_1 || [];
        const lootCount = 10;
        
        for (let i = 0; i < lootCount; i++) {
            if (chestLocs.length === 0 || lootTable.length === 0) break;
            const pos = chestLocs.pop();
            const entry = lootTable[Math.floor(Math.random() * lootTable.length)];
            lootSystem.spawnLoot(pos.x, pos.y, entry.itemId, 1, 'chest', Math.floor(Math.random() * 11) + 5); // 5-15 gold
        }
    }
}