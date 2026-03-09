(function () {
  function createGameBoyCore(canvas, hooks) {
    hooks = hooks || {};

    if (typeof window.createExternalGameBoyCore === 'function') {
      return window.createExternalGameBoyCore(canvas, hooks);
    }

    var wasmBoyApi = resolveWasmBoyApi();
    if (wasmBoyApi) {
      return new WasmBoyCore(canvas, hooks, wasmBoyApi);
    }

    return new DemoGameBoyCore(canvas, hooks);
  }

  // ---------------------------------------------------------------------------
  // WasmBoy core — uses only official WasmBoy API.
  // SRAM persistence is handled automatically by WasmBoy via IndexedDB:
  //   • WasmBoy loads SRAM from IndexedDB when play() is called.
  //   • WasmBoy writes SRAM to IndexedDB whenever the cartridge saves.
  // Save states are also stored in IndexedDB via saveState() / getSaveStates().
  // ---------------------------------------------------------------------------

  class WasmBoyCore {
    constructor(canvas, hooks, api) {
      this.canvas = canvas;
      this.hooks = hooks;
      this.api = api;
      this.initialized = false;
      this.initializing = null;
      this.failed = false;
      this.romLoaded = false;
      this.running = false;
      this.speedMultiplier = 1;
      this.buttonState = {
        UP: false, DOWN: false, LEFT: false, RIGHT: false,
        A: false, B: false, SELECT: false, START: false
      };
      this.joypadTransientErrorShown = false;
    }

    async ensureInitialized() {
      if (this.failed) throw new Error('WASM core is not available in this session.');
      if (this.initialized) return;
      if (this.initializing) { await this.initializing; return; }

      this.initializing = this.initializeInternal();
      try {
        await this.initializing;
      } finally {
        this.initializing = null;
      }
    }

    async initializeInternal() {
      try {
        await withRetry(function () {
          return this.api.config(
            {
              disablePauseOnHidden: true,
              enableBootROMIfAvailable: false,
              frameSkip: 0,
              gameboyFrameRate: 60,
              isAudioEnabled: true,
              audioBatchProcessing: false,
              audioAccumulateSamples: false,
              graphicsBatchProcessing: true,
              isGbcEnabled: true,
              isGbcColorizationEnabled: true,
              onPause: this.onPause.bind(this),
              onPlay: this.onPlay.bind(this),
              onReady: this.onReady.bind(this)
            },
            this.canvas
          );
        }.bind(this), 3, 600);
        this.initialized = true;
        this.api.setSpeed(this.speedMultiplier);
      } catch (error) {
        this.failed = true;
        this.emitStatus('WASM init failed: ' + getErrorMessage(error));
        throw error;
      }
    }

    async loadROM(data) {
      this.emitStatus('Initializing emulator...');
      await this.ensureInitialized();

      var bytes = await normalizeRomBytes(data);
      this.emitStatus('Loading ROM...');

      try {
        await withRetry(function () {
          return this.api.loadROM(bytes);
        }.bind(this), 3, 600);
      } catch (error) {
        throw new Error(
          'Unable to load ROM: ' + getErrorMessage(error) +
          '. Ensure the file is a valid uncompressed .gb or .gbc ROM.'
        );
      }

      this.romLoaded = true;
      this.emitStatus('ROM loaded. Press Start.');
      this.flushJoypadState();
    }

    // Attempts to load the most recent save state stored in IndexedDB for the
    // current ROM.  Silently skips if none exist or the API is unavailable.
    async tryRestoreLatestSaveState() {
      if (!this.initialized || this.failed || !this.romLoaded) return;
      if (typeof this.api.getSaveStates !== 'function') return;
      try {
        var states = await this.api.getSaveStates();
        if (states && states.length > 0) {
          await this.api.loadState(states[states.length - 1]);
          this.emitStatus('Save state restored. Press Start.');
        }
      } catch (e) {
        // No states or load failed — start from SRAM (automatic) or new game.
      }
    }

    async start() {
      if (!this.romLoaded) {
        this.emitStatus('Load a ROM before starting.');
        return;
      }
      await this.ensureInitialized();
      // Resume AudioContext before play() — browsers and VS Code webviews
      // suspend it until a gesture, and WasmBoy exposes this natively.
      if (typeof this.api.resumeAudioContext === 'function') {
        try { this.api.resumeAudioContext(); } catch (e) { /* ignore */ }
      }
      try {
        await withRetry(function () {
          return this.api.play();
        }.bind(this), 3, 600);
        this.running = true;
      } catch (error) {
        throw new Error('Unable to start ROM: ' + getErrorMessage(error));
      }
      this.flushJoypadState();
    }

    async pause() {
      if (!this.initialized) { this.running = false; return; }
      try {
        await withRetry(function () {
          return this.api.pause();
        }.bind(this), 3, 600);
      } catch (error) {
        throw new Error('Unable to pause ROM: ' + getErrorMessage(error));
      }
      this.running = false;
    }

    async reset() {
      if (!this.romLoaded) { this.emitStatus('No ROM loaded.'); return; }
      await this.ensureInitialized();
      var wasRunning = this.running;
      try {
        await withRetry(function () { return this.api.pause(); }.bind(this), 3, 600);
        await withRetry(function () { return this.api.reset(); }.bind(this), 3, 600);
      } catch (error) {
        throw new Error('Unable to reset ROM: ' + getErrorMessage(error));
      }
      this.api.setSpeed(this.speedMultiplier);
      this.flushJoypadState();
      if (wasRunning) {
        await withRetry(function () { return this.api.play(); }.bind(this), 3, 600);
      }
      this.running = wasRunning;
      this.emitStatus('Reset complete.');
    }

    // Saves the current emulator state to IndexedDB (via WasmBoy's official
    // saveState() API) and returns the state object for in-memory use.
    // The game is automatically resumed if it was running before the call.
    async saveState() {
      if (!this.initialized || this.failed || !this.romLoaded) return null;
      var wasRunning = this.running;
      try {
        var state = await withRetry(function () {
          return this.api.saveState();
        }.bind(this), 3, 600);
        if (wasRunning) {
          await withRetry(function () { return this.api.play(); }.bind(this), 3, 600);
          this.running = true;
        }
        return state;
      } catch (error) {
        if (wasRunning) {
          try { await this.api.play(); this.running = true; } catch (e) { /* ignore */ }
        }
        return null;
      }
    }

    async loadSaveState(state) {
      if (!this.initialized || this.failed || !this.romLoaded || !state) return;
      try {
        await this.api.loadState(state);
        this.emitStatus('Save state restored.');
      } catch (error) {
        throw new Error('Unable to restore save state: ' + getErrorMessage(error));
      }
    }

    setTurbo(enabled) {
      this.speedMultiplier = enabled ? 2 : 1;
      if (this.initialized && !this.failed) { this.api.setSpeed(this.speedMultiplier); }
      this.emitStatus(enabled ? 'Turbo enabled.' : 'Turbo disabled.');
    }

    setAudioEnabled(enabled) {
      this.audioEnabled = enabled;
      if (!this.initialized || this.failed) return;
      try {
        var channels = typeof this.api._getAudioChannels === 'function'
          ? this.api._getAudioChannels()
          : null;
        if (channels) {
          // WasmBoy's internal loop watches channels 1-4: if all are unmuted it
          // unmutes master; if any is muted it mutes master. Muting master directly
          // gets overridden on the next audio update. So we mute/unmute ch1-4 and
          // let WasmBoy propagate the state to master automatically.
          var action = enabled ? 'unmute' : 'mute';
          ['channel1', 'channel2', 'channel3', 'channel4'].forEach(function (ch) {
            if (channels[ch] && typeof channels[ch][action] === 'function') {
              channels[ch][action]();
            }
          });
        }
      } catch (e) { /* ignore */ }
      this.emitStatus(enabled ? 'Audio on.' : 'Audio off.');
    }

    pressButton(name) { this.buttonState[name] = true; this.flushJoypadState(); }
    releaseButton(name) { this.buttonState[name] = false; this.flushJoypadState(); }

    flushJoypadState() {
      if (!this.initialized || this.failed || !this.romLoaded || !this.running) return;
      try {
        this.api.setJoypadState({
          UP: this.buttonState.UP, RIGHT: this.buttonState.RIGHT,
          DOWN: this.buttonState.DOWN, LEFT: this.buttonState.LEFT,
          A: this.buttonState.A, B: this.buttonState.B,
          SELECT: this.buttonState.SELECT, START: this.buttonState.START
        });
      } catch (error) {
        var message = getErrorMessage(error);
        var isTransient =
          message.indexOf('postMessageIgnoreResponse') !== -1 ||
          message.indexOf('setJoypadState') !== -1 ||
          message.indexOf('undefined') !== -1;
        if (isTransient) {
          if (!this.joypadTransientErrorShown) {
            this.joypadTransientErrorShown = true;
            this.emitStatus('Controller initializing, retry input in a second.');
          }
          return;
        }
        throw error;
      }
    }

    async destroy() {
      if (!this.initialized) return;
      try { await this.api.pause(); } catch (error) { /* ignore dispose errors */ }
    }

    onReady() { this.emitStatus('WASM core ready. Load a ROM.'); }
    onPlay() { this.running = true; this.emitStatus('Running (WASM).'); }
    onPause() { this.running = false; this.emitStatus('Paused.'); }
    emitStatus(text) {
      if (this.hooks && typeof this.hooks.onStatus === 'function') {
        this.hooks.onStatus(text);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Demo core (fallback when WASM is unavailable)
  // ---------------------------------------------------------------------------

  class DemoGameBoyCore {
    constructor(canvas, hooks) {
      this.canvas = canvas;
      this.hooks = hooks;
      this.ctx = canvas.getContext('2d');
      this.running = false;
      this.romLoaded = false;
      this.frame = 0;
      this.speedMultiplier = 1;
      this.loopHandle = null;
      this.buttons = new Set();
      this.palette = [[15, 56, 15], [48, 98, 48], [139, 172, 15], [155, 188, 15]];

      if (!this.ctx) throw new Error('Canvas context unavailable.');
      this.imageData = this.ctx.createImageData(160, 144);
      this.renderBootPattern();
      this.emitStatus('WASM unavailable. Demo core active.');
    }

    loadROM(data) {
      this.romLoaded = true;
      var kb = Math.max(1, Math.round((data.byteLength || data.length || 1024) / 1024));
      this.emitStatus('ROM loaded (' + kb + ' KB). Demo core active.');
      this.renderFrame();
      return Promise.resolve();
    }

    start() {
      if (!this.romLoaded) { this.emitStatus('Load a ROM before starting.'); return; }
      if (this.running) return;
      this.running = true;
      this.emitStatus('Running (demo).');
      this.tick();
    }

    pause() {
      this.running = false;
      if (this.loopHandle !== null) { cancelAnimationFrame(this.loopHandle); this.loopHandle = null; }
      this.emitStatus('Paused.');
    }

    reset() { this.frame = 0; this.renderBootPattern(); this.emitStatus('Reset complete.'); }
    async saveState() { return null; }
    async loadSaveState() { }
    async tryRestoreLatestSaveState() { }
    setTurbo(enabled) { this.speedMultiplier = enabled ? 2 : 1; this.emitStatus(enabled ? 'Turbo enabled.' : 'Turbo disabled.'); }
    pressButton(name) { this.buttons.add(name); }
    releaseButton(name) { this.buttons.delete(name); }
    destroy() { this.pause(); }

    tick() {
      if (!this.running) return;
      for (var i = 0; i < this.speedMultiplier; i++) { this.frame++; this.renderFrame(); }
      this.loopHandle = requestAnimationFrame(this.tick.bind(this));
    }

    renderBootPattern() {
      for (var y = 0; y < 144; y++) for (var x = 0; x < 160; x++) {
        this.setPixel(x, y, this.palette[((Math.floor(x / 16) + Math.floor(y / 16)) % 4 + 4) % 4]);
      }
      this.ctx.putImageData(this.imageData, 0, 0);
    }

    renderFrame() {
      var ox = this.buttons.has('RIGHT') ? 5 : this.buttons.has('LEFT') ? -5 : 0;
      var oy = this.buttons.has('DOWN') ? 5 : this.buttons.has('UP') ? -5 : 0;
      var pulse = this.buttons.has('A') ? 22 : this.buttons.has('B') ? 10 : 0;
      for (var y = 0; y < 144; y++) for (var x = 0; x < 160; x++) {
        var w = Math.sin((x + this.frame + ox) / 9) + Math.cos((y + this.frame + oy) / 13);
        var s = Math.floor(((w + 2) / 4) * 3);
        if ((x + this.frame + pulse) % 31 < 4) s = 3;
        this.setPixel(x, y, this.palette[Math.max(0, Math.min(3, s))]);
      }
      this.ctx.putImageData(this.imageData, 0, 0);
    }

    setPixel(x, y, rgb) {
      var i = (y * 160 + x) * 4;
      this.imageData.data[i] = rgb[0]; this.imageData.data[i + 1] = rgb[1];
      this.imageData.data[i + 2] = rgb[2]; this.imageData.data[i + 3] = 255;
    }

    emitStatus(text) {
      if (this.hooks && typeof this.hooks.onStatus === 'function') this.hooks.onStatus(text);
    }
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  function getErrorMessage(error) {
    if (error instanceof Error) return error.message;
    if (typeof error === 'string') return error;
    if (error && typeof error === 'object') {
      try { return JSON.stringify(error); } catch (e) { }
    }
    return String(error || 'Unknown error');
  }

  // Retries fn() up to maxAttempts times, waiting delayMs between attempts.
  // Only retries on errors that indicate a transient worker/timeout failure.
  async function withRetry(fn, maxAttempts, delayMs) {
    for (var attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        return await fn();
      } catch (error) {
        if (attempt === maxAttempts - 1) throw error;
        var msg = getErrorMessage(error).toLowerCase();
        var isRetryable =
          msg.indexOf('timed out') !== -1 ||
          msg.indexOf('message dropped') !== -1 ||
          msg.indexOf('unknown error') !== -1 ||
          msg.indexOf('undefined') !== -1;
        if (!isRetryable) throw error;
        await delay(delayMs);
      }
    }
  }

  function delay(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }

  async function normalizeRomBytes(data) {
    if (data instanceof Uint8Array) return data;
    if (data instanceof ArrayBuffer) return new Uint8Array(data);
    if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    if (data && typeof data.arrayBuffer === 'function') return new Uint8Array(await data.arrayBuffer());
    throw new Error('Unsupported ROM input type');
  }

  function resolveWasmBoyApi() {
    if (!window.WasmBoy) return null;
    if (typeof window.WasmBoy.config === 'function') return window.WasmBoy;
    if (window.WasmBoy.WasmBoy && typeof window.WasmBoy.WasmBoy.config === 'function') return window.WasmBoy.WasmBoy;
    return null;
  }

  window.createGameBoyCore = createGameBoyCore;
})();
