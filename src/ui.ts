import * as vscode from 'vscode';
import { type Config, getConfig } from './config';
import { hasCredential } from './secrets';
import { BTN } from './strings';

// 首次使用引导 + 上传前置检查（需求 4.10，T1 设计 §2.4）。
// 不 import commands.ts：引导中用 executeCommand 字符串触发，避免循环依赖。
export async function ensureReady(
  resource?: vscode.Uri,
): Promise<Config | undefined> {
  const config = getConfig(resource);

  if (config.serverUrl === '') {
    const action = await vscode.window.showWarningMessage(
      vscode.l10n.t(
        'ImgBed Uploader: Image host URL is not configured (imgbedUploader.serverUrl)',
      ),
      BTN.openSettings,
    );
    if (action === BTN.openSettings) {
      void vscode.commands.executeCommand(
        'workbench.action.openSettings',
        'imgbedUploader.serverUrl',
      );
    }
    return undefined;
  }

  if (config.authType !== 'none' && !(await hasCredential())) {
    const action = await vscode.window.showWarningMessage(
      vscode.l10n.t(
        'ImgBed Uploader: Credentials are not configured (upload auth code / API Token)',
      ),
      BTN.setCredentials,
    );
    if (action === BTN.setCredentials) {
      void vscode.commands.executeCommand('imgbed-uploader.setCredentials');
    }
    return undefined;
  }

  return config;
}

// 上传互斥锁（4.5）：上传进行中重复触发 → 提示并忽略，不并发两批任务。
let uploading = false;
export async function withUploadLock(body: () => Promise<void>): Promise<void> {
  if (uploading) {
    void vscode.window.showInformationMessage(
      vscode.l10n.t('ImgBed Uploader: An upload is already in progress'),
    );
    return;
  }
  uploading = true;
  try {
    await body();
  } finally {
    uploading = false;
  }
}

let channel: vscode.OutputChannel | undefined;

// 汇总报告（4.4）：通知摘要 + 按钮，逐项明细进 Output Channel。
// 不 await 通知返回——按钮回调（重试）要拿上传锁，不能占着锁等用户点按钮。
export function showReport(
  summary: { succeeded: number; failed: number; skipped: number },
  details: string[],
  opts: {
    retry?: { keys: string[]; run: (keys: string[]) => Promise<void> };
    authError?: boolean;
  },
): void {
  channel ??= vscode.window.createOutputChannel('ImgBed Uploader');
  channel.appendLine(`—— ${new Date().toLocaleString()} ——`);
  for (const line of details) {
    channel.appendLine(line);
  }

  const text = vscode.l10n.t(
    'ImgBed Uploader: {0} succeeded, {1} failed, {2} skipped',
    summary.succeeded,
    summary.failed,
    summary.skipped,
  );
  const buttons: string[] = [];
  if (opts.retry !== undefined && opts.retry.keys.length > 0) {
    buttons.push(BTN.retryFailed);
  }
  if (opts.authError) {
    buttons.push(BTN.resetCredentials);
  }
  const onAction = (action: string | undefined): void => {
    if (action === BTN.retryFailed && opts.retry !== undefined) {
      void opts.retry.run(opts.retry.keys);
    } else if (action === BTN.resetCredentials) {
      void vscode.commands.executeCommand('imgbed-uploader.setCredentials');
    }
  };
  if (summary.failed > 0) {
    void vscode.window.showWarningMessage(text, ...buttons).then(onAction);
  } else {
    void vscode.window.showInformationMessage(text, ...buttons).then(onAction);
  }
}
