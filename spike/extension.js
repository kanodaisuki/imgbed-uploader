// T0 spike：验证 DocumentPasteEditProvider 粘贴接管路线（验证后整体删除）
const vscode = require('vscode');
const fs = require('fs');
const path = require('path');

const LOG_FILE = path.join(__dirname, 'spike-log.jsonl');
const MOCK_URL = 'http://127.0.0.1:9099/upload';

const MODES = {
  log: '只记录数据并返回 undefined（观察默认回落）',
  upload: '上传 mock 并返回链接 edit（观察等待/插入/撤销）',
  delay: '延迟 5s 后上传（观察等待期反馈）',
  fail: '上传 mock 返回 400（观察失败回落 + 提示时机）',
  throw: 'provider 直接抛错（观察错误回落）',
  hang: 'provider 永不返回（观察粘贴挂起，慎用，只能重启窗口恢复）',
};

let mode = 'log';
let yieldToOn = true;
let channel;

function log(entry) {
  const rec = { t: new Date().toISOString(), mode, yieldToOn, ...entry };
  try { channel.appendLine(JSON.stringify(rec)); } catch { /* channel 未就绪 */ }
  try { fs.appendFileSync(LOG_FILE, JSON.stringify(rec) + '\n'); } catch { /* 日志失败不影响验证 */ }
}

// 取图片字节：DataTransferItem 稳定 API 只有 asFile().data() 一条拿二进制的路
async function collectItems(dataTransfer) {
  const items = [];
  for (const [mime, item] of dataTransfer) {
    const info = { mime };
    const file = item.asFile();
    if (file) {
      info.isFile = true;
      info.fileName = file.name;
      const bytes = await file.data();
      info.bytes = bytes.length;
      info._bytes = bytes;
    } else {
      info.isFile = false;
      try { info.text = (await item.asString()).slice(0, 200); } catch { info.text = '<unreadable>'; }
    }
    items.push(info);
  }
  return items;
}

async function uploadToMock(bytes, name, query) {
  const form = new FormData();
  form.append('file', new Blob([bytes]), name);
  const res = await fetch(MOCK_URL + query, { method: 'POST', body: form });
  const body = await res.text();
  return { status: res.status, body };
}

function makeEdit(text) {
  try {
    return new vscode.DocumentPasteEdit(text, '上传到图床（spike）');
  } catch {
    return { insertText: text, title: '上传到图床（spike）' };
  }
}

async function provideDocumentPasteEdits(document, ranges, dataTransfer, context, token) {
  const start = Date.now();
  const items = await collectItems(dataTransfer);
  log({
    ev: 'provide.start',
    lang: document.languageId,
    trigger: context.triggerKind,
    only: context.only ? context.only.value : null,
    ranges: ranges.map((r) => `${r.start.line}:${r.start.character}-${r.end.line}:${r.end.character}`),
    items: items.map(({ _bytes, ...rest }) => rest),
  });

  // 优先 image/* 文件项；其次 image/* 非文件项（拿不到字节也要记录）；再次 files 型
  const img = items.find((i) => i.mime.startsWith('image/') && i.isFile)
    || items.find((i) => i.mime.startsWith('image/'))
    || items.find((i) => i.isFile);

  if (!img || !img._bytes) {
    log({ ev: 'provide.noImageBytes', ms: Date.now() - start });
    return undefined;
  }

  if (mode === 'log') {
    log({ ev: 'provide.modeLog', ms: Date.now() - start });
    return undefined;
  }
  if (mode === 'throw') {
    log({ ev: 'provide.throw', ms: Date.now() - start });
    throw new Error('spike: 强制抛错，验证错误回落');
  }
  if (mode === 'hang') {
    log({ ev: 'provide.hang', ms: Date.now() - start });
    return new Promise(() => { /* 永不返回 */ });
  }

  const query = mode === 'delay' ? '?delay=5000' : mode === 'fail' ? '?fail=1' : '';
  try {
    const result = await uploadToMock(img._bytes, img.fileName || 'paste.png', query);
    log({ ev: 'upload.done', ...result, ms: Date.now() - start });
    if (result.status !== 200) {
      // 失败：提示原因后放弃 edit，回落默认粘贴（V4）
      vscode.window.showWarningMessage(`Spike 上传失败（${result.status}），回落默认粘贴：${result.body}`);
      log({ ev: 'provide.fallbackAfterFail', ms: Date.now() - start });
      return undefined;
    }
    const url = JSON.parse(result.body).publicUrl;
    const edit = makeEdit(`![](${url})`);
    if (yieldToOn && vscode.DocumentDropOrPasteEditKind) {
      try { edit.yieldTo = [new vscode.DocumentDropOrPasteEditKind('markdown.image')]; } catch { /* 构造失败忽略 */ }
    }
    log({ ev: 'provide.edit', url, ms: Date.now() - start });
    return [edit];
  } catch (err) {
    vscode.window.showWarningMessage(`Spike 上传异常，回落默认粘贴：${err.message}`);
    log({ ev: 'provide.error', err: String(err), ms: Date.now() - start });
    return undefined;
  }
}

function activate(context) {
  channel = vscode.window.createOutputChannel('Spike');
  log({
    ev: 'activate',
    vscodeVersion: vscode.version,
    hasProviderApi: typeof vscode.languages.registerDocumentPasteEditProvider === 'function',
  });

  const selector = [{ language: 'markdown' }, { language: 'mdx' }];
  const metadata = {
    pasteMimeTypes: ['image/*', 'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'text/uri-list', 'files', 'text/plain'],
  };
  context.subscriptions.push(
    vscode.languages.registerDocumentPasteEditProvider(selector, { provideDocumentPasteEdits }, metadata),
  );

  // 观察回落路径：默认粘贴插入的文本 / 落盘的图片文件
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((e) => {
      const texts = e.contentChanges.map((c) => JSON.stringify(c.text.slice(0, 120)));
      log({ ev: 'doc.changed', uri: e.document.uri.toString(), changes: texts });
    }),
    vscode.workspace.onDidCreateFiles((e) => {
      log({ ev: 'file.created', files: e.files.map((f) => f.fsPath) });
    }),
    vscode.commands.registerCommand('spike.setMode', async () => {
      const picked = await vscode.window.showQuickPick(
        Object.entries(MODES).map(([k, v]) => ({ label: k, description: v })),
        { placeHolder: `当前模式：${mode}` },
      );
      if (picked) { mode = picked.label; log({ ev: 'mode.set', newMode: mode }); }
    }),
    vscode.commands.registerCommand('spike.toggleYieldTo', () => {
      yieldToOn = !yieldToOn;
      log({ ev: 'yieldTo.toggle', yieldToOn });
      vscode.window.showInformationMessage(`Spike yieldTo：${yieldToOn ? '开' : '关'}`);
    }),
    vscode.commands.registerCommand('spike.openLog', () => vscode.window.showTextDocument(vscode.Uri.file(LOG_FILE))),
    vscode.commands.registerCommand('spike.clearLog', () => {
      fs.writeFileSync(LOG_FILE, '');
      log({ ev: 'log.cleared' });
    }),
  );
}

function deactivate() { }

module.exports = { activate, deactivate };
