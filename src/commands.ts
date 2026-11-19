import * as vscode from 'vscode';
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
      stub('测试连接'),
    ),
  );
}
