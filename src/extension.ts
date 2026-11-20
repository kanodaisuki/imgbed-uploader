import * as vscode from 'vscode';
import { registerCommands } from './commands';
import { registerPasteProvider } from './paste';
import {
  clearCredential,
  hasCredential,
  initSecrets,
  setCredential,
} from './secrets';

// T11 设计 §2.3：扩展公开 API（activate 返回值 = extension.exports，VS Code 生产环境忽略之）。
// 同时是集成测试的凭据操作缝：扩展包（dist）与测试（out）两棵模块树，
// initSecrets 打桩不互通，SecretStorage 只能经 ExtensionContext 取，测试只能经此通道种/清凭据。
// useMemorySecrets：把凭据存储换成内存实现——真 SecretStorage 的写读传播在
// 测试机上不可靠（T11 施工记录），行为语义不变、测试确定性归零风险。
export type ExtensionApi = {
  setCredential(secret: string): Promise<void>;
  clearCredential(): Promise<void>;
  hasCredential(): Promise<boolean>;
  useMemorySecrets(): void;
};

export function activate(context: vscode.ExtensionContext): ExtensionApi {
  initSecrets(context.secrets);
  registerCommands(context);
  registerPasteProvider(context);
  return {
    setCredential,
    clearCredential,
    hasCredential,
    useMemorySecrets: () => {
      const map = new Map<string, string>();
      initSecrets({
        get: (key: string) => Promise.resolve(map.get(key)),
        store: (key: string, value: string) => {
          map.set(key, value);
          return Promise.resolve();
        },
        delete: (key: string) => {
          map.delete(key);
          return Promise.resolve();
        },
        onDidChange: new vscode.EventEmitter<unknown>().event,
      } as unknown as vscode.SecretStorage);
    },
  };
}

export function deactivate() {}
