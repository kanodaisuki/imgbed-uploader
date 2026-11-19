import * as vscode from 'vscode';
import { type Config, getConfig } from './config';
import { hasCredential } from './secrets';

// 首次使用引导 + 上传前置检查（需求 4.10，T1 设计 §2.4）。
// 不 import commands.ts：引导中用 executeCommand 字符串触发，避免循环依赖。
export async function ensureReady(
  resource?: vscode.Uri,
): Promise<Config | undefined> {
  const config = getConfig(resource);

  if (config.serverUrl === '') {
    const action = await vscode.window.showWarningMessage(
      'ImgBed Uploader：未配置图床地址（imgbedUploader.serverUrl）',
      '打开设置',
    );
    if (action === '打开设置') {
      void vscode.commands.executeCommand(
        'workbench.action.openSettings',
        'imgbedUploader.serverUrl',
      );
    }
    return undefined;
  }

  if (config.authType !== 'none' && !(await hasCredential())) {
    const action = await vscode.window.showWarningMessage(
      'ImgBed Uploader：未配置认证信息（上传认证码 / API Token）',
      '设置认证信息',
    );
    if (action === '设置认证信息') {
      void vscode.commands.executeCommand('imgbed-uploader.setCredentials');
    }
    return undefined;
  }

  return config;
}
