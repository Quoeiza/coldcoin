export default class GameLoop {
    constructor(updateFn, renderFn, tickRate = 20) {
        this.updateFn = updateFn;
        this.renderFn = renderFn;
        this.tickRate = tickRate;
        this.timePerTick = 1000 / tickRate;
        if (!Number.isFinite(this.timePerTick) || this.timePerTick < 1) this.timePerTick = 50; // Safety fallback
        this.lastTime = 0;
        this.accumulator = 0;
        this.isRunning = false;
        this.animationFrameId = null;
    }

    start() {
        if (this.isRunning) return;
        this.isRunning = true;
        this.lastTime = performance.now();
        this.loop(this.lastTime);
    }

    stop() {
        this.isRunning = false;
        cancelAnimationFrame(this.animationFrameId);
    }

    loop(timestamp) {
        if (!this.isRunning) return;

        let deltaTime = timestamp - this.lastTime;
        // Cap deltaTime to prevent spiral of death if tab is backgrounded
        if (deltaTime > 1000) deltaTime = 1000;
        
        this.lastTime = timestamp;
        this.accumulator += deltaTime;

        let updates = 0;
        try {
            while (this.accumulator >= this.timePerTick) {
                this.updateFn(this.timePerTick); // Fixed update
                this.accumulator -= this.timePerTick;
                if (++updates > 10) { this.accumulator = 0; break; } // Safety break: prevent spiral of death
            }

            this.renderFn(this.accumulator / this.timePerTick); // Interpolation alpha
        } catch (e) {
            console.error("GameLoop Crash Recovered:", e);
        }

        this.animationFrameId = requestAnimationFrame((t) => this.loop(t));
    }
}