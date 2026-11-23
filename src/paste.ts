import * as vscode from 'vscode';
import { UploadError, upload } from './client';
import { type Config, getConfig } from './config';
import { markdownText } from './rewrite';
import { hasCredential } from './secrets';

// T9 设计：粘贴接管（FR-3）。DocumentPasteEditProvider 单段式（设计 §2.2）。
// 纯函数（文件名/链接/碰撞改名）不触 vscode；vscode 壳负责注册与管线（设计 §3）。

// ---- 纯函数 ----

const MIME_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/svg+xml': 'svg',
  'image/bmp': 'bmp',
  'image/x-icon': 'ico',
};

// 设计 §2.7：sourceName 仅"复制的文件"（存在 text/uri-list）传原名，截图传 undefined 生成 paste-* 名
export function pasteFileName(
  now: Date,
  sourceName: string | undefined,
  mime: string,
): string {
  if (sourceName !== undefined && sourceName !== '') {
    return sourceName;
  }
  const p2 = (n: number): string => String(n).padStart(2, '0');
  const stamp =
    `${now.getFullYear()}${p2(now.getMonth() + 1)}${p2(now.getDate())}` +
    `-${p2(now.getHours())}${p2(now.getMinutes())}${p2(now.getSeconds())}`;
  return `paste-${stamp}.${MIME_EXT[mime] ?? 'png'}`;
}

export function mdImageLink(url: string): string {
  return `![](${markdownText(url)})`;
}

// 两段路径统一 / 分段比较拼相对段；不同盘/根返回 null（调用方退绝对路径）
function relPath(from: string, to: string): string | null {
  const f = from.replace(/\\/g, '/').replace(/\/+$/, '').split('/');
  const t = to.replace(/\\/g, '/').replace(/\/+$/, '').split('/');
  let i = 0;
  while (
    i < f.length &&
    i < t.length &&
    f[i]?.toLowerCase() === t[i]?.toLowerCase()
  ) {
    i++;
  }
  if (i === 0) {
    return null;
  }
  return [...f.slice(i).map(() => '..'), ...t.slice(i)].join('/');
}

// 设计 §3：docDir 为 undefined（untitled）→ 绝对路径（另存后不失联，§2.3）
export function localImageLink(
  docDir: string | undefined,
  filePath: string,
): string {
  const rel = docDir === undefined ? null : relPath(docDir, filePath);
  if (rel === null) {
    return mdImageLink(filePath.replace(/\\/g, '/'));
  }
  return mdImageLink(rel.startsWith('..') ? rel : `./${rel}`);
}

// 设计 §3：name 被占用时依次试 name-1、name-2…（exists 注入，纯函数）
export function resolveCollision(
  name: string,
  exists: (name: string) => boolean,
): string {
  if (!exists(name)) {
    return name;
  }
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  for (let i = 1; i < 999; i++) {
    const candidate = `${base}-${i}${ext}`;
    if (!exists(candidate)) {
      return candidate;
    }
  }
  return `${base}-999${ext}`;
}

// 设计 流程 6：多张一行一张按序拼；全部未产出链接 → undefined（变更记录 1）
export function buildInsertText(links: string[]): string | undefined {
  return links.length === 0 ? undefined : links.join('\n');
}

// ---- vscode 壳 ----

// spike 验证过的宽列表，字面钉死（设计 §2.1：spike/ 删除后不随之丢失）
const PASTE_MIME_TYPES: readonly string[] = [
  'image/*',
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'text/uri-list',
  'files',
  'text/plain',
];

const PASTE_KIND = vscode.DocumentDropOrPasteEditKind.Empty.append(
  'markdown',
  'image',
);

type PasteImage = {
  sourceName: string | undefined; // 仅"复制的文件"有可信原名（设计 §2.7）
  mime: string;
  data: Uint8Array;
};

// 设计 §2.7：取全部 image/* 文件项；text/uri-list 存在 = "复制的文件"（截图的合成名不可信）
async function collectImages(
  dataTransfer: vscode.DataTransfer,
): Promise<PasteImage[]> {
  const hasUriList = dataTransfer.get('text/uri-list') !== undefined;
  const images: PasteImage[] = [];
  for (const [mime, item] of dataTransfer) {
    if (!mime.startsWith('image/')) {
      continue;
    }
    const file = item.asFile();
    if (file === undefined) {
      continue;
    }
    images.push({
      sourceName: hasUriList && file.name !== '' ? file.name : undefined,
      mime,
      data: await file.data(),
    });
  }
  return images;
}

function errText(err: unknown): string {
  // UploadError.message 原样透传（4.9），非 UploadError 兜底 String（设计 §2.6）
  return err instanceof UploadError ? err.message : String(err);
}

// fire-and-forget：不 await 用户操作、不阻塞粘贴返回（设计 §2.3）
function warn(text: string): void {
  void vscode.window.showWarningMessage(`ImgBed Uploader：${text}`);
}

// 未配置提示（设计 §2.4）：带设置动作、一次粘贴一条，动作回调里执行不阻塞
function warnUnconfigured(cfg: Config): void {
  const missing = cfg.serverUrl === '' ? '图床地址' : '认证信息';
  const action = cfg.serverUrl === '' ? '打开设置' : '设置认证信息';
  void vscode.window
    .showWarningMessage(
      `ImgBed Uploader：粘贴上传失败：未配置${missing}，图片将转存到工作区`,
      action,
    )
    .then((picked) => {
      if (picked === '打开设置') {
        void vscode.commands.executeCommand(
          'workbench.action.openSettings',
          'imgbedUploader.serverUrl',
        );
      } else if (picked === '设置认证信息') {
        void vscode.commands.executeCommand('imgbed-uploader.setCredentials');
      }
    });
}

// 设计 §2.3：降级落盘——文档所在目录；untitled → workspaceFolders[0] 根。
// 返回本地链接；落盘失败提示后返回 undefined（该张不产出链接）
async function fallbackSave(
  document: vscode.TextDocument,
  name: string,
  data: Uint8Array,
): Promise<string | undefined> {
  const isUntitled = document.uri.scheme === 'untitled';
  const dir = isUntitled
    ? vscode.workspace.workspaceFolders?.[0]?.uri
    : vscode.Uri.joinPath(document.uri, '..');
  if (dir === undefined) {
    warn('无法保存图片：请先保存文档或打开工作区');
    return undefined;
  }
  try {
    let occupied = new Set<string>();
    try {
      occupied = new Set(
        (await vscode.workspace.fs.readDirectory(dir)).map(([n]) => n),
      );
    } catch {
      // 目录读不了按空集，写入失败再报
    }
    const target = vscode.Uri.joinPath(
      dir,
      resolveCollision(name, (n) => occupied.has(n)),
    );
    await vscode.workspace.fs.writeFile(target, data);
    return localImageLink(isUntitled ? undefined : dir.fsPath, target.fsPath);
  } catch (err) {
    warn(`无法保存图片：${errText(err)}`);
    return undefined;
  }
}

async function provideDocumentPasteEdits(
  document: vscode.TextDocument,
  _ranges: readonly vscode.Range[],
  dataTransfer: vscode.DataTransfer,
  _context: vscode.DocumentPasteEditContext,
  token: vscode.CancellationToken,
): Promise<vscode.DocumentPasteEdit[] | undefined> {
  try {
    const images = await collectImages(dataTransfer);
    if (images.length === 0) {
      return undefined;
    }

    const cfg = getConfig(document.uri);
    if (!cfg.pasteUpload) {
      return undefined; // 设计 §2.4：关闭走真默认
    }

    const ready =
      cfg.serverUrl !== '' &&
      (cfg.authType === 'none' || (await hasCredential()));
    if (!ready) {
      warnUnconfigured(cfg); // 一次粘贴一条（设计 §2.4）
    }

    const usedNames = new Set<string>();
    const links: string[] = [];
    for (const img of images) {
      if (token.isCancellationRequested) {
        return undefined; // 设计 §2.5：发起上传前也查
      }
      const name = resolveCollision(
        pasteFileName(new Date(), img.sourceName, img.mime),
        (n) => usedNames.has(n),
      );
      usedNames.add(name);
      let link: string | undefined;
      if (ready) {
        try {
          const { url } = await upload({ name, data: img.data }, cfg);
          link = mdImageLink(url);
        } catch (err) {
          if (token.isCancellationRequested) {
            return undefined; // 临界 Esc 不留弹窗（设计 §2.5）
          }
          warn(`粘贴上传失败：${errText(err)}`); // 异常自 catch 自提示（设计 §2.6）
          link = await fallbackSave(document, name, img.data);
        }
      } else {
        link = await fallbackSave(document, name, img.data);
      }
      if (link !== undefined) {
        links.push(link);
      }
    }
    if (token.isCancellationRequested) {
      return undefined;
    }
    const text = buildInsertText(links);
    if (text === undefined) {
      return undefined; // 全部未产出链接（设计 流程 6）
    }
    return [new vscode.DocumentPasteEdit(text, '上传到图床', PASTE_KIND)];
  } catch (err) {
    // provider 异常会被 VS Code 静默吞掉（设计 §2.6）：兜底提示
    warn(`粘贴处理异常：${errText(err)}`);
    return undefined;
  }
}

// 设计 §3：注册 provider（extension.ts 装配调用，与 registerCommands 同款）
export function registerPasteProvider(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.languages.registerDocumentPasteEditProvider(
      [{ language: 'markdown' }, { language: 'mdx' }],
      { provideDocumentPasteEdits },
      {
        providedPasteEditKinds: [PASTE_KIND],
        pasteMimeTypes: PASTE_MIME_TYPES,
      },
    ),
  );
}
