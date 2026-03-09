<p align="center">
  <img src="media/vibeBoy.png" alt="vibeBoy Title" height="70">
</p>
<p align="center">
  <a href="https://marketplace.visualstudio.com/items?itemName=simofildi.vibeboy">
    <img src="https://img.shields.io/visual-studio-marketplace/v/simofildi.vibeboy?color=blue&label=vibeBoy" alt="VS Code Marketplace Version">
  </a>
  <a href="https://marketplace.visualstudio.com/items?itemName=simofildi.vibeboy">
    <img src="https://img.shields.io/visual-studio-marketplace/d/simofildi.vibeboy?color=blue&label=Downloads" alt="VS Code Marketplace Downloads">
  </a>
  <img src="https://img.shields.io/badge/TypeScript-007ACC?logo=typescript&logoColor=white" alt="TypeScript">
  <img src="https://img.shields.io/badge/License-GPLv3-blue.svg" alt="License: GPL v3">
</p>

<p align="center">
  <a href="https://www.buymeacoffee.com/alwaysawakeuntildawn">
    <img src="https://img.shields.io/badge/Buy%20Me%20a%20Coffee-ffdd00?style=for-the-badge&logo=buy-me-a-coffee&logoColor=black" alt="Buy Me A Coffee">
  </a>
</p>

<p align="center">
  <i>"Waiting for the AI to finish your code? Play a classic game in your IDE. <br>The only extension you need while the other extensions write your code."</i>
</p>

---

**vibeBoy** is a lightweight, fully functional Game Boy emulator that lives directly in your VS Code sidebar. 

Perfect for catching a quick break while your code compiles, tests run, or while your AI coding assistant finishes generating the next big feature. 

## ✨ Features

- **Sidebar Integration:** Plays quietly in a dedicated VS Code view without opening external windows.
- **Auto-Save & Resume:** Automatically saves your game state when you close the tab or switch files. Pick up exactly where you left off.
- **Smart Audio:** The audio mutes automatically when the sidebar view loses focus, so it won't interrupt your workflow.
- **Customizable Keybindings:** Play the way you want, with fully configurable controls right from the VS Code Settings.
- **Local Emulation:** Powered by [WasmBoy](https://github.com/torch2424/wasmboy), everything runs quickly and locally using WebAssembly.

## 🚀 How to Play

### Installation Methods

**Option 1: VS Code Marketplace (Recommended)**
1. Open Visual Studio Code.
2. Go to the **Extensions** view by clicking on the Extensions icon in the Activity Bar on the side of VS Code or pressing `Ctrl+Shift+X` (Windows/Linux) or `Cmd+Shift+X` (macOS).
3. Search for `vibeBoy` and click **Install**. 
   - *Alternatively, you can install directly from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=simofildi.vibeboy).*

**Option 2: Manual Installation (.vsix)**
1. Download the latest `.vsix` file from the [Releases](https://github.com/simofildi/vibeboy/releases) section of this repository.
2. Open Visual Studio Code.
3. Go to the **Extensions** view (`Ctrl+Shift+X` or `Cmd+Shift+X`).
4. Click on the **Views and More Actions** icon (`...` at the top right of the Extensions view).
5. Select **Install from VSIX...**
6. Locate and select the downloaded `.vsix` file to install it.

### Playing

1. Click the new Game Boy icon in your Activity Bar (the left sidebar).
2. Click "Load ROM" to load your favorite `.gb` or `.gbc` ROM file.
3. Enjoy!

## ⌨️ Controls & Settings

You can customize the controls in VS Code's global settings by searching for `vibeBoy.keybindings`.

**Default Controls:**
- **D-Pad:** `Arrow Keys`
- **A / B:** `X` / `Z`
- **Start / Select:** `Enter` / `ShiftLeft`

You can also adjust other settings via the command palette (`Ctrl+Shift+P` or `Cmd+Shift+P`) and typing **vibeBoy: Emulator Settings**.

## 📝 Requirements

You will need to provide your own legal backup copies of Game Boy or Game Boy Color ROMs. This extension does not include any games out of the box.

## 🤝 Contributing & Feedback

Got a feature request or found a bug? Feel free to open an issue or contribute to the repository!

> Note: vibeBoy utilizes WasmBoy for the emulation core. Check out their [repository](https://github.com/torch2424/wasmboy) for more details on the tech stack.

