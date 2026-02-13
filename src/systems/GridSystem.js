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
        this.spawnRooms = []; // Special rooms for player spawns

        const rooms = [];
        this.spatialMap.clear();
        
        // 2. BSP Dungeon Generation
        // We split the map recursively to create a dense layout
        const bspTree = this.splitContainer({ x: 1, y: 1, w: this.width - 2, h: this.height - 2 }, 8); // Depth 8 for high density
        
        // Extract leaves (rooms)
        const leaves = this.getLeaves(bspTree);
        
        leaves.forEach(leaf => {
            // Create a room inside the leaf with some padding
            const padding = 2;
            const roomW = Math.max(4, Math.floor(Math.random() * (leaf.w - padding * 2)) + 4);
            const roomH = Math.max(4, Math.floor(Math.random() * (leaf.h - padding * 2)) + 4);
            
            // Center the room in the leaf roughly
            const roomX = leaf.x + Math.floor((leaf.w - roomW) / 2);
            const roomY = leaf.y + Math.floor((leaf.h - roomH) / 2);

            const newRoom = { 
                x: roomX, 
                y: roomY, 
                w: roomW, 
                h: roomH, 
                cx: roomX + Math.floor(roomW/2), 
                cy: roomY + Math.floor(roomH/2) 
            };

            this.createRoom(newRoom);
            this.rooms.push(newRoom);
            
            // Store reference in leaf for connection
            leaf.room = newRoom;
        });

        // 3. Connect Rooms via BSP Tree
        // Connect sibling nodes
        this.connectBSPNodes(bspTree);

        // 3.5 Identify Spawn Rooms (Outer Edges)
        const centerX = this.width / 2;
        const centerY = this.height / 2;
        
        // Sort rooms by distance from center (Descending)
        const sortedRooms = [...this.rooms].sort((a, b) => {
            const distA = Math.pow(a.cx - centerX, 2) + Math.pow(a.cy - centerY, 2);
            const distB = Math.pow(b.cx - centerX, 2) + Math.pow(b.cy - centerY, 2);
            return distB - distA;
        });

        // Designate the 8 furthest rooms as spawn points
        this.spawnRooms = sortedRooms.slice(0, 8);
        this.spawnRooms.forEach(r => r.isSpawn = true);

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

    splitContainer(container, iter) {
        const root = { ...container, left: null, right: null };
        
        if (iter <= 0 || (container.w < 12 && container.h < 12)) {
            return root;
        }

        // Determine split direction (vertical or horizontal)
        // Bias towards splitting the longer dimension
        let splitH = Math.random() > 0.5;
        if (container.w > container.h && container.w / container.h >= 1.1) splitH = false;
        else if (container.h > container.w && container.h / container.w >= 1.1) splitH = true;

        const max = (splitH ? container.h : container.w) - 8; // Min size 8
        if (max <= 10) return root; // Too small to split

        const splitAt = Math.floor(Math.random() * (max - 10)) + 10;

        if (splitH) {
            root.left = this.splitContainer({ x: container.x, y: container.y, w: container.w, h: splitAt }, iter - 1);
            root.right = this.splitContainer({ x: container.x, y: container.y + splitAt, w: container.w, h: container.h - splitAt }, iter - 1);
        } else {
            root.left = this.splitContainer({ x: container.x, y: container.y, w: splitAt, h: container.h }, iter - 1);
            root.right = this.splitContainer({ x: container.x + splitAt, y: container.y, w: container.w - splitAt, h: container.h }, iter - 1);
        }

        return root;
    }

    getLeaves(node) {
        if (!node.left && !node.right) return [node];
        let leaves = [];
        if (node.left) leaves = leaves.concat(this.getLeaves(node.left));
        if (node.right) leaves = leaves.concat(this.getLeaves(node.right));
        return leaves;
    }

    connectBSPNodes(node) {
        if (node.left && node.right) {
            this.connectBSPNodes(node.left);
            this.connectBSPNodes(node.right);

            // Connect the two children
            // Find a room in the left branch and a room in the right branch
            const leftLeaves = this.getLeaves(node.left);
            const rightLeaves = this.getLeaves(node.right);
            const roomA = leftLeaves[Math.floor(Math.random() * leftLeaves.length)].room;
            const roomB = rightLeaves[Math.floor(Math.random() * rightLeaves.length)].room;

            if (roomA && roomB) {
                this.createCorridor(roomA.cx, roomA.cy, roomB.cx, roomB.cy);
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
        x = Math.round(x);
        y = Math.round(y);
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
                    // Exclude spawn rooms
                    const inSpawnRoom = this.spawnRooms.some(r => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h);
                    if (!inSpawnRoom) {
                        locations.push({ x, y });
                    }
                }
            }
        }
        return locations;
    }

    getSpawnPoint(isPlayer = false) {
        // If player, try to spawn in a safe spawn room
        if (isPlayer && this.spawnRooms.length > 0) {
            // Pick a random spawn room
            const room = this.spawnRooms[Math.floor(Math.random() * this.spawnRooms.length)];
            // Return center of that room
            return { x: room.cx, y: room.cy };
        }

        // Find a random floor tile
        let attempts = 0;
        while(attempts < 100) {
            const x = Math.floor(Math.random() * this.width);
            const y = Math.floor(Math.random() * this.height);
            // Ensure we don't spawn monsters in spawn rooms
            const inSpawnRoom = this.spawnRooms.some(r => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h);
            
            if (this.grid[y][x] === 0 && !this.getEntityAt(x, y) && !inSpawnRoom) {
                return { x, y };
            }
            attempts++;
        }
        
        // Fallback: Scan for first valid floor tile
        for (let y = 1; y < this.height - 1; y++) {
            for (let x = 1; x < this.width - 1; x++) {
                if (this.grid[y][x] === 0 && !this.getEntityAt(x, y)) {
                    return { x, y };
                }
            }
        }
        return { x: 1, y: 1 }; // Ultimate Fallback
    }

    getChestSpawnLocations() {
        const locs = [];
        if (!this.rooms) return locs;
        
        for (const r of this.rooms) {
            if (r.isSpawn) continue; // No chests in spawn rooms
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

        // Spawn Enemies in Rooms
        const enemyTypes = Object.keys(config.enemies || {});
        
        for (const room of this.rooms) {
            if (room.isSpawn) continue; // Safe zone

            // Handful of enemies per room (1-3)
            const count = Math.floor(Math.random() * 3) + 1;
            for (let i = 0; i < count; i++) {
                if (enemyTypes.length === 0) break;
                
                // Random pos in room (padded)
                const ex = Math.floor(Math.random() * (room.w - 2)) + room.x + 1;
                const ey = Math.floor(Math.random() * (room.h - 2)) + room.y + 1;
                
                const type = enemyTypes[Math.floor(Math.random() * enemyTypes.length)];
                const id = `enemy_${Date.now()}_${Math.random()}`;
                this.addEntity(id, ex, ey);
                combatSystem.registerEntity(id, type, false);
            }
        }

        // Spawn Loot
        const chestLocs = this.getChestSpawnLocations();
        // Shuffle chest locations
        for (let i = chestLocs.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [chestLocs[i], chestLocs[j]] = [chestLocs[j], chestLocs[i]];
        }

        const lootCount = 15;
        
        for (let i = 0; i < lootCount; i++) {
            if (chestLocs.length === 0) break;
            const pos = chestLocs.pop();
            const tier = lootSystem.getLootTier(pos.x, pos.y, this.width, this.height);
            lootSystem.spawnRandomLoot(pos.x, pos.y, tier);
        }
    }
}