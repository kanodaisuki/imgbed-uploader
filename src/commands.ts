import * as vscode from 'vscode';
import { testConnection } from './client';
import { uploadDocument, uploadLocalFiles } from './flow';
import { IMAGE_EXTENSIONS } from './parse';
import { setCredential } from './secrets';
import { ensureReady } from './ui';

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

// T6 设计：文档上传流程（FR-1/2）
async function runUploadAll(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (editor === undefined) {
    void vscode.window.showInformationMessage(
      'ImgBed Uploader：请先打开 Markdown / MDX 文档',
    );
    return;
  }
  await uploadDocument(editor, {});
}

async function runUploadSelected(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (editor === undefined) {
    void vscode.window.showInformationMessage(
      'ImgBed Uploader：请先打开 Markdown / MDX 文档',
    );
    return;
  }
  const doc = editor.document;
  const sel = editor.selection;
  await uploadDocument(editor, {
    selection: { start: doc.offsetAt(sel.start), end: doc.offsetAt(sel.end) },
  });
}

// T7 设计：文件上传（FR-4）。命令面板无参 → 文件选择框；资源管理器 → 菜单参数 (uri, uris)
async function runUploadFile(
  uri?: vscode.Uri,
  uris?: vscode.Uri[],
): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (
    editor === undefined ||
    (editor.document.languageId !== 'markdown' &&
      editor.document.languageId !== 'mdx')
  ) {
    void vscode.window.showInformationMessage(
      'ImgBed Uploader：请先打开 Markdown / MDX 文档',
    );
    return;
  }
  let files = uris ?? (uri !== undefined ? [uri] : undefined);
  if (files === undefined) {
    files = await vscode.window.showOpenDialog({
      canSelectMany: true,
      filters: { 图片: [...IMAGE_EXTENSIONS] },
    });
  }
  if (files === undefined || files.length === 0) {
    return; // 选择框取消/空列表静默退出（T7 §2.6）
  }
  await uploadLocalFiles(editor, files);
}

export function registerCommands(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'imgbed-uploader.setCredentials',
      promptCredential,
    ),
    vscode.commands.registerCommand('imgbed-uploader.uploadAll', runUploadAll),
    vscode.commands.registerCommand(
      'imgbed-uploader.uploadSelected',
      runUploadSelected,
    ),
    vscode.commands.registerCommand(
      'imgbed-uploader.uploadFile',
      runUploadFile,
    ),
    vscode.commands.registerCommand(
      'imgbed-uploader.testConnection',
      runTestConnection,
    ),
  );
}
