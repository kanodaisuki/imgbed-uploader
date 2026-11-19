import * as vscode from 'vscode';
import { registerCommands } from './commands';
import { registerPasteProvider } from './paste';
import { initSecrets } from './secrets';

export function activate(context: vscode.ExtensionContext) {
  initSecrets(context.secrets);
  registerCommands(context);
  registerPasteProvider(context);
}

export function deactivate() {}
