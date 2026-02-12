const noise = (x, y) => {
    return Math.abs(Math.sin(x * 12.9898 + y * 78.233) * 43758.5453) % 1;
};

export default class RenderSystem {
    constructor(canvasId, width, height, tileSize) {
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas.getContext('2d');
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;
        this.tileSize = tileSize;
        
        // Camera
        this.camera = { x: 0, y: 0 };
        
        // Fog of War
        this.explored = new Set(); // "x,y"
        this.visible = new Set();  // "x,y"

        // Visual Effects
        this.effects = []; // { x, y, type, startTime, duration }
        this.floatingTexts = []; // { x, y, text, color, startTime, duration }
        this.visualEntities = new Map(); // id -> { x, y, attackStart, flashStart }
        this.shake = { intensity: 0, duration: 0, startTime: 0 };
    }

    resize() {
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;
    }

    clear() {
        this.ctx.fillStyle = '#050505';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }

    drawGrid(grid, width, height, playerPos, torches) {
        if (!grid || !grid.length) return;
        if (this.tileSize < 1) this.tileSize = 32; // Safety fallback

        // Hard clamp camera to prevent infinite loops from huge numbers
        if (this.camera.x < -10000) this.camera.x = -10000;
        if (this.camera.x > 10000) this.camera.x = 10000;
        if (this.camera.y < -10000) this.camera.y = -10000;
        if (this.camera.y > 10000) this.camera.y = 10000;

        const startCol = Math.floor(this.camera.x / this.tileSize);
        const endCol = startCol + (this.canvas.width / this.tileSize) + 1;
        const startRow = Math.floor(this.camera.y / this.tileSize);
        const endRow = startRow + (this.canvas.height / this.tileSize) + 1;

        // Safety break for loop bounds
        if (endCol - startCol > 500 || endRow - startRow > 500) return;

        for (let y = startRow; y <= endRow; y++) {
            for (let x = startCol; x <= endCol; x++) {
                if (y >= 0 && y < height && x >= 0 && x < width) {
                    const key = `${x},${y}`;
                    const isVisible = this.visible.has(key);
                    const isExplored = this.explored.has(key);

                    if (!isExplored && !isVisible) {
                        // Draw nothing (black background)
                        continue;
                    }

                    if (!grid[y]) continue; // Safety check for row existence
                    const tile = grid[y][x];
                    const screenX = (x * this.tileSize) - this.camera.x;
                    const screenY = (y * this.tileSize) - this.camera.y;

                    // Lighting Calculation
                    let brightness = 0;
                    if (isVisible && playerPos) {
                        const dist = Math.sqrt((x - playerPos.x) ** 2 + (y - playerPos.y) ** 2);
                        // Non-linear falloff for "torch" look
                        brightness = Math.max(0, 1 - Math.pow(dist / 8.5, 2)); 

                        // Add Torch Light
                        if (torches) {
                            for (const torch of torches) {
                                const tDist = Math.sqrt((x - torch.x) ** 2 + (y - torch.y) ** 2);
                                if (tDist < 6) {
                                    const tBright = Math.max(0, 1 - Math.pow(tDist / 6, 2));
                                    brightness = Math.max(brightness, tBright);
                                }
                            }
                        }
                    } else if (isExplored) {
                        brightness = 0.3; // Increased visibility for explored areas (shrouded)
                    }

                    // Base Colors (Grim Palette)
                    const n = noise(x, y);
                    
                    // Draw Tile
                    if (tile === 1) {
                        // Wall
                        const wallHeight = this.tileSize * 0.4;
                        
                        // Top Face
                        const topColor = Math.floor(15 + n * 10); // Darker walls
                        this.ctx.fillStyle = `rgb(${topColor}, ${topColor}, ${topColor})`;
                        this.ctx.fillRect(screenX, screenY, this.tileSize, this.tileSize - wallHeight);
                        
                        // Front Face
                        const frontColor = Math.floor(5 + n * 5); // Very dark front face
                        this.ctx.fillStyle = `rgb(${frontColor}, ${frontColor}, ${frontColor})`;
                        this.ctx.fillRect(screenX, screenY + (this.tileSize - wallHeight), this.tileSize, wallHeight);
                        
                        // Detail (Cracks)
                        if (n > 0.8) {
                            this.ctx.fillStyle = '#000';
                            this.ctx.fillRect(screenX + n * 20, screenY + 5, 2, 6);
                        }
                    } else if (tile === 5) {
                        // Wall Torch
                        const wallHeight = this.tileSize * 0.4;
                        const topColor = Math.floor(15 + n * 10);
                        this.ctx.fillStyle = `rgb(${topColor}, ${topColor}, ${topColor})`;
                        this.ctx.fillRect(screenX, screenY, this.tileSize, this.tileSize - wallHeight);
                        
                        const frontColor = Math.floor(5 + n * 5);
                        this.ctx.fillStyle = `rgb(${frontColor}, ${frontColor}, ${frontColor})`;
                        this.ctx.fillRect(screenX, screenY + (this.tileSize - wallHeight), this.tileSize, wallHeight);

                        // Torch Wood
                        this.ctx.fillStyle = '#8B4513';
                        this.ctx.fillRect(screenX + 12, screenY + 10, 8, 10);
                        
                        // Flame
                        const flicker = Math.random() * 4;
                        this.ctx.fillStyle = `rgba(255, ${100 + flicker * 20}, 0, 0.8)`;
                        this.ctx.beginPath();
                        this.ctx.arc(screenX + 16, screenY + 8, 4 + flicker/2, 0, Math.PI*2);
                        this.ctx.fill();
                    } else if (tile === 2) {
                        // Water
                        const offset = Math.sin(Date.now() / 500 + x) * 5;
                        this.ctx.fillStyle = `rgb(20, 40, ${100 + offset})`;
                        this.ctx.fillRect(screenX, screenY, this.tileSize, this.tileSize);
                        this.ctx.fillStyle = 'rgba(255,255,255,0.1)';
                        this.ctx.fillRect(screenX + 5, screenY + 5 + offset, 10, 2);
                    } else if (tile === 3) {
                        // Mud
                        this.ctx.fillStyle = '#3e2723';
                        this.ctx.fillRect(screenX, screenY, this.tileSize, this.tileSize);
                        if (n > 0.5) {
                            this.ctx.fillStyle = '#281a15';
                            this.ctx.fillRect(screenX + 5, screenY + 5, 5, 5);
                        }
                    } else if (tile === 4) {
                        // Lava
                        const pulse = Math.sin(Date.now() / 300);
                        this.ctx.fillStyle = `rgb(${200 + pulse * 50}, 50, 0)`;
                        this.ctx.fillRect(screenX, screenY, this.tileSize, this.tileSize);
                        this.ctx.fillStyle = '#ffeb3b';
                        if (n > 0.7) this.ctx.fillRect(screenX + n*20, screenY + n*20, 4, 4);
                    } else if (tile === 9) {
                        // Extraction Zone - Pulsing
                        const pulse = (Math.sin(Date.now() / 200) + 1) / 2;
                        this.ctx.fillStyle = `rgba(0, 255, 255, ${0.1 + pulse * 0.2})`;
                        this.ctx.fillRect(screenX, screenY, this.tileSize, this.tileSize);
                        
                        this.ctx.strokeStyle = `rgba(0, 255, 255, ${0.5 + pulse * 0.5})`;
                        this.ctx.lineWidth = 2;
                        this.ctx.strokeRect(screenX + 4, screenY + 4, this.tileSize - 8, this.tileSize - 8);
                    } else {
                        // Floor - Textured
                        const floorBase = Math.floor(40 + n * 10); // Lighter floor for contrast
                        this.ctx.fillStyle = `rgb(${floorBase}, ${floorBase}, ${floorBase + 5})`; // Slight blue tint
                        this.ctx.fillRect(screenX, screenY, this.tileSize, this.tileSize);
                        
                        // Grit
                        if (n > 0.5) {
                            this.ctx.fillStyle = 'rgba(0,0,0,0.2)';
                            this.ctx.fillRect(screenX + (n * 100) % this.tileSize, screenY + (n * 50) % this.tileSize, 1, 1);
                        }
                    }

                    // Apply Lighting Overlay
                    if (brightness < 1.0) {
                        this.ctx.fillStyle = `rgba(0, 0, 0, ${1 - brightness})`;
                        this.ctx.fillRect(screenX, screenY, this.tileSize, this.tileSize);
                    }
                }
            }
        }
    }

    triggerShake(intensity, duration) {
        this.shake.intensity = intensity;
        this.shake.duration = duration;
        this.shake.startTime = Date.now();
    }

    triggerHitFlash(id) {
        const visual = this.visualEntities.get(id);
        if (visual) visual.flashStart = Date.now();
    }

    triggerAttack(id) {
        const visual = this.visualEntities.get(id);
        if (visual) {
            visual.attackStart = Date.now();
        }
    }

    drawEntities(entities, localPlayerId) {
        const now = Date.now();
        
        // Prune visuals that no longer exist
        for (const id of this.visualEntities.keys()) {
            if (!entities.has(id)) {
                this.visualEntities.delete(id);
            }
        }

        entities.forEach((pos, id) => {
            // Update Visual State
            let visual = this.visualEntities.get(id);
            if (!visual) {
                visual = { x: pos.x, y: pos.y, attackStart: 0, flashStart: 0 };
                this.visualEntities.set(id, visual);
            }

            // Smooth Movement (Exponential Slide)
            // Lerp factor 0.15 gives a nice snappy but smooth feel at 60fps
            visual.x += (pos.x - visual.x) * 0.15;
            visual.y += (pos.y - visual.y) * 0.15;

            // Don't draw entities in FOW (unless it's me)
            // Use logical position for FOW check to prevent popping
            const key = `${Math.round(pos.x)},${Math.round(pos.y)}`;
            if (id !== localPlayerId && !this.visible.has(key)) return;
            
            // Stealth Check
            if (pos.invisible) {
                if (id !== localPlayerId) return; // Completely invisible to others
                this.ctx.globalAlpha = 0.5; // Ghostly for self
            } else {
                this.ctx.globalAlpha = 1.0;
            }

            // Calculate Attack Shove Offset
            let offsetX = 0;
            let offsetY = 0;
            if (now - visual.attackStart < 150) { // 150ms animation
                const progress = (now - visual.attackStart) / 150;
                const shove = Math.sin(progress * Math.PI) * 8; // 8 pixels forward
                if (pos.facing) {
                    offsetX = pos.facing.x * shove;
                    offsetY = pos.facing.y * shove;
                }
            }

            const screenX = (visual.x * this.tileSize) - this.camera.x + offsetX;
            const screenY = (visual.y * this.tileSize) - this.camera.y + offsetY;

            // Health Bar
            if (pos.hp !== undefined && pos.maxHp !== undefined && pos.hp < pos.maxHp) {
                const barWidth = 24;
                const barHeight = 4;
                const hpRatio = Math.max(0, pos.hp / pos.maxHp);
                
                this.ctx.fillStyle = '#333';
                this.ctx.fillRect(screenX + 4, screenY - 8, barWidth, barHeight);
                
                this.ctx.fillStyle = hpRatio > 0.5 ? '#4d4' : '#d44';
                this.ctx.fillRect(screenX + 4, screenY - 8, barWidth * hpRatio, barHeight);
            }

            // Shadow
            this.ctx.fillStyle = 'rgba(0,0,0,0.6)';
            this.ctx.beginPath();
            this.ctx.ellipse(screenX + 16, screenY + 28, 10, 4, 0, 0, Math.PI * 2);
            this.ctx.fill();

            // Body
            const isMe = (id === localPlayerId);
            const isFlashing = (now - visual.flashStart < 100); // 100ms flash

            if (isFlashing) {
                this.ctx.fillStyle = '#FFFFFF';
            } else {
                const baseColor = isMe ? '#4a6' : '#a44';
                
                // Gradient Body
                const grad = this.ctx.createRadialGradient(screenX + 16, screenY + 16, 2, screenX + 16, screenY + 16, 12);
                grad.addColorStop(0, isMe ? '#6c8' : '#c66');
                grad.addColorStop(1, baseColor);
                
                this.ctx.fillStyle = grad;
            }

            this.ctx.beginPath();
            this.ctx.arc(screenX + 16, screenY + 16, 10, 0, Math.PI * 2);
            this.ctx.fill();

            // Draw facing indicator
            if (pos.facing) {
                const indicatorX = screenX + 16 + (pos.facing.x * 12);
                const indicatorY = screenY + 16 + (pos.facing.y * 12);
                this.ctx.fillStyle = 'rgba(255,255,255,0.8)';
                this.ctx.fillRect(indicatorX - 2, indicatorY - 2, 4, 4);
            }
            
            this.ctx.globalAlpha = 1.0; // Reset
        });
    }

    updateCamera(targetX, targetY) {
        // Smooth Camera Follow
        const targetCamX = (targetX * this.tileSize) - (this.canvas.width / 2);
        const targetCamY = (targetY * this.tileSize) - (this.canvas.height / 2);
        
        if (!Number.isFinite(targetCamX) || !Number.isFinite(targetCamY)) return;

        this.camera.x += (targetCamX - this.camera.x) * 0.1;
        this.camera.y += (targetCamY - this.camera.y) * 0.1;
    }

    drawLoot(lootMap) {
        lootMap.forEach((loot) => {
            // Don't draw loot in FOW
            if (!this.visible.has(`${loot.x},${loot.y}`)) return;

            const screenX = (loot.x * this.tileSize) - this.camera.x;
            const screenY = (loot.y * this.tileSize) - this.camera.y;
            
            if (loot.type === 'bag') {
                // Draw Bag (Sack)
                const grad = this.ctx.createRadialGradient(screenX + 16, screenY + 20, 2, screenX + 16, screenY + 20, 10);
                grad.addColorStop(0, '#D2C290');
                grad.addColorStop(1, '#8B7355');
                
                this.ctx.fillStyle = grad;
                this.ctx.beginPath();
                this.ctx.arc(screenX + 16, screenY + 20, 10, 0, Math.PI * 2);
                this.ctx.fill();
                
                this.ctx.fillStyle = '#5C4033'; // Tie
                this.ctx.fillRect(screenX + 14, screenY + 8, 4, 6);
                return;
            }

            if (loot.opened) {
                // Draw Opened Chest (Empty)
                this.ctx.fillStyle = '#3e2723'; // Darker Brown
                this.ctx.fillRect(screenX + 4, screenY + 8, this.tileSize - 8, this.tileSize - 12);
                this.ctx.fillStyle = '#1a1a1a'; // Empty inside
                this.ctx.fillRect(screenX + 6, screenY + 10, this.tileSize - 12, this.tileSize - 16);
            } else {
                // Draw Closed Chest
                // Box Gradient
                const grad = this.ctx.createLinearGradient(screenX, screenY + 8, screenX, screenY + 28);
                grad.addColorStop(0, '#8d6e63');
                grad.addColorStop(1, '#4e342e');
                this.ctx.fillStyle = grad;
                this.ctx.fillRect(screenX + 4, screenY + 8, this.tileSize - 8, this.tileSize - 12);
                
                // Lid
                this.ctx.fillStyle = '#6d4c41';
                this.ctx.fillRect(screenX + 2, screenY + 6, this.tileSize - 4, 6);
                
                // Gold Lock
                this.ctx.fillStyle = '#ffb300';
                this.ctx.fillRect(screenX + (this.tileSize / 2) - 2, screenY + 9, 4, 4);
                this.ctx.strokeStyle = '#3e2723';
                this.ctx.strokeRect(screenX + 4, screenY + 8, this.tileSize - 8, this.tileSize - 12);
            }
        });
    }

    addEffect(x, y, type) {
        this.effects.push({
            x, y, type,
            startTime: Date.now(),
            duration: 200 // ms
        });
    }

    drawEffects() {
        const now = Date.now();
        this.effects = this.effects.filter(e => now - e.startTime < e.duration);

        this.effects.forEach(e => {
            const screenX = (e.x * this.tileSize) - this.camera.x;
            const screenY = (e.y * this.tileSize) - this.camera.y;

            if (e.type === 'slash') {
                this.ctx.strokeStyle = '#FFF';
                this.ctx.lineWidth = 3;
                this.ctx.beginPath();
                this.ctx.moveTo(screenX, screenY);
                this.ctx.lineTo(screenX + this.tileSize, screenY + this.tileSize);
                this.ctx.stroke();
            }

            if (e.type === 'dust') {
                const progress = (now - e.startTime) / e.duration;
                const radius = 5 * (1 - progress);
                this.ctx.fillStyle = `rgba(200, 200, 200, ${0.5 * (1 - progress)})`;
                this.ctx.beginPath();
                this.ctx.arc(screenX + 16, screenY + 28, radius, 0, Math.PI * 2);
                this.ctx.fill();
            }
        });
    }

    addFloatingText(x, y, text, color) {
        this.floatingTexts.push({
            x, y, text, color,
            startTime: Date.now(),
            duration: 1000
        });
    }

    drawFloatingTexts() {
        const now = Date.now();
        this.floatingTexts = this.floatingTexts.filter(t => now - t.startTime < t.duration);

        this.ctx.font = 'bold 14px "Courier New"';
        this.ctx.textAlign = 'center';
        this.ctx.shadowColor = 'black';
        this.ctx.shadowBlur = 2;

        this.floatingTexts.forEach(t => {
            const elapsed = now - t.startTime;
            const progress = elapsed / t.duration;
            const screenX = (t.x * this.tileSize) - this.camera.x + (this.tileSize / 2);
            const screenY = (t.y * this.tileSize) - this.camera.y - (progress * 20); // Float up

            this.ctx.fillStyle = t.color;
            this.ctx.globalAlpha = 1 - Math.pow(progress, 3); // Fade out
            this.ctx.fillText(t.text, screenX, screenY);
            this.ctx.globalAlpha = 1.0;
        });
        this.ctx.shadowBlur = 0;
    }

    drawProjectiles(projectiles) {
        projectiles.forEach(p => {
            const screenX = (p.x * this.tileSize) - this.camera.x;
            const screenY = (p.y * this.tileSize) - this.camera.y;
            
            // Draw Arrow
            this.ctx.save();
            this.ctx.translate(screenX + this.tileSize/2, screenY + this.tileSize/2);
            this.ctx.rotate(Math.atan2(p.vy, p.vx));
            
            this.ctx.fillStyle = '#fff';
            this.ctx.fillRect(-8, -1, 16, 2); // Shaft
            this.ctx.fillStyle = '#888';
            this.ctx.fillRect(6, -2, 2, 4); // Tip
            this.ctx.fillStyle = '#d44';
            this.ctx.fillRect(-8, -2, 4, 4); // Fletching
            
            this.ctx.restore();
        });
    }

    drawInteractionBar(interaction, playerPos) {
        if (!interaction || !playerPos) return;
        
        const screenX = (playerPos.x * this.tileSize) - this.camera.x;
        const screenY = (playerPos.y * this.tileSize) - this.camera.y;
        const progress = Math.min(1, (Date.now() - interaction.startTime) / interaction.duration);

        this.ctx.fillStyle = '#000';
        this.ctx.fillRect(screenX, screenY - 10, this.tileSize, 6);
        this.ctx.fillStyle = '#FFD700';
        this.ctx.fillRect(screenX + 1, screenY - 9, (this.tileSize - 2) * progress, 4);
    }

    updateFog(playerPos, grid) {
        this.visible.clear();
        if (!playerPos) return;
        
        // Safety check for infinite coordinates
        if (!Number.isFinite(playerPos.x) || !Number.isFinite(playerPos.y)) return;

        const px = Math.round(playerPos.x);
        const py = Math.round(playerPos.y);
        const radius = 8;
        const r2 = radius * radius;

        // Iterate bounding box of radius
        for (let y = py - radius; y <= py + radius; y++) {
            for (let x = px - radius; x <= px + radius; x++) {
                // Check bounds
                if (y < 0 || y >= grid.length || x < 0 || x >= grid[0].length) continue;

                const dx = x - px;
                const dy = y - py;
                
                // Circle mask
                if (dx*dx + dy*dy <= r2) {
                    // Raycast for shadows
                    if (this.checkLineOfSight(grid, px, py, x, y)) {
                        const key = `${x},${y}`;
                        this.visible.add(key);
                        this.explored.add(key);
                    }
                }
            }
        }
    }

    checkLineOfSight(grid, x0, y0, x1, y1) {
        x0 = Math.round(x0); y0 = Math.round(y0);
        x1 = Math.round(x1); y1 = Math.round(y1);

        let dx = Math.abs(x1 - x0);
        let dy = Math.abs(y1 - y0);
        let sx = (x0 < x1) ? 1 : -1;
        let sy = (y0 < y1) ? 1 : -1;
        let err = dx - dy;

        let loops = 0;
        while (true) {
            if (loops++ > 100) return false; // Safety break
            if (x0 === x1 && y0 === y1) return true; // Reached target
            
            // Bounds check
            if (y0 < 0 || y0 >= grid.length || x0 < 0 || x0 >= grid[0].length) return false;
            
            if (grid[y0][x0] === 1) return false; // Blocked by wall

            let e2 = 2 * err;
            if (e2 > -dy) { err -= dy; x0 += sx; }
            if (e2 < dx) { err += dx; y0 += sy; }
        }
    }

    render(grid, entities, loot, projectiles, interaction, localPlayerId) {
        const myPos = entities.get(localPlayerId);
        this.updateFog(myPos, grid);

        this.clear();

        // Apply Screen Shake
        this.ctx.save();
        if (Date.now() - this.shake.startTime < this.shake.duration) {
            const dx = (Math.random() - 0.5) * this.shake.intensity;
            const dy = (Math.random() - 0.5) * this.shake.intensity;
            this.ctx.translate(dx, dy);
        }

        this.drawGrid(grid, grid[0].length, grid.length, myPos, grid.torches);
        this.drawLoot(loot);
        this.drawProjectiles(projectiles);
        this.drawEntities(entities, localPlayerId);
        this.drawEffects();
        this.drawFloatingTexts();
        this.drawInteractionBar(interaction, myPos);
        
        this.ctx.restore();
    }
}