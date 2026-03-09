/*
  Optional override hook.

  Priority:
  1) If `createExternalGameBoyCore` exists, the sidebar uses it.
  2) Otherwise it uses the integrated WasmBoy WASM core (IndexedDB-backed saves).
  3) If WASM is unavailable, it falls back to the built-in demo core.

  To provide a custom core, define the global function before this script loads:

    window.createExternalGameBoyCore = function(canvas, hooks) {
      // hooks.onStatus(text) — emit a status string to the UI
      return {
        loadROM(arrayBuffer),          // → Promise
        start(),                       // → Promise
        pause(),                       // → Promise
        reset(),                       // → Promise
        saveState(),                   // → Promise<object|null>  (IndexedDB-backed)
        loadSaveState(stateObj),       // → Promise
        tryRestoreLatestSaveState(),   // → Promise
        setTurbo(enabled),             // → void
        pressButton(name),             // → void
        releaseButton(name),           // → void
        destroy(),                     // → Promise
      };
    };
*/
