(function () {
  var vscode = acquireVsCodeApi();

  var elements = {
    status: document.getElementById('status'),
    canvas: document.getElementById('screen'),
    dpad: document.getElementById('dpad'),
    dpadCenter: document.querySelector('.dpad-center'),
    turboToggleBtn: document.getElementById('turbo-toggle-btn'),
    welcomeOverlay: document.getElementById('welcome-overlay'),
    welcomeLoadBtn: document.getElementById('welcome-load-btn'),
    welcomeResumeBtn: document.getElementById('welcome-resume-btn'),
    autosaveToggleBtn: document.getElementById('autosave-toggle-btn'),
    keybindingsOverlay: document.getElementById('keybindings-overlay'),
    keybindingsList: document.getElementById('keybindings-list'),
    keybindingsCloseBtn: document.getElementById('keybindings-close-btn'),
    pauseBtn: document.getElementById('pause-btn'),
    pauseIconPause: document.getElementById('pause-icon-pause'),
    pauseIconPlay: document.getElementById('pause-icon-play'),
    pauseBtnLabel: document.getElementById('pause-btn-label'),
    stopBtn: document.getElementById('stop-btn'),
    audioBtn: document.getElementById('audio-btn'),
    audioIconOn: document.getElementById('audio-icon-on'),
    audioIconOff: document.getElementById('audio-icon-off'),
    audioBtnLabel: document.getElementById('audio-btn-label'),
    settingsBtn: document.getElementById('settings-btn'),
    closeBtn: document.getElementById('close-btn')
  };

  if (!elements.canvas || !elements.dpad) {
    vscode.postMessage({ type: 'warn', text: 'UI elements missing in Game Boy webview.' });
    return;
  }

  var core = window.createGameBoyCore(elements.canvas, {
    onStatus: setStatus
  });

  var turboEnabled = window.VIBE_EMULATOR_CONFIG && typeof window.VIBE_EMULATOR_CONFIG.turboEnabled === 'boolean' ? window.VIBE_EMULATOR_CONFIG.turboEnabled : false;
  var autoSaveEnabled = false;
  var audioEnabled = window.VIBE_EMULATOR_CONFIG && typeof window.VIBE_EMULATOR_CONFIG.audioEnabled === 'boolean' ? window.VIBE_EMULATOR_CONFIG.audioEnabled : true;
  var pauseOnHidden = window.VIBE_EMULATOR_CONFIG && typeof window.VIBE_EMULATOR_CONFIG.pauseOnHidden === 'boolean' ? window.VIBE_EMULATOR_CONFIG.pauseOnHidden : false;
  var wasRunningBeforeHidden = false;
  var currentIsWindowFocused = true;
  var currentIsDocumentVisible = !document.hidden;
  var coreActionQueue = Promise.resolve();
  var currentStatus = '';

  function applyAudioState() {
    if (audioEnabled && currentIsWindowFocused && currentIsDocumentVisible) {
      try { core.setAudioEnabled(true); } catch (e) { /* ignore */ }
      resumeAudioContext();
    } else {
      try { core.setAudioEnabled(false); } catch (e) { /* ignore */ }
    }
  }
  var dpadPointerId = null;
  var activeDpadButtons = new Set();
  var keyToButton = {};
  var draftKeybindings = {};

  function updateKeybindings(config) {
    if (!config) return;

    keyToButton = {};
    if (config.up) keyToButton[config.up] = 'UP';
    if (config.down) keyToButton[config.down] = 'DOWN';
    if (config.left) keyToButton[config.left] = 'LEFT';
    if (config.right) keyToButton[config.right] = 'RIGHT';
    if (config.a) keyToButton[config.a] = 'A';
    if (config.b) keyToButton[config.b] = 'B';
    if (config.start) keyToButton[config.start] = 'START';
    if (config.select) keyToButton[config.select] = 'SELECT';
  }

  // Initialize keybindings from injected config or fallback to defaults
  const initialConfig = window.VIBE_EMULATOR_CONFIG && window.VIBE_EMULATOR_CONFIG.keybindings
    ? window.VIBE_EMULATOR_CONFIG.keybindings
    : { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight', a: 'KeyX', b: 'KeyZ', start: 'Enter', select: 'ShiftLeft' };

  updateKeybindings(initialConfig);

  var visualTargets = new Map();
  var visualSources = new Map();
  var faceButtons = Array.prototype.slice.call(document.querySelectorAll('[data-gb-btn]'));
  var dpadSegments = Array.prototype.slice.call(document.querySelectorAll('[data-dpad-dir]'));

  faceButtons.forEach(function (button) {
    var mappedButton = button.getAttribute('data-gb-btn');
    if (mappedButton) {
      visualTargets.set(mappedButton, button);
    }
  });

  dpadSegments.forEach(function (segment) {
    var mappedButton = segment.getAttribute('data-dpad-dir');
    if (mappedButton) {
      visualTargets.set(mappedButton, segment);
    }
  });

  bindUi();
  bindKeyboard();
  bindGamepad();
  bindExtensionMessages();
  bindGlobalErrorHandlers();
  bindExtraButtons();
  // Resume AudioContext on any user gesture — browsers suspend it until
  // explicit interaction, which causes silence or crackling in webviews.
  document.addEventListener('pointerdown', resumeAudioContext, { passive: true });
  document.addEventListener('keydown', resumeAudioContext, { passive: true });
  setStatus('No ROM loaded');

  function updateAudioBtnVisual() {
    if (elements.audioIconOn) elements.audioIconOn.classList.toggle('hidden', !audioEnabled);
    if (elements.audioIconOff) elements.audioIconOff.classList.toggle('hidden', audioEnabled);
    if (elements.audioBtnLabel) elements.audioBtnLabel.textContent = audioEnabled ? 'Audio' : 'Mute';
    if (elements.audioBtn) elements.audioBtn.classList.toggle('utility-btn--muted', !audioEnabled);
  }

  // Reactive pause button: poll core.running every 200ms so the icon
  // always reflects the true emulator state without relying on fragile timeouts.
  var _lastRunningState = null;
  var _lastRomLoaded = null;
  var _isRomActive = false;
  var _lastRomName = '';

  function updatePauseBtnVisual() {
    if (!elements.pauseBtn) return;
    var isRunning = !!(core && core.running);
    if (isRunning === _lastRunningState) return; // no change, skip DOM update
    _lastRunningState = isRunning;

    if (elements.pauseIconPause) elements.pauseIconPause.classList.toggle('hidden', !isRunning);
    if (elements.pauseIconPlay) elements.pauseIconPlay.classList.toggle('hidden', isRunning);
    if (elements.pauseBtnLabel) elements.pauseBtnLabel.textContent = isRunning ? 'Pause' : 'Play';
  }

  function updateEmulationButtons() {
    var romLoaded = !!(core && core.romLoaded && _isRomActive);
    if (romLoaded === _lastRomLoaded) return; // no change
    _lastRomLoaded = romLoaded;

    if (elements.pauseBtn) elements.pauseBtn.disabled = !romLoaded;
    if (elements.stopBtn) elements.stopBtn.disabled = !romLoaded;
    if (elements.audioBtn) elements.audioBtn.disabled = !romLoaded;
  }

  setInterval(function () {
    updatePauseBtnVisual();
    updateEmulationButtons();
  }, 200);

  function bindExtraButtons() {
    if (elements.welcomeLoadBtn) {
      elements.welcomeLoadBtn.addEventListener('click', function () {
        vscode.postMessage({ type: 'request-load-rom' });
      });
    }

    if (elements.welcomeResumeBtn) {
      elements.welcomeResumeBtn.addEventListener('click', function () {
        vscode.postMessage({ type: 'request-resume-rom' });
      });
    }

    if (elements.keybindingsCloseBtn) {
      elements.keybindingsCloseBtn.addEventListener('click', function () {
        if (elements.keybindingsOverlay) {
          elements.keybindingsOverlay.classList.add('hidden');
        }
        vscode.postMessage({ type: 'save-keybindings', keybindings: draftKeybindings });
      });
    }

    if (elements.pauseBtn) {
      elements.pauseBtn.addEventListener('click', function () {
        if (core && core.running) {
          handleEmulatorAction('pause', false);
        } else {
          handleEmulatorAction('start', false);
        }
        // Force immediate visual update
        _lastRunningState = null;
        updatePauseBtnVisual();
      });
    }

    if (elements.stopBtn) {
      elements.stopBtn.addEventListener('click', async function () {
        var wasRunning = !!(core && core.running);
        if (wasRunning) {
          try { await core.pause(); } catch (e) { /* ignore */ }
          _lastRunningState = null;
          updatePauseBtnVisual();
        }
        vscode.postMessage({ type: 'stop-emulation', wasRunning: wasRunning });
      });
    }

    if (elements.audioBtn) {
      elements.audioBtn.addEventListener('click', function () {
        audioEnabled = !audioEnabled;
        applyAudioState();
        updateAudioBtnVisual();
      });
    }

    if (elements.settingsBtn) {
      elements.settingsBtn.addEventListener('click', function () {
        vscode.postMessage({ type: 'open-settings' });
      });
    }

    if (elements.closeBtn) {
      elements.closeBtn.addEventListener('click', function () {
        vscode.postMessage({ type: 'close-emulator' });
      });
    }

    // Initialize visual state
    updateAudioBtnVisual();
    updatePauseBtnVisual();
    updateEmulationButtons();
  }

  function buildKeybindingsUI() {
    if (!elements.keybindingsList) return;

    // Copy the latest config to draft
    draftKeybindings = Object.assign({}, window.VIBE_EMULATOR_CONFIG && window.VIBE_EMULATOR_CONFIG.keybindings ? window.VIBE_EMULATOR_CONFIG.keybindings : initialConfig);

    var actions = [
      { id: 'up', label: 'Up' },
      { id: 'down', label: 'Down' },
      { id: 'left', label: 'Left' },
      { id: 'right', label: 'Right' },
      { id: 'a', label: 'A Button' },
      { id: 'b', label: 'B Button' },
      { id: 'start', label: 'Start' },
      { id: 'select', label: 'Select' }
    ];

    elements.keybindingsList.innerHTML = '';

    var listeningAction = null;

    var handleKeydown = function (event) {
      if (!listeningAction) return;
      event.preventDefault();
      event.stopPropagation();

      var newKey = event.code;
      draftKeybindings[listeningAction] = newKey;

      var btn = document.getElementById('kb-btn-' + listeningAction);
      if (btn) {
        btn.textContent = newKey;
        btn.classList.remove('listening');
      }

      listeningAction = null;
      window.removeEventListener('keydown', handleKeydown, true);
    };

    actions.forEach(function (actionPair) {
      var li = document.createElement('li');
      li.className = 'keybinding-item';

      var label = document.createElement('span');
      label.textContent = actionPair.label;

      var btn = document.createElement('button');
      btn.id = 'kb-btn-' + actionPair.id;
      btn.className = 'secondary-btn key-select-btn';
      btn.textContent = draftKeybindings[actionPair.id];

      btn.addEventListener('click', function () {
        if (listeningAction) {
          var oldBtn = document.getElementById('kb-btn-' + listeningAction);
          if (oldBtn) oldBtn.classList.remove('listening');
        }

        listeningAction = actionPair.id;
        btn.textContent = 'Press any key...';
        btn.classList.add('listening');

        window.addEventListener('keydown', handleKeydown, true);
      });

      li.appendChild(label);
      li.appendChild(btn);
      elements.keybindingsList.appendChild(li);
    });
  }

  function bindUi() {
    faceButtons.forEach(function (button) {
      var mappedButton = button.getAttribute('data-gb-btn');
      if (!mappedButton) {
        return;
      }

      button.addEventListener('pointerdown', function (event) {
        event.preventDefault();
        pressVirtualButton(mappedButton, 'pointer');
      });

      button.addEventListener('pointerup', function () {
        releaseVirtualButton(mappedButton, 'pointer');
      });

      button.addEventListener('pointercancel', function () {
        releaseVirtualButton(mappedButton, 'pointer');
      });

      button.addEventListener('pointerleave', function () {
        releaseVirtualButton(mappedButton, 'pointer');
      });
    });

    elements.dpad.addEventListener('pointerdown', function (event) {
      event.preventDefault();
      dpadPointerId = event.pointerId;

      if (typeof elements.dpad.setPointerCapture === 'function') {
        elements.dpad.setPointerCapture(event.pointerId);
      }

      updateDpadFromPointer(event);
    });

    elements.dpad.addEventListener('pointermove', function (event) {
      if (event.pointerId !== dpadPointerId) {
        return;
      }

      event.preventDefault();
      updateDpadFromPointer(event);
    });

    elements.dpad.addEventListener('pointerup', endDpadPointer);
    elements.dpad.addEventListener('pointercancel', endDpadPointer);
    elements.dpad.addEventListener('lostpointercapture', clearDpadPointer);
  }

  function bindKeyboard() {
    var held = new Set();

    window.addEventListener('keydown', function (event) {
      var mapped = keyToButton[event.code] || keyToButton[event.key];
      if (!mapped) {
        return;
      }

      event.preventDefault();
      if (held.has(mapped)) {
        return;
      }

      held.add(mapped);
      pressVirtualButton(mapped, 'keyboard');
    });

    window.addEventListener('keyup', function (event) {
      var mapped = keyToButton[event.code] || keyToButton[event.key];
      if (!mapped) {
        return;
      }

      event.preventDefault();
      held.delete(mapped);
      releaseVirtualButton(mapped, 'keyboard');
    });

    window.addEventListener('blur', function () {
      held.forEach(function (mapped) {
        releaseVirtualButton(mapped, 'keyboard');
      });

      held.clear();
      clearDpadPointer();
    });
  }

  function bindGamepad() {
    var previous = new Map();

    function poll() {
      var gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
      for (var i = 0; i < gamepads.length; i += 1) {
        var pad = gamepads[i];
        if (!pad) {
          continue;
        }

        updateButton(pad, 12, 'UP');
        updateButton(pad, 13, 'DOWN');
        updateButton(pad, 14, 'LEFT');
        updateButton(pad, 15, 'RIGHT');
        updateButton(pad, 0, 'A');
        updateButton(pad, 1, 'B');
        updateButton(pad, 8, 'SELECT');
        updateButton(pad, 9, 'START');
      }

      requestAnimationFrame(poll);
    }

    function updateButton(pad, index, gbButton) {
      var pressed = Boolean(pad.buttons[index] && pad.buttons[index].pressed);
      var key = pad.index + ':' + index;
      var source = 'gamepad:' + key;
      var before = previous.get(key) || false;

      if (pressed === before) {
        return;
      }

      previous.set(key, pressed);

      if (pressed) {
        pressVirtualButton(gbButton, source);
      } else {
        releaseVirtualButton(gbButton, source);
      }
    }

    poll();
  }

  function bindExtensionMessages() {
    window.addEventListener('message', function (event) {
      var message = event.data;
      if (!message || typeof message !== 'object') {
        return;
      }

      if (message.type === 'window-focus') {
        currentIsWindowFocused = message.focused;
        applyAudioState();
        return;
      }

      if (message.type === 'panel-visibility') {
        currentIsDocumentVisible = message.visible;
        if (!message.visible) {
          forceSave();
          if (pauseOnHidden && core.running) {
            wasRunningBeforeHidden = true;
            handleEmulatorAction('pause', false);
          }
        } else {
          if (pauseOnHidden && wasRunningBeforeHidden) {
            wasRunningBeforeHidden = false;
            handleEmulatorAction('start', false);
          }
        }
        applyAudioState();
        return;
      }

      if (message.type === 'load-rom') {
        runCoreAction(async function () {
          if (!message.name || !Array.isArray(message.bytes)) {
            setStatus('Invalid ROM payload.');
            return;
          }

          setStatus('Loading ROM: ' + message.name + ' ...');
          await core.loadROM(new Uint8Array(message.bytes));

          _isRomActive = true;
          _lastRomName = message.name;

          if (turboEnabled) {
            try { core.setTurbo(true); } catch (e) { /* ignore */ }
          }
          applyAudioState();

          // Restore the last save state if the extension host flagged it (user chose
          // "Save and close" on a previous stop), OR if auto-save mode is active.
          if (message.restoreState || autoSaveEnabled) {
            await core.tryRestoreLatestSaveState();
          }

          if (elements.welcomeOverlay) {
            elements.welcomeOverlay.innerHTML = '<h3>' + message.name + '</h3><p>Ready to play.</p><button id="welcome-run-btn" class="primary-btn">Run Game</button>';
            var runBtn = document.getElementById('welcome-run-btn');
            if (runBtn) {
              runBtn.addEventListener('click', function () {
                handleEmulatorAction('start', false);
                elements.welcomeOverlay.classList.add('hidden');
              });
            }
          }
        });
        return;
      }

      if (message.type === 'emulator-action') {
        if (message.action === 'open-keybindings-ui') {
          buildKeybindingsUI();
          if (elements.keybindingsOverlay) {
            elements.keybindingsOverlay.classList.remove('hidden');
          }
          return;
        }

        handleEmulatorAction(message.action, message.enabled);
        return;
      }

      if (message.type === 'open-keybindings-ui') {
        buildKeybindingsUI();
        if (elements.keybindingsOverlay) {
          elements.keybindingsOverlay.classList.remove('hidden');
        }
        return;
      }

      if (message.type === 'update-pause-on-hidden') {
        if (typeof message.pauseOnHidden === 'boolean') {
          pauseOnHidden = message.pauseOnHidden;
        }
        return;
      }

      if (message.type === 'update-keybindings') {
        if (message.keybindings) {
          updateKeybindings(message.keybindings);

          // Show temporary status letting user know config changed
          var previousStatus = currentStatus;
          setStatus('Keybindings updated');
          setTimeout(function () {
            if (currentStatus === 'Keybindings updated') {
              setStatus(previousStatus);
            }
          }, 3000);
        }
        return;
      }

    });
  }

  // Saves the current emulator state to IndexedDB if auto-save is enabled.
  // SRAM is persisted automatically by WasmBoy — no explicit action needed.
  function forceSave() {
    if (core && core.romLoaded && autoSaveEnabled) {
      runCoreAction(function () {
        return core.saveState();
      });
    }
  }

  document.addEventListener('visibilitychange', function () {
    currentIsDocumentVisible = !document.hidden;
    if (document.hidden) {
      forceSave();
      if (pauseOnHidden && core.running) {
        wasRunningBeforeHidden = true;
        handleEmulatorAction('pause', false);
      }
    } else {
      if (pauseOnHidden && wasRunningBeforeHidden) {
        wasRunningBeforeHidden = false;
        handleEmulatorAction('start', false);
      }
    }
    applyAudioState();
  });

  // Auto-mute when the VS Code window itself loses focus.
  // Note: window.blur/focus in a webview fires for iframe focus only, NOT for
  // OS-level app focus. The extension host detects that via onDidChangeWindowState
  // and sends a 'window-focus' message to us.

  /**
   * Resumes the Web AudioContext that WasmBoy manages internally.
   * WasmBoy exposes `resumeAudioContext()` directly on its public API.
   * This is safe to call at any time — it only acts when the context is suspended.
   */
  function resumeAudioContext() {
    try {
      if (core && core.api && typeof core.api.resumeAudioContext === 'function') {
        core.api.resumeAudioContext();
      }
    } catch (e) {
      // Ignore — audio resume is best-effort.
    }
  }

  function handleEmulatorAction(action, enabled) {
    if (action === 'start') {
      runCoreAction(function () {
        if (elements.welcomeOverlay) {
          elements.welcomeOverlay.classList.add('hidden');
        }
        return core.start();
      });
      return;
    }

    if (action === 'pause') {
      runCoreAction(async function () {
        await core.pause();
        forceSave();
      });
      return;
    }

    if (action === 'reset') {
      runCoreAction(function () {
        return core.reset();
      });
      return;
    }

    if (action === 'stop') {
      runCoreAction(async function () {
        if (Boolean(enabled)) {
          // Save state before stopping
          try { await core.saveState(); } catch (e) { /* ignore */ }
        }
        await core.pause();
        _isRomActive = false;

        // Clear the canvas
        if (elements.canvas) {
          const ctx = elements.canvas.getContext('2d');
          if (ctx) {
            ctx.clearRect(0, 0, elements.canvas.width, elements.canvas.height);
          }
        }

        if (elements.welcomeOverlay) {
          var logoUri = window.VIBE_EMULATOR_CONFIG && window.VIBE_EMULATOR_CONFIG.logoUri ? window.VIBE_EMULATOR_CONFIG.logoUri : '';
          var logoHtml = logoUri ? '<img src="' + logoUri + '" alt="vibeBoy" style="max-width: 80%; height: auto; margin-bottom: 10px;" />' : '<h3>vibeBoy</h3>';

          elements.welcomeOverlay.innerHTML = logoHtml + '<p>A Game Boy emulator in your sidebar.</p>' +
            '<button id="welcome-resume-btn-restart" class="primary-btn">Resume ' + _lastRomName + '</button>' +
            '<button id="welcome-load-btn-restart" class="secondary-btn" style="margin-top: 10px; background: transparent; border: 1px solid var(--vscode-button-background); color: var(--vscode-foreground); padding: 10px; border-radius: 4px; cursor: pointer;">Select New ROM</button>';

          elements.welcomeOverlay.classList.remove('hidden');

          var restartBtn = document.getElementById('welcome-load-btn-restart');
          if (restartBtn) {
            restartBtn.addEventListener('click', function () {
              vscode.postMessage({ type: 'request-load-rom' });
            });
          }
          var resumeBtn = document.getElementById('welcome-resume-btn-restart');
          if (resumeBtn) {
            resumeBtn.addEventListener('click', function () {
              vscode.postMessage({ type: 'request-resume-rom' });
            });
          }
        }
        setStatus('No ROM loaded');
        _lastRunningState = null;
        updatePauseBtnVisual();
        updateEmulationButtons();
      });
      return;
    }

    if (action === 'setTurbo') {
      turboEnabled = Boolean(enabled);

      try {
        core.setTurbo(turboEnabled);
        setStatus(turboEnabled ? 'Turbo x2 enabled' : 'Turbo x2 disabled');
        if (elements.turboToggleBtn) {
          elements.turboToggleBtn.textContent = turboEnabled ? 'Turbo x2: On' : 'Turbo x2: Off';
        }
      } catch (error) {
        handleCoreError(error);
      }
      return;
    }

    if (action === 'toggleAudio') {
      audioEnabled = !audioEnabled;
      applyAudioState();
      return;
    }

    if (action === 'setAutoSave') {
      autoSaveEnabled = Boolean(enabled);
      setStatus(autoSaveEnabled ? 'Auto-Save enabled' : 'Auto-Save disabled');
      if (elements.autosaveToggleBtn) {
        elements.autosaveToggleBtn.textContent = autoSaveEnabled ? 'Auto-Save: On' : 'Auto-Save: Off';
      }
      return;
    }
  }

  function updateDpadFromPointer(event) {
    syncDpadButtons(resolveDpadButtons(event.clientX, event.clientY), 'pointer');
  }

  function endDpadPointer(event) {
    if (event.pointerId !== dpadPointerId) {
      return;
    }

    clearDpadPointer();
  }

  function clearDpadPointer() {
    var currentButtons = Array.from(activeDpadButtons);
    currentButtons.forEach(function (gbButton) {
      releaseVirtualButton(gbButton, 'pointer');
    });

    activeDpadButtons.clear();
    dpadPointerId = null;
  }

  function syncDpadButtons(nextButtons, source) {
    var nextSet = new Set(nextButtons);

    Array.from(activeDpadButtons).forEach(function (gbButton) {
      if (!nextSet.has(gbButton)) {
        releaseVirtualButton(gbButton, source);
        activeDpadButtons.delete(gbButton);
      }
    });

    nextButtons.forEach(function (gbButton) {
      if (!activeDpadButtons.has(gbButton)) {
        pressVirtualButton(gbButton, source);
        activeDpadButtons.add(gbButton);
      }
    });
  }

  function resolveDpadButtons(clientX, clientY) {
    var rect = elements.dpad.getBoundingClientRect();
    if (!rect.width || !rect.height) {
      return [];
    }

    var x = clientX - rect.left - rect.width / 2;
    var y = clientY - rect.top - rect.height / 2;
    var d = Math.sqrt(x * x + y * y);

    if (d < 12) {
      return []; // Deadzone
    }

    var angle = Math.atan2(y, x) * 180 / Math.PI; // -180 to 180
    if (angle < 0) angle += 360;

    if (angle >= 337.5 || angle < 22.5) return ['RIGHT'];
    if (angle >= 22.5 && angle < 67.5) return ['DOWN', 'RIGHT'];
    if (angle >= 67.5 && angle < 112.5) return ['DOWN'];
    if (angle >= 112.5 && angle < 157.5) return ['DOWN', 'LEFT'];
    if (angle >= 157.5 && angle < 202.5) return ['LEFT'];
    if (angle >= 202.5 && angle < 247.5) return ['UP', 'LEFT'];
    if (angle >= 247.5 && angle < 292.5) return ['UP'];
    if (angle >= 292.5 && angle < 337.5) return ['UP', 'RIGHT'];

    return [];
  }

  function pressVirtualButton(gbButton, source) {
    setPadVisual(gbButton, source, true);

    try {
      core.pressButton(gbButton);
    } catch (error) {
      handleCoreError(error);
    }
  }

  function releaseVirtualButton(gbButton, source) {
    setPadVisual(gbButton, source, false);

    try {
      core.releaseButton(gbButton);
    } catch (error) {
      handleCoreError(error);
    }
  }

  function setStatus(text) {
    if (elements.status) {
      elements.status.textContent = text;
    }

    if (text === currentStatus) {
      return;
    }

    currentStatus = text;
    vscode.postMessage({ type: 'status', text: text });
  }

  function setPadVisual(gbButton, source, pressed) {
    var target = visualTargets.get(gbButton);
    if (!target) {
      return;
    }

    var activeSources = visualSources.get(gbButton);
    if (!activeSources) {
      activeSources = new Set();
      visualSources.set(gbButton, activeSources);
    }

    if (pressed) {
      activeSources.add(source);
    } else {
      activeSources.delete(source);
      if (activeSources.size === 0) {
        visualSources.delete(gbButton);
      }
    }

    target.classList.toggle('is-pressed', activeSources.size > 0);
  }

  function runCoreAction(action) {
    coreActionQueue = coreActionQueue
      .then(action)
      .catch(handleCoreError);
  }

  function handleCoreError(error) {
    setStatus(getErrorMessage(error));
  }

  function getErrorMessage(error) {
    if (error instanceof Error && error.message) {
      return error.message;
    }

    if (typeof error === 'string') {
      return error;
    }

    if (error && typeof error === 'object') {
      try {
        return JSON.stringify(error);
      } catch (jsonError) {
        // Ignore JSON stringify errors.
      }
    }

    return 'Emulator error';
  }

  function bindGlobalErrorHandlers() {
    window.addEventListener('error', function (event) {
      var text = event && event.error ? getErrorMessage(event.error) : event.message || 'Unknown runtime error';
      setStatus('Webview error: ' + text);
    });

    window.addEventListener('unhandledrejection', function (event) {
      setStatus('Promise error: ' + getErrorMessage(event.reason));
    });
  }

  window.addEventListener('beforeunload', function () {
    forceSave();
    clearDpadPointer();

    runCoreAction(function () {
      return core.destroy();
    });
  });
})();
