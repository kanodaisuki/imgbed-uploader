import * as vscode from 'vscode';
import { testConnection } from './client';
import { setCredential } from './secrets';
import { ensureReady } from './ui';

// 桩命令：T2~T9 逐个替换为真实实现（T1 设计 §2.3）
function stub(name: string): () => Promise<void> {
  return async () => {
    const config = await ensureReady(
      vscode.window.activeTextEditor?.document.uri,
    );
    if (config === undefined) {
      return;
    }
    void vscode.window.showInformationMessage(`${name}：功能开发中`);
  };
}

async function promptCredential(): Promise<void> {
  const input = await vscode.window.showInputBox({
    prompt: '输入上传认证码或 API Token（保存到 VS Code SecretStorage）',
    password: true,
    ignoreFocusOut: true,
  });
  // 空输入/取消：不写入，不动已存凭据（T1 设计 §3）
  if (input === undefined || input === '') {
    return;
  }
  await setCredential(input);
  void vscode.window.showInformationMessage('ImgBed Uploader：认证信息已保存');
}

// T3 设计：测试连接。提示与可行动作见 T3 设计 §2.4
async function runTestConnection(): Promise<void> {
  const config = await ensureReady(
    vscode.window.activeTextEditor?.document.uri,
  );
  if (config === undefined) {
    return;
  }

  const result = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: '正在测试连接…',
      cancellable: false,
    },
    () => testConnection(config),
  );

  if (result.ok) {
    const action = await vscode.window.showInformationMessage(
      result.detail,
      '复制链接',
    );
    if (action === '复制链接') {
      await vscode.env.clipboard.writeText(result.url);
      // 按钮点击后通知即消失，无反馈像没反应（T3 设计 §2.4）
      vscode.window.setStatusBarMessage('测试文件链接已复制', 3000);
    }
    return;
  }

  // 失败：固定「重新测试」+ 按情形附一个针对性按钮（T3 设计 §2.4）
  let detail = result.detail;
  const buttons = ['重新测试'];
  let settingsQuery: string | undefined;
  if (result.status === 401 || result.status === 403) {
    if (config.authType === 'none') {
      // authType=none 时凭据永不上线，引导录凭据是死胡同（T3 设计 §2.4）
      detail +=
        '（当前 authType=none，若服务端需要认证请改用 authCode/apiToken）';
      settingsQuery = 'imgbedUploader.authType';
      buttons.push('打开设置');
    } else {
      buttons.push('重新设置认证信息');
    }
  } else if (result.code === 'INVALID_SERVER_URL') {
    settingsQuery = 'imgbedUploader.serverUrl';
    buttons.push('打开设置');
  }

  const action = await vscode.window.showErrorMessage(detail, ...buttons);
  if (action === '重新测试') {
    void vscode.commands.executeCommand('imgbed-uploader.testConnection');
  } else if (action === '重新设置认证信息') {
    void vscode.commands.executeCommand('imgbed-uploader.setCredentials');
  } else if (action === '打开设置' && settingsQuery !== undefined) {
    void vscode.commands.executeCommand(
      'workbench.action.openSettings',
      settingsQuery,
    );
  }
}

export function registerCommands(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'imgbed-uploader.setCredentials',
      promptCredential,
    ),
    vscode.commands.registerCommand(
      'imgbed-uploader.uploadAll',
      stub('上传文档全部本地图像'),
    ),
    vscode.commands.registerCommand(
      'imgbed-uploader.uploadSelected',
      stub('上传选定图片'),
    ),
    vscode.commands.registerCommand(
      'imgbed-uploader.uploadFile',
      stub('上传本地图片'),
    ),
    vscode.commands.registerCommand(
      'imgbed-uploader.testConnection',
      runTestConnection,
    ),
  );
}
