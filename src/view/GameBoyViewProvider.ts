import * as path from 'node:path';
import * as vscode from 'vscode';

export class GameBoyViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'vibeBoy.gameBoyView';
  private webviewView?: vscode.WebviewView;
  private turboEnabled = false;
  private audioEnabled = true;

  constructor(private readonly context: vscode.ExtensionContext) { }

  public async openMenu(): Promise<void> {
    await vscode.commands.executeCommand('workbench.view.extension.vibeBoy');

    const config = vscode.workspace.getConfiguration('vibeBoy');
    const pauseOnHidden = config.get<boolean>('pauseOnHidden', false);

    const selection = await vscode.window.showQuickPick(
      [
        {
          label: 'Load ROM',
          description: 'Choose a .gb, .gbc, or .bin file',
          action: 'load-rom'
        },
        {
          label: 'Run',
          description: 'Start or resume the emulator',
          action: 'start'
        },
        {
          label: 'Pause',
          description: 'Pause emulation',
          action: 'pause'
        },
        {
          label: 'Reset',
          description: 'Restart the loaded ROM',
          action: 'reset'
        },
        {
          label: this.turboEnabled ? 'Turbo x2: On' : 'Turbo x2: Off',
          description: 'Toggle double-speed mode',
          action: 'toggle-turbo'
        },
        {
          label: this.audioEnabled ? 'Audio: On' : 'Audio: Off',
          description: 'Toggle game audio',
          action: 'toggle-audio'
        },
        {
          label: pauseOnHidden ? 'Pause when hidden: On' : 'Pause when hidden: Off',
          description: 'Pause the emulator when the sidebar is hidden',
          action: 'toggle-pause-on-hidden'
        },
        {
          label: 'Keybindings',
          description: 'Configure emulator controls',
          action: 'open-keybindings-ui'
        }
      ],
      {
        title: 'VibeBoy Settings',
        placeHolder: 'Manage the emulator without adding extra controls to the screen'
      }
    );

    if (!selection) {
      return;
    }

    switch (selection.action) {
      case 'load-rom':
        await this.loadRom();
        return;
      case 'open-keybindings-ui':
        await this.postMessage({ type: 'open-keybindings-ui' });
        return;
      case 'toggle-turbo':
        this.turboEnabled = !this.turboEnabled;
        await this.postMessage({
          type: 'emulator-action',
          action: 'setTurbo',
          enabled: this.turboEnabled
        });
        return;
      case 'toggle-audio':
        this.audioEnabled = !this.audioEnabled;
        await this.postMessage({
          type: 'emulator-action',
          action: 'toggleAudio'
        });
        return;
      case 'toggle-pause-on-hidden':
        await config.update('pauseOnHidden', !pauseOnHidden, vscode.ConfigurationTarget.Global);
        // The setting listener handles sending the message to the view.
        return;
      default:
        await this.postMessage({
          type: 'emulator-action',
          action: selection.action
        });
    }
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.webviewView = webviewView;
    const { webview } = webviewView;

    webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'media')]
    };

    const lastRomName = this.context.workspaceState.get<string>('vibeBoy.lastRomName');
    webview.html = this.getHtml(webview, lastRomName);
    this.updateViewDescription('No ROM loaded');

    webview.onDidReceiveMessage((message: { type?: string; text?: string; state?: any; sram?: any; keybindings?: any; wasRunning?: boolean }) => {
      if (message.type === 'warn' && message.text) {
        void vscode.window.showWarningMessage(message.text);
        return;
      }

      if (message.type === 'status' && message.text) {
        this.updateViewDescription(message.text);
      }

      if (message.type === 'request-load-rom') {
        void this.loadRom();
      }

      if (message.type === 'save-keybindings' && message.keybindings) {
        const config = vscode.workspace.getConfiguration('vibeBoy');
        if (config) {
          for (const key of Object.keys(message.keybindings)) {
            // Need to prefix with 'keybindings.' because the setting ID is vibeBoy.keybindings.X
            void config.update(`keybindings.${key}`, message.keybindings[key], vscode.ConfigurationTarget.Global);
          }
        }
      }

      if (message.type === 'request-resume-rom') {
        const lastRomUriStr = this.context.workspaceState.get<string>('vibeBoy.lastRomUri');
        if (lastRomUriStr) {
          this.loadRom(vscode.Uri.parse(lastRomUriStr)).then(() => {
            void this.postMessage({ type: 'emulator-action', action: 'start' });
          });
        }
      }

      if (message.type === 'stop-emulation') {
        void this.handleStopEmulation(message.wasRunning);
      }

      if (message.type === 'open-settings') {
        void this.openMenu();
      }

      if (message.type === 'close-emulator') {
        void vscode.commands.executeCommand('workbench.action.closeSidebar');
      }
    });

    webviewView.onDidDispose(() => {
      if (this.webviewView === webviewView) {
        this.webviewView = undefined;
      }
    });

    webviewView.onDidChangeVisibility(() => {
      void this.postMessage({
        type: 'panel-visibility',
        visible: webviewView.visible
      });
    });

    // Detect when VS Code window gains/loses OS-level focus (e.g. user switches app).
    // window.blur/focus inside the webview only fires for iframe focus, not app focus.
    this.context.subscriptions.push(
      vscode.window.onDidChangeWindowState((state) => {
        void this.postMessage({
          type: 'window-focus',
          focused: state.focused
        });
      })
    );

    this.context.subscriptions.push(
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('vibeBoy.pauseOnHidden') && this.webviewView) {
          const pauseOnHidden = vscode.workspace.getConfiguration('vibeBoy').get<boolean>('pauseOnHidden', false);
          this.webviewView.webview.postMessage({
            type: 'update-pause-on-hidden',
            pauseOnHidden: pauseOnHidden
          });
        }
        if (e.affectsConfiguration('vibeBoy.keybindings') && this.webviewView) {
          const config = vscode.workspace.getConfiguration('vibeBoy.keybindings');
          const keybindings = {
            up: config.get<string>('up', 'ArrowUp'),
            down: config.get<string>('down', 'ArrowDown'),
            left: config.get<string>('left', 'ArrowLeft'),
            right: config.get<string>('right', 'ArrowRight'),
            a: config.get<string>('a', 'KeyX'),
            b: config.get<string>('b', 'KeyZ'),
            start: config.get<string>('start', 'Enter'),
            select: config.get<string>('select', 'ShiftLeft'),
          };
          this.webviewView.webview.postMessage({
            type: 'update-keybindings',
            keybindings: keybindings
          });
        }
      })
    );
  }

  private getHtml(webview: vscode.Webview, lastRomName?: string): string {
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'style.css'));
    const wasmBoyUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'wasmboy.wasm.iife.js'));
    const coreUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'gb-core.js'));
    const adapterUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'core-adapter.js'));
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'main.js'));
    const logoUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'vibeBoy.png'));
    const nonce = getNonce();

    const emulatorConfig = vscode.workspace.getConfiguration('vibeBoy');
    const pauseOnHidden = emulatorConfig.get<boolean>('pauseOnHidden', false);

    const config = vscode.workspace.getConfiguration('vibeBoy.keybindings');
    const keybindings = {
      up: config.get<string>('up', 'ArrowUp'),
      down: config.get<string>('down', 'ArrowDown'),
      left: config.get<string>('left', 'ArrowLeft'),
      right: config.get<string>('right', 'ArrowRight'),
      a: config.get<string>('a', 'KeyX'),
      b: config.get<string>('b', 'KeyZ'),
      start: config.get<string>('start', 'Enter'),
      select: config.get<string>('select', 'ShiftLeft'),
    };

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta
    http-equiv="Content-Security-Policy"
    content="default-src ${webview.cspSource} data: blob:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}' 'unsafe-eval' blob: data:; img-src ${webview.cspSource} data: blob:; worker-src blob: data:; child-src blob: data:; connect-src ${webview.cspSource} data: blob: https: http:;"
  />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link rel="stylesheet" href="${styleUri}" />
  <title>Game Boy Sidebar</title>
</head>
<body>
  <section class="emulator-panel" aria-label="Game Boy emulator panel">
    <header class="panel-header">
      <h2 class="panel-title">vibeBoy</h2>
    </header>

    <div class="screen-shell">
      <canvas id="screen" width="160" height="144" aria-label="Game Boy display"></canvas>
      
      <div id="welcome-overlay" class="welcome-overlay">
        <img src="${logoUri}" alt="vibeBoy" style="max-width: 80%; height: auto; margin-bottom: 10px;" />
        <p>A Game Boy emulator in your sidebar.</p>
        ${lastRomName
        ? `<button id="welcome-resume-btn" class="primary-btn">Resume ${lastRomName}</button>
             <button id="welcome-load-btn" class="secondary-btn" style="margin-top: 10px; background: transparent; border: 1px solid var(--vscode-button-background); color: var(--vscode-foreground); padding: 10px; border-radius: 4px; cursor: pointer;">Select New ROM</button>`
        : `<button id="welcome-load-btn" class="primary-btn">Select ROM</button>`}
      </div>

      <div id="keybindings-overlay" class="welcome-overlay hidden">
        <h3>Controls</h3>
        <ul id="keybindings-list" class="keybindings-list">
          <!-- Filled by JS -->
        </ul>
        <button id="keybindings-close-btn" class="primary-btn" style="margin-top: 15px;">Close</button>
      </div>
    </div>

    <div class="control-stage">
      <div class="controls-shell" aria-label="Virtual controls">
        <div class="dpad-zone">
          <div id="dpad" class="dpad" role="group" aria-label="Directional pad">
            <span class="dpad-arm dpad-up" data-dpad-dir="UP" aria-hidden="true"></span>
            <span class="dpad-arm dpad-right" data-dpad-dir="RIGHT" aria-hidden="true"></span>
            <span class="dpad-arm dpad-down" data-dpad-dir="DOWN" aria-hidden="true"></span>
            <span class="dpad-arm dpad-left" data-dpad-dir="LEFT" aria-hidden="true"></span>
            <span class="dpad-center" aria-hidden="true"></span>
          </div>
        </div>

        <div class="button-zone">
          <div class="ab-cluster">
            <button data-gb-btn="B" class="pad action-btn action-b" aria-label="B button">B</button>
            <button data-gb-btn="A" class="pad action-btn action-a" aria-label="A button">A</button>
          </div>
        </div>
      </div>

      <div class="system-row">
        <button data-gb-btn="SELECT" class="pad system-btn">Select</button>
        <button data-gb-btn="START" class="pad system-btn">Start</button>
      </div>

      <div class="utility-row">
        <button id="pause-btn" class="utility-btn" title="Play / Pause">
          <svg id="pause-icon-pause" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="16" height="16" class="hidden"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
          <svg id="pause-icon-play" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M8 5v14l11-7z"/></svg>
          <span id="pause-btn-label">Play</span>
        </button>
        <button id="stop-btn" class="utility-btn utility-btn--danger" title="Close ROM">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M6 6h12v12H6z"/></svg>
          <span>Stop</span>
        </button>
        <button id="audio-btn" class="utility-btn" title="Enable / Disable audio">
          <svg id="audio-icon-on" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>
          <svg id="audio-icon-off" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="16" height="16" class="hidden"><path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/></svg>
          <span id="audio-btn-label">Audio</span>
        </button>
        <button id="settings-btn" class="utility-btn" title="Settings">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/></svg>
          <span>Settings</span>
        </button>
        <button id="close-btn" class="utility-btn utility-btn--close" title="Close emulator">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
          <span>Close</span>
        </button>
      </div>
    </div>

    <span id="status" class="sr-only" aria-live="polite">No ROM loaded</span>
  </section>

  <script nonce="${nonce}">
    window.VIBE_EMULATOR_CONFIG = {
      keybindings: ${JSON.stringify(keybindings)},
      audioEnabled: ${this.audioEnabled},
      turboEnabled: ${this.turboEnabled},
      pauseOnHidden: ${pauseOnHidden},
      logoUri: '${logoUri}'
    };
  </script>
  <script nonce="${nonce}" src="${wasmBoyUri}"></script>
  <script nonce="${nonce}" src="${coreUri}"></script>
  <script nonce="${nonce}" src="${adapterUri}"></script>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }

  private async loadRom(preselectedUri?: vscode.Uri): Promise<void> {
    let fileUri = preselectedUri;

    if (!fileUri) {
      const fileUris = await vscode.window.showOpenDialog({
        canSelectMany: false,
        filters: {
          'Game Boy ROMs': ['gb', 'gbc', 'bin']
        },
        openLabel: 'Select ROM to Load'
      });
      fileUri = fileUris?.[0];
    }

    if (!fileUri) {
      return;
    }

    const romName = path.basename(fileUri.fsPath);

    // Save to workspace state for auto-resume
    await this.context.workspaceState.update('vibeBoy.lastRomUri', fileUri.toString());
    await this.context.workspaceState.update('vibeBoy.lastRomName', romName);

    const romBytes = await vscode.workspace.fs.readFile(fileUri);

    this.updateViewDescription(`Loading ${romName}`);

    // Check if there's a saved state for this exact ROM (set when user chose "Save and close").
    // Consume the flag immediately so it only fires once.
    const savedStateUri = this.context.workspaceState.get<string>('vibeBoy.savedStateRomUri');
    const restoreState = savedStateUri === fileUri.toString();
    if (restoreState) {
      await this.context.workspaceState.update('vibeBoy.savedStateRomUri', undefined);
    }

    await this.postMessage({
      type: 'load-rom',
      name: romName,
      bytes: Array.from(romBytes),
      restoreState
    });
  }

  private async handleStopEmulation(wasRunning?: boolean): Promise<void> {
    // First ask for confirmation
    const confirm = await vscode.window.showWarningMessage(
      'Are you sure you want to stop the emulation?',
      { modal: true },
      'Yes, stop'
    );

    if (confirm !== 'Yes, stop') {
      if (wasRunning) {
        await this.postMessage({ type: 'emulator-action', action: 'start' });
      }
      return;
    }

    // Then ask if they want to save
    const save = await vscode.window.showInformationMessage(
      'Do you want to save the current state before closing?',
      { modal: true },
      'Save and close',
      'Close without saving'
    );

    if (!save) {
      // User cancelled
      return;
    }

    const shouldSave = save === 'Save and close';
    if (shouldSave) {
      // Persist the current ROM URI so the next load of this ROM auto-restores the state.
      const currentRomUri = this.context.workspaceState.get<string>('vibeBoy.lastRomUri');
      if (currentRomUri) {
        await this.context.workspaceState.update('vibeBoy.savedStateRomUri', currentRomUri);
      }
    }
    await this.postMessage({ type: 'emulator-action', action: 'stop', enabled: shouldSave });
    this.updateViewDescription('No ROM loaded');
  }

  private async postMessage(message: {
    type: 'emulator-action' | 'load-rom' | 'update-keybindings' | 'update-pause-on-hidden' | 'open-keybindings-ui' | 'window-focus' | 'panel-visibility';
    action?: string;
    enabled?: boolean;
    focused?: boolean;
    visible?: boolean;
    name?: string;
    bytes?: number[];
    restoreState?: boolean;
    keybindings?: any;
    pauseOnHidden?: boolean;
    wasRunning?: boolean;
  }): Promise<void> {
    if (!this.webviewView) {
      void vscode.window.showWarningMessage('Open the Game Boy view before using emulator settings.');
      return;
    }

    await this.webviewView.webview.postMessage(message);
  }

  private updateViewDescription(text: string): void {
    if (!this.webviewView) {
      return;
    }

    const normalized = text.replace(/\s+/g, ' ').trim();
    this.webviewView.description = normalized.length > 36 ? `${normalized.slice(0, 33)}...` : normalized;
  }
}

function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let nonce = '';

  for (let i = 0; i < 32; i += 1) {
    nonce += chars.charAt(Math.floor(Math.random() * chars.length));
  }

  return nonce;
}
