// T11 设计 §2.2：通知 / 输入框 / OutputChannel 打桩。
// 测试 out/ 树与扩展 dist/ 包共享 vscode 模块单例，打桩对扩展包内代码同样生效。
// 通知 Promise 默认挂起、由 click()/resolveAll() 结算（runTestConnection、ensureReady
// 会 await 通知，不结算命令不返回）；showInputBox/showOpenDialog 立即 resolve 防模态悬挂。
import * as vscode from 'vscode';

export type Call = {
  id: number;
  kind: 'info' | 'warn' | 'error';
  message: string;
  buttons: string[];
};

export type Notifier = {
  calls: Call[];
  lines: string[]; // 假 OutputChannel 的 appendLine 全文（beforeEach 清空）
  click(idOrSummary: number | string, button?: string): Promise<void>; // 指定通知以该按钮 resolve（缺省 = dismiss）
  resolveAll(): void; // 未决通知一律 resolve(undefined)
  setOpenDialog(uris: vscode.Uri[]): void; // showOpenDialog 的返回值（T7 命令面板入口）
  restore(): void; // 还原 window 方法；不替换假 channel 实例（ui.ts channel ??= 缓存）
};

type Pending = { call: Call; resolve: (v: string | undefined) => void };
type Waiter = { match: (c: Call) => boolean; resolve: (c: Call) => void };

export function stubNotifications(): Notifier {
  const calls: Call[] = [];
  const lines: string[] = [];
  const pending: Pending[] = [];
  const waiters: Waiter[] = [];
  let nextId = 1;
  let openDialogResult: vscode.Uri[] | undefined;

  const win = vscode.window as unknown as Record<string, unknown>;
  const originals: Record<string, unknown> = {
    showInformationMessage: win.showInformationMessage,
    showWarningMessage: win.showWarningMessage,
    showErrorMessage: win.showErrorMessage,
    showInputBox: win.showInputBox,
    showOpenDialog: win.showOpenDialog,
    createOutputChannel: win.createOutputChannel,
  };

  const record = (
    kind: Call['kind'],
    message: string,
    items: unknown[],
  ): Promise<string | undefined> => {
    const call: Call = {
      id: nextId++,
      kind,
      message,
      buttons: items.map((i) =>
        typeof i === 'string' ? i : String((i as { title: string }).title),
      ),
    };
    calls.push(call);
    return new Promise<string | undefined>((resolve) => {
      pending.push({ call, resolve });
      for (let i = waiters.length - 1; i >= 0; i -= 1) {
        if (waiters[i].match(call)) {
          waiters[i].resolve(call);
          waiters.splice(i, 1);
        }
      }
    });
  };

  win.showInformationMessage = (message: string, ...items: unknown[]) =>
    record('info', message, items);
  win.showWarningMessage = (message: string, ...items: unknown[]) =>
    record('warn', message, items);
  win.showErrorMessage = (message: string, ...items: unknown[]) =>
    record('error', message, items);
  win.showInputBox = () => Promise.resolve(undefined);
  win.showOpenDialog = () => Promise.resolve(openDialogResult);
  win.createOutputChannel = () =>
    ({
      name: 'ImgBed Uploader',
      append: (s: string) => void lines.push(s),
      appendLine: (s: string) => void lines.push(s),
      replace: () => undefined,
      clear: () => void (lines.length = 0),
      show: () => undefined,
      hide: () => undefined,
      dispose: () => undefined,
    }) as unknown as vscode.OutputChannel;

  const settle = (p: Pending, button: string | undefined): void => {
    const i = pending.indexOf(p);
    if (i !== -1) {
      pending.splice(i, 1);
    }
    p.resolve(button);
  };

  return {
    calls,
    lines,
    click: async (idOrSummary, button) => {
      const match = (c: Call): boolean =>
        typeof idOrSummary === 'number'
          ? c.id === idOrSummary
          : c.message.includes(idOrSummary);
      let call = calls.find(match);
      if (call === undefined) {
        call = await new Promise<Call>((resolve) =>
          waiters.push({ match, resolve }),
        );
      }
      const p = pending.find((x) => x.call === call);
      if (p !== undefined) {
        settle(p, button);
      }
    },
    resolveAll: () => {
      for (const p of pending.splice(0)) {
        p.resolve(undefined);
      }
    },
    setOpenDialog: (uris) => {
      openDialogResult = uris;
    },
    restore: () => {
      for (const [name, fn] of Object.entries(originals)) {
        win[name] = fn;
      }
    },
  };
}
