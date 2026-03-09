import * as vscode from 'vscode';
import { GameBoyViewProvider } from './view/GameBoyViewProvider';

export function activate(context: vscode.ExtensionContext): void {
  const provider = new GameBoyViewProvider(context);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(GameBoyViewProvider.viewType, provider, {
      webviewOptions: {
        retainContextWhenHidden: true
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('vibeBoy.focusView', async () => {
      await vscode.commands.executeCommand('workbench.view.extension.vibeBoy');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('vibeBoy.openMenu', async () => {
      await provider.openMenu();
    })
  );
}

export function deactivate(): void {
  // Nothing to dispose manually.
}
