export default class AudioSystem {
    constructor() {
        const AudioCtor = window.AudioContext || window.webkitAudioContext;
        if (AudioCtor) {
            this.ctx = new AudioCtor();
            this.enabled = true;
        } else {
            console.warn("AudioContext not supported");
            this.enabled = false;
        }
    }

    resume() {
        if (this.enabled && this.ctx.state === 'suspended') {
            this.ctx.resume();
        }
    }

    playTone(freq, type, duration, vol = 0.1) {
        if (!this.enabled) return;
        try {
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = type;
            osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
            gain.gain.setValueAtTime(vol, this.ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + duration);
            osc.connect(gain);
            gain.connect(this.ctx.destination);
            osc.start();
            osc.stop(this.ctx.currentTime + duration);
        } catch (e) {
            console.error("Audio Error", e);
        }
    }

    play(effect) {
        // Resume context if suspended (browser autoplay policy)
        if (this.enabled && this.ctx.state === 'suspended') {
            this.ctx.resume();
        }

        // Randomize pitch slightly (±10%) to reduce auditory fatigue
        const variance = 0.9 + Math.random() * 0.2;

        switch(effect) {
            case 'attack':
                this.playTone(150 * variance, 'sawtooth', 0.1, 0.05);
                break;
            case 'hit':
                this.playTone(100 * variance, 'square', 0.1, 0.05);
                break;
            case 'step':
                this.playTone(50 * variance, 'sine', 0.05, 0.02);
                break;
            case 'pickup':
                this.playTone(600 * variance, 'sine', 0.1, 0.05);
                break;
            case 'death':
                this.playTone(50 * variance, 'sawtooth', 0.5, 0.1);
                break;
            case 'bump':
                this.playTone(80 * variance, 'triangle', 0.05, 0.1);
                break;
        }
    }
}