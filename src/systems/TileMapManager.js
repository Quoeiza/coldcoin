/**
 * @file TileMapManager.js
 * Manages rendering using 2.5D Depth Logic.
 * Handles Wall Faces, Wall Bases, and Roof/Void Overlays.
 */

export const dungeonTilesetConfig = {
    name: 'Dungeon',
    tileSize: 48,
    sheetWidth: 33, 
    assets: {
        floor: './assets/images/dungeon/A2_Terrain_Misc.png',
        wall: './assets/images/dungeon/A4_Walls_And_Edges.png',
    },
    themes: {
        'rocky': 0,
        'dark': 17,
        'mossy': 165,
        'volcanic': 1832
    },
    tiles: {
        floor: { sx: 0, sy: 0 }, 
    }
};

// --- TILED DATA ---
// VOID: Roofs/Ceilings (Black with Stone Rims)
const VOID_DATA = [
    { id: 4, w: [0, 0, 0, 0, 1, 0, 0, 0] },
    { id: 5, w: [0, 0, 1, 0, 1, 0, 0, 0] },
    { id: 6, w: [0, 0, 1, 0, 1, 0, 1, 0] },
    { id: 7, w: [0, 0, 0, 0, 1, 0, 1, 0] },
    { id: 8, w: [1, 0, 1, 0, 1, 0, 1, 1] },
    { id: 9, w: [0, 0, 1, 1, 1, 0, 1, 0] },
    { id: 10, w: [0, 0, 1, 0, 1, 1, 1, 0] },
    { id: 11, w: [1, 1, 1, 0, 1, 0, 1, 0] },
    { id: 12, w: [0, 0, 1, 1, 1, 0, 0, 0] },
    { id: 13, w: [1, 0, 1, 1, 1, 1, 1, 0] },
    { id: 14, w: [0, 0, 1, 1, 1, 1, 1, 0] },
    { id: 15, w: [0, 0, 0, 0, 1, 1, 1, 0] },
    { id: 37, w: [1, 0, 0, 0, 1, 0, 0, 0] },
    { id: 38, w: [1, 0, 1, 0, 1, 0, 0, 0] },
    { id: 39, w: [1, 0, 1, 0, 1, 0, 1, 0] },
    { id: 40, w: [1, 0, 0, 0, 1, 0, 1, 0] },
    { id: 41, w: [1, 0, 1, 1, 1, 0, 0, 0] },
    { id: 42, w: [1, 1, 1, 1, 1, 1, 1, 0] },
    { id: 43, w: [1, 0, 1, 1, 1, 1, 1, 1] },
    { id: 44, w: [1, 0, 0, 0, 1, 1, 1, 0] },
    { id: 45, w: [1, 1, 1, 1, 1, 0, 0, 0] },
    { id: 46, w: [1, 1, 1, 0, 1, 1, 1, 0] },
    { id: 48, w: [1, 0, 1, 0, 1, 1, 1, 1] },
    { id: 70, w: [1, 0, 0, 0, 0, 0, 0, 0] },
    { id: 71, w: [1, 0, 1, 0, 0, 0, 0, 0] },
    { id: 72, w: [1, 0, 1, 0, 0, 0, 1, 0] },
    { id: 73, w: [1, 0, 0, 0, 0, 0, 1, 0] },
    { id: 74, w: [1, 1, 1, 0, 1, 0, 0, 0] },
    { id: 75, w: [1, 1, 1, 1, 1, 0, 1, 1] },
    { id: 76, w: [1, 1, 1, 0, 1, 1, 1, 1] },
    { id: 77, w: [1, 0, 0, 0, 1, 0, 1, 1] },
    { id: 78, w: [1, 1, 1, 1, 1, 0, 1, 0] },
    { id: 79, w: [1, 1, 1, 1, 1, 1, 1, 1] },
    { id: 80, w: [1, 0, 1, 1, 1, 0, 1, 1] },
    { id: 81, w: [1, 0, 0, 0, 1, 1, 1, 1] },
    { id: 104, w: [0, 0, 1, 0, 0, 0, 0, 0] },
    { id: 105, w: [0, 0, 1, 0, 0, 0, 1, 0] },
    { id: 106, w: [0, 0, 0, 0, 0, 0, 1, 0] },
    { id: 107, w: [1, 0, 1, 0, 1, 1, 1, 0] },
    { id: 108, w: [1, 1, 1, 0, 0, 0, 1, 0] },
    { id: 109, w: [1, 0, 1, 0, 0, 0, 1, 1] },
    { id: 110, w: [1, 0, 1, 1, 1, 0, 1, 0] },
    { id: 111, w: [1, 1, 1, 0, 0, 0, 0, 0] },
    { id: 112, w: [1, 1, 1, 0, 0, 0, 1, 1] },
    { id: 113, w: [1, 1, 1, 0, 1, 0, 1, 1] },
    { id: 114, w: [1, 0, 0, 0, 0, 0, 1, 1] }
];

// WALL: Vertical Stone Faces / Pillars
const WALL_DATA = [
    { id: 0, w: [0, 0, 1, 1, 1, 0, 0, 0] },
    { id: 1, w: [0, 0, 1, 1, 1, 1, 1, 0] },
    { id: 2, w: [0, 0, 0, 0, 1, 1, 1, 0] },
    { id: 33, w: [1, 1, 1, 1, 1, 0, 0, 0] },
    { id: 34, w: [1, 1, 1, 1, 1, 1, 1, 1] },
    { id: 35, w: [1, 0, 0, 0, 1, 1, 1, 1] },
    { id: 66, w: [1, 1, 1, 0, 0, 0, 0, 0] },
    { id: 67, w: [1, 1, 1, 0, 0, 0, 1, 1] },
    { id: 68, w: [1, 0, 0, 0, 0, 0, 1, 1] }
];

export class TileMapManager {
    constructor(config = dungeonTilesetConfig) {
        this.config = config;
        this.tileSize = config.tileSize;
        this.assets = {}; 
        this.currentTheme = 'rocky';
        
        this.voidMap = this.buildLookup(VOID_DATA);
        this.wallMap = this.buildLookup(WALL_DATA);
    }

    buildLookup(data) {
        const map = new Map();
        data.forEach(item => {
            const key = item.w.join(',');
            map.set(key, item.id);
        });
        return map;
    }

    async loadAssets(assetLoader) {
        const imageMap = {
            [this.config.name + '_floor']: this.config.assets.floor,
            [this.config.name + '_wall']: this.config.assets.wall,
        };
        await assetLoader.loadImages(imageMap);
        this.assets.floor = assetLoader.getImage(this.config.name + '_floor');
        this.assets.wall = assetLoader.getImage(this.config.name + '_wall');
    }

    // Helper: 1 = Wall/Torch, 0 = Floor
    getTileVal(map, x, y) {
        if (y < 0 || y >= map.length || x < 0 || x >= map[0].length) return 1;
        const v = map[y][x];
        return (v === 1 || v === 5) ? 1 : 0;
    }

    // LOGIC: Is this a vertical face visible to the player?
    // It's a face if:
    // 1. It is a WALL
    // 2. AND (The tile below is Floor OR The tile 2-below is Floor)
    // This supports walls that are 1 or 2 tiles high.
    isFrontFace(map, x, y) {
        if (this.getTileVal(map, x, y) !== 1) return false;
        const s = this.getTileVal(map, x, y + 1);
        const ss = this.getTileVal(map, x, y + 2);
        return (s === 0) || (s === 1 && ss === 0);
    }

    // LOGIC: Should we draw a Void/Roof tile here?
    // We draw Void if:
    // 1. It is a "Deep Wall" (Wall behind the face)
    // 2. OR It is a Floor tile directly above a Front Face (Roof Overlay)
    shouldDrawVoid(map, x, y) {
        const val = this.getTileVal(map, x, y);
        
        // Case 1: Deep Wall
        if (val === 1 && !this.isFrontFace(map, x, y)) return true;

        // Case 2: Roof Overlay (The empty tile above a wall needs a rim)
        if (val === 0 && this.isFrontFace(map, x, y + 1)) return true;

        return false;
    }

    /**
     * Calculates neighbors based on the context.
     * @param mode 'VOID' or 'FACE'
     */
    getWangID(map, x, y, mode) {
        const check = (dx, dy) => {
            const nx = x + dx;
            const ny = y + dy;
            
            if (mode === 'VOID') {
                // Voids connect to other Voids. 
                // Everything else (Face or Floor) is a boundary (0).
                return this.shouldDrawVoid(map, nx, ny) ? 1 : 0;
            } else {
                // Faces connect to any solid Wall.
                // This keeps the pillar structure solid.
                return this.getTileVal(map, nx, ny) === 1 ? 1 : 0;
            }
        };

        return [
            check(0, -1),  // N
            check(1, -1),  // NE
            check(1, 0),   // E
            check(1, 1),   // SE
            check(0, 1),   // S
            check(-1, 1),  // SW
            check(-1, 0),  // W
            check(-1, -1)  // NW
        ];
    }

    draw(ctx, map, viewBounds) {
        if (!this.assets.floor || !this.assets.wall) return;
        const ts = this.tileSize;
        const sheetW = this.config.sheetWidth;
        const themeOffset = this.config.themes[this.currentTheme] || 0;

        const { startCol, endCol, startRow, endRow } = viewBounds;

        // --- LAYER 1: FLOOR (Pass 1) ---
        // We always draw the floor first.
        for (let y = startRow; y <= endRow; y++) {
            for (let x = startCol; x <= endCol; x++) {
                if (y < 0 || y >= map.length || x < 0 || x >= map[0].length) continue;
                ctx.drawImage(this.assets.floor, 0, 0, ts, ts, x * ts, y * ts, ts, ts);
            }
        }
        
        // --- LAYER 2: WALLS & OVERLAYS (Pass 2) ---
        // We iterate ALL tiles to handle walls and roof overlays.
        for (let y = startRow; y <= endRow; y++) {
            for (let x = startCol; x <= endCol; x++) {
                if (y < 0 || y >= map.length || x < 0 || x >= map[0].length) continue;

                let tileID = -1;

                if (this.isFrontFace(map, x, y)) {
                    // --- DRAW FRONT FACE ---
                    // This is the vertical stone wall.
                    const wangID = this.getWangID(map, x, y, 'FACE');
                    const key = wangID.join(',');
                    
                    if (this.wallMap.has(key)) {
                        tileID = this.wallMap.get(key);
                    } else {
                        // Default to Center Wall if unknown connection
                        tileID = 34; 
                    }
                } 
                else if (this.shouldDrawVoid(map, x, y)) {
                    // --- DRAW VOID / ROOF ---
                    // This is the black ceiling or the edge rim.
                    const wangID = this.getWangID(map, x, y, 'VOID');
                    const key = wangID.join(',');

                    if (this.voidMap.has(key)) {
                        tileID = this.voidMap.get(key);
                    } else {
                        // Default to Pure Void (Black)
                        tileID = 79; 
                    }
                }

                // Render the calculated tile
                if (tileID !== -1) {
                    const finalID = tileID + themeOffset;
                    const sheetX = (finalID % sheetW) * ts;
                    const sheetY = Math.floor(finalID / sheetW) * ts;

                    ctx.drawImage(this.assets.wall, sheetX, sheetY, ts, ts, x * ts, y * ts, ts, ts);
                }
            }
        }
    }
}