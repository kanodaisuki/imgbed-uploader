import * as vscode from 'vscode';
import { registerCommands } from './commands';
import { initSecrets } from './secrets';

export function activate(context: vscode.ExtensionContext) {
  initSecrets(context.secrets);
  registerCommands(context);
}

export function deactivate() {}
