// T6 设计：文档上传流程。纯核心（planUploads / runUploads / resolveLocalPath / selfHosts）
// 不碰 vscode API；壳（uploadDocument）接 VS Code。
// 编排：解析 → 过滤/去重 → 读取 → 并发 3 上传 → 重定位回写 → 报告。
// 回写红线（设计 §2.3）：重解析 → 构造 WorkspaceEdit → 调用 applyEdit 为同步原子段，不得夹 await。

import * as path from 'node:path';
import * as vscode from 'vscode';
import { UploadError, upload as clientUpload } from './client';
import { type ImageRef, parseImageRefs } from './parse';
import { buildReplacements, markdownText } from './rewrite';
import { ensureReady, showReport, withUploadLock } from './ui';

// ---------- 数据结构（设计 §3） ----------

export type UploadItem = {
  key: string;
  refs: ImageRef[]; // 同 key 全部引用（去重组）
  source:
    | { type: 'local'; path: string } // 文档形态路径，读取前经 4.8 解析
    | { type: 'remote'; url: string }; // FR-5 转存
};

export type ItemResult =
  | { key: string; ok: true; url: string }
  | { key: string; ok: false; error: string };

export type PlanResult = {
  items: UploadItem[]; // 文档顺序派发
  skipped: { key: string; reason: string }[]; // 跳过明细进 Output Channel
};

// ---------- 纯核心 ----------

const intersects = (
  a: { start: number; end: number },
  b: { start: number; end: number },
): boolean => a.start < b.end && b.start < a.end;

// FR-2 判定区间（设计 §2.6）：inline/html 按 URL 区间，refdef 另含全部图片式引用区间
function inSelection(
  ref: ImageRef,
  sel: { start: number; end: number },
): boolean {
  if (intersects({ start: ref.urlStart, end: ref.urlEnd }, sel)) {
    return true;
  }
  return (ref.useSpans ?? []).some((s) => intersects(s, sel));
}

// 5.4 hostname 精确等值（trim + 小写容错，不支持子域）
function isWhitelisted(host: string, whitelist: string[]): boolean {
  const h = host.trim().toLowerCase();
  return whitelist.some((e) => e.trim().toLowerCase() === h);
}

// 已回写自识别（设计 §2.2）：serverUrl/customCdn 的 hostname；customCdn 无 scheme 补 https:// 再解析
export function selfHosts(serverUrl: string, customCdn: string): string[] {
  const hosts: string[] = [];
  for (const raw of [serverUrl, customCdn]) {
    if (raw.trim() === '') {
      continue;
    }
    const url = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(raw)
      ? raw
      : `https://${raw}`;
    try {
      const host = new URL(url).hostname.toLowerCase();
      if (host !== '' && !hosts.includes(host)) {
        hosts.push(host);
      }
    } catch {
      // 非法 URL 形态忽略（serverUrl 有 T2 预校验，customCdn 不拦）
    }
  }
  return hosts;
}

// 纯：onlyKeys 过滤（重试）→ 选区过滤（FR-2）→ 远程策略（自识别 → 白名单 → 转存）→ 去重分组（设计 §2.2/§2.6）
export function planUploads(
  refs: ImageRef[],
  opts: {
    selection?: { start: number; end: number };
    uploadRemoteImages: boolean;
    remoteWhitelist: string[];
    selfHosts: string[];
    onlyKeys?: Set<string>; // 「重试失败项」：只计划这些 key（不入计划的不计跳过）
  },
): PlanResult {
  const skipped = new Map<string, string>();
  const items: UploadItem[] = [];
  const byKey = new Map<string, UploadItem>();

  for (const ref of refs) {
    if (opts.onlyKeys !== undefined && !opts.onlyKeys.has(ref.key)) {
      continue; // 不入计划的不计跳过（设计 §2.5）
    }
    if (opts.selection !== undefined && !inSelection(ref, opts.selection)) {
      continue; // 选区外不计跳过（设计 §2.5）
    }
    if (ref.target.type === 'remote') {
      const host = ref.target.host.trim().toLowerCase();
      let reason: string | undefined;
      if (opts.selfHosts.includes(host)) {
        reason = '已回写链接，幂等跳过';
      } else if (!opts.uploadRemoteImages) {
        reason = '远程图像跳过（未开启转存）';
      } else if (isWhitelisted(host, opts.remoteWhitelist)) {
        reason = '命中白名单跳过';
      }
      if (reason !== undefined) {
        if (!skipped.has(ref.key)) {
          skipped.set(ref.key, reason);
        }
        continue;
      }
    }
    let item = byKey.get(ref.key);
    if (item === undefined) {
      item = {
        key: ref.key,
        refs: [],
        source:
          ref.target.type === 'local'
            ? { type: 'local', path: ref.target.path }
            : { type: 'remote', url: ref.target.url },
      };
      byKey.set(ref.key, item);
      items.push(item);
    }
    item.refs.push(ref);
  }
  return {
    items,
    skipped: [...skipped].map(([key, reason]) => ({ key, reason })),
  };
}

// 纯：4.8 路径解析。绝对路径（含 Windows 盘符/UNC）直接使用；untitled（docDir 缺省）相对路径无法解析
export function resolveLocalPath(
  docDir: string | undefined,
  p: string,
): { ok: true; path: string } | { ok: false; error: string } {
  const isAbs =
    path.isAbsolute(p) || /^[A-Za-z]:[\\/]/.test(p) || p.startsWith('\\\\');
  if (isAbs) {
    return { ok: true, path: path.normalize(p) };
  }
  if (docDir === undefined) {
    return { ok: false, error: '未保存文档无法解析相对路径，请先保存文档' };
  }
  return { ok: true, path: path.resolve(docDir, p) };
}

const baseName = (p: string): string => p.split(/[\\/]/).pop() ?? p;

// 纯：并发 N（默认 3）、进度/取消钩子、结果聚合（T6 §2.4/§2.5；并发参数化见 T7 §2.3）。
// 返回仅含已尝试项（item 顺序）；未派发数 = items.length - results.length（取消未开始）。
export async function runUploads(
  items: UploadItem[],
  io: {
    readLocal(path: string): Promise<Uint8Array>;
    downloadRemote(url: string): Promise<{ name: string; data: Uint8Array }>;
    upload(file: { name: string; data: Uint8Array }): Promise<{ url: string }>;
  },
  hooks: {
    onProgress(done: number, total: number): void;
    isCancelled(): boolean;
  },
  concurrency = 3,
): Promise<ItemResult[]> {
  const results: (ItemResult | undefined)[] = new Array(items.length);
  let next = 0;
  let done = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      if (hooks.isCancelled()) {
        return; // 取消只停派发，in-flight 不 abort（设计 §2.4）
      }
      const i = next;
      next += 1;
      if (i >= items.length) {
        return;
      }
      const item = items[i];
      try {
        const file =
          item.source.type === 'local'
            ? {
                name: baseName(item.source.path),
                data: await io.readLocal(item.source.path),
              }
            : await io.downloadRemote(item.source.url);
        const { url } = await io.upload(file);
        results[i] = { key: item.key, ok: true, url };
      } catch (err) {
        results[i] = {
          key: item.key,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
      done += 1;
      hooks.onProgress(done, items.length);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));
  return results.filter((r): r is ItemResult => r !== undefined);
}

// 纯：FR-4 插入细则（T7 §2.2）→ 单个插入点，一次编辑。
// 空行（含纯缩进）就地：首链接落行尾（行首前缀保留），其余逐行向下；
// 非空行（含标记行）下一行独立一行，前缀 = 内容列前全部字符原样复制；EOL 跟随文档。
export function planFileInsert(
  text: string,
  cursorLine: number,
  links: string[],
): { offset: number; insert: string } {
  if (links.length === 0) {
    return { offset: 0, insert: '' };
  }
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lineStarts: number[] = [0];
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '\n') {
      lineStarts.push(i + 1);
    }
  }
  const line = Math.max(0, Math.min(cursorLine, lineStarts.length - 1));
  const start = lineStarts[line];
  const nextStart = lineStarts[line + 1];
  let contentEnd = nextStart ?? text.length;
  if (nextStart !== undefined && text[contentEnd - 1] === '\n') {
    contentEnd -= 1;
    if (text[contentEnd - 1] === '\r') {
      contentEnd -= 1;
    }
  }
  const content = text.slice(start, contentEnd);

  if (content.trim() === '') {
    // 空行就地：纯追加零删除（T7 §2.2 红线）
    const prefix = content;
    return {
      offset: contentEnd,
      insert: links.map((l, i) => (i === 0 ? l : prefix + l)).join(eol),
    };
  }

  // 非空行（含 `- ` 等标记行）：前缀 = 行首空白 + > 引用链 + 列表 marker（T7 §2.2）
  const prefix =
    /^[\t ]*(?:>[\t ]*)*(?:(?:[-*+]|\d+[.)])[\t ]+)?/.exec(content)?.[0] ?? '';
  const block = links.map((l) => prefix + l).join(eol);
  if (nextStart !== undefined) {
    return { offset: nextStart, insert: block + eol };
  }
  return { offset: text.length, insert: eol + block };
}

// ---------- vscode 壳（设计 §2.1/§2.3） ----------

// 字符串绝对路径 → Uri：以文档 uri 为 base 派生，保 scheme/authority（远程工作区兼容，设计 §2.7）
function toUri(base: vscode.Uri, absPath: string): vscode.Uri {
  if (base.scheme === 'untitled') {
    return vscode.Uri.file(absPath);
  }
  const p = absPath.replace(/\\/g, '/');
  return base.with({ path: /^[A-Za-z]:/.test(p) ? `/${p}` : p });
}

export async function uploadDocument(
  editor: vscode.TextEditor,
  opts: {
    selection?: { start: number; end: number };
    onlyKeys?: Set<string>; // 「重试失败项」只跑失败 key
  },
): Promise<void> {
  const doc = editor.document;
  const config = await ensureReady(doc.uri);
  if (config === undefined) {
    return;
  }

  await withUploadLock(async () => {
    const sel = opts.selection;
    const { refs, skipped: suspicious } = parseImageRefs(doc.getText());
    const suspiciousInScope = suspicious.filter(
      (s) => sel === undefined || intersects(s, sel),
    );

    const plan = planUploads(refs, {
      selection: sel,
      uploadRemoteImages: config.uploadRemoteImages,
      remoteWhitelist: config.remoteWhitelist,
      selfHosts: selfHosts(config.serverUrl, config.customCdn),
      onlyKeys: opts.onlyKeys,
    });

    // 计划分三种（设计 §6）：范围内什么都没有 → 提示退出；重试除外（走报告注明实试 0 项）
    if (
      opts.onlyKeys === undefined &&
      plan.items.length === 0 &&
      plan.skipped.length === 0 &&
      suspiciousInScope.length === 0
    ) {
      void vscode.window.showInformationMessage(
        sel === undefined
          ? 'ImgBed Uploader：未找到图像引用'
          : 'ImgBed Uploader：选区未找到图像引用',
      );
      return;
    }

    const docDir =
      doc.uri.scheme === 'untitled' ? undefined : path.dirname(doc.uri.fsPath);
    let authError = false;
    const results = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `ImgBed Uploader：正在上传图片（共 ${plan.items.length} 项）`,
        cancellable: true,
      },
      (progress, token) =>
        runUploads(
          plan.items,
          {
            readLocal: async (p) => {
              const resolved = resolveLocalPath(docDir, p);
              if (!resolved.ok) {
                throw new Error(resolved.error);
              }
              try {
                return await vscode.workspace.fs.readFile(
                  toUri(doc.uri, resolved.path),
                );
              } catch {
                throw new Error(`文件不存在或不可读：${p}`);
              }
            },
            // T6 期抛错桩：转存默认关闭不可达，T10 以 download.ts 替换（设计 §3）
            downloadRemote: async () => {
              throw new Error('远程图像转存尚未实现（T10）');
            },
            upload: async (file) => {
              try {
                return await clientUpload(file, config);
              } catch (err) {
                if (
                  err instanceof UploadError &&
                  (err.status === 401 || err.status === 403)
                ) {
                  authError = true;
                }
                throw err;
              }
            },
          },
          {
            onProgress: (d, t) =>
              progress.report({ message: `第 ${d}/${t} 张` }),
            isCancelled: () => token.isCancellationRequested,
          },
        ),
    );

    // 回写竞态（设计 §2.3）：重解析 → 构造 → 调用 applyEdit 为同步原子段，不得夹 await
    const succeeded = new Map<string, string>();
    for (const r of results) {
      if (r.ok) {
        succeeded.set(r.key, r.url);
      }
    }
    const rewriteCounts = new Map<string, number>();
    if (succeeded.size > 0) {
      const fresh = parseImageRefs(doc.getText()).refs.filter((r) =>
        succeeded.has(r.key),
      );
      for (const r of fresh) {
        rewriteCounts.set(r.key, (rewriteCounts.get(r.key) ?? 0) + 1);
      }
      const reps = buildReplacements(fresh, succeeded);
      if (reps.length > 0) {
        const edit = new vscode.WorkspaceEdit();
        for (const rep of reps) {
          edit.replace(
            doc.uri,
            new vscode.Range(
              doc.positionAt(rep.start),
              doc.positionAt(rep.end),
            ),
            rep.text,
          );
        }
        await vscode.workspace.applyEdit(edit); // 调用已在原子段内，await 只等结果
      }
    }

    // 报告（设计 §2.5）：计数按上传项，明细注明回写处数；可疑跳过计入失败 m
    const details: string[] = [];
    for (const r of results) {
      if (r.ok) {
        const n = rewriteCounts.get(r.key) ?? 0;
        details.push(
          `成功：${r.key} → ${r.url}${n > 1 ? `（回写 ${n} 处）` : ''}`,
        );
      } else {
        details.push(`失败：${r.key} — ${r.error}`);
      }
    }
    for (const s of plan.skipped) {
      details.push(`跳过：${s.key} — ${s.reason}`);
    }
    const notStarted = plan.items.length - results.length;
    if (notStarted > 0) {
      details.push(`跳过：${notStarted} 项未开始（已取消）`);
    }
    for (const s of suspiciousInScope) {
      details.push(
        `可疑：第 ${doc.positionAt(s.start).line + 1} 行 — ${s.reason}`,
      );
    }
    const failedKeys = results.filter((r) => !r.ok).map((r) => r.key);
    showReport(
      {
        succeeded: succeeded.size,
        failed: results.length - succeeded.size + suspiciousInScope.length,
        skipped: plan.skipped.length + notStarted,
      },
      details,
      {
        // 按钮仅当失败含可重试 key 显示（设计 §2.5）；回调在锁外执行（showReport 不阻塞）
        retry:
          failedKeys.length > 0
            ? {
                keys: failedKeys,
                run: (keys) =>
                  uploadDocument(editor, { onlyKeys: new Set(keys) }),
              }
            : undefined,
        authError,
      },
    );
  });
}

// 壳：FR-4 文件上传（T7 设计 §2）：逐个上传（runUploads 并发 1）→ 单次编辑插入 → 报告。
// 文件读取直读原始 Uri（fsPath→Uri 映射，不经 doc.uri 派生，§2.3）；
// 插入段走 isClosed 关卡 + 同步原子段（§2.2，主流程与重试同一道关卡）。
export async function uploadLocalFiles(
  editor: vscode.TextEditor,
  uris: vscode.Uri[],
): Promise<void> {
  if (uris.length === 0) {
    return; // 空列表静默退出（T7 §2.6）
  }
  const doc = editor.document;
  const config = await ensureReady(doc.uri);
  if (config === undefined) {
    return;
  }

  await withUploadLock(async () => {
    const uriByPath = new Map(uris.map((u) => [u.fsPath, u]));
    const items: UploadItem[] = uris.map((u) => ({
      key: u.fsPath,
      refs: [],
      source: { type: 'local', path: u.fsPath },
    }));

    let authError = false;
    const results = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `ImgBed Uploader：正在上传图片（共 ${items.length} 项）`,
        cancellable: true,
      },
      (progress, token) =>
        runUploads(
          items,
          {
            readLocal: async (p) => {
              const uri = uriByPath.get(p);
              if (uri === undefined) {
                throw new Error(`文件不存在或不可读：${p}`);
              }
              try {
                return await vscode.workspace.fs.readFile(uri);
              } catch {
                throw new Error(`文件不存在或不可读：${p}`);
              }
            },
            downloadRemote: async () => {
              throw new Error('不适用（FR-4 仅本地文件）');
            },
            upload: async (file) => {
              try {
                return await clientUpload(file, config);
              } catch (err) {
                if (
                  err instanceof UploadError &&
                  (err.status === 401 || err.status === 403)
                ) {
                  authError = true;
                }
                throw err;
              }
            },
          },
          {
            onProgress: (d, t) =>
              progress.report({ message: `第 ${d}/${t} 张` }),
            isCancelled: () => token.isCancellationRequested,
          },
          1, // FR-4「逐个上传」（T7 §2.3）
        ),
    );

    const links: string[] = [];
    const failedKeys: string[] = [];
    for (const r of results) {
      if (r.ok) {
        links.push(`![](${markdownText(r.url)})`);
      } else {
        failedKeys.push(r.key);
      }
    }

    // 插入段（T7 §2.2）：isClosed 关卡 → 插入时取值 → planFileInsert → applyEdit 同步原子段，不得夹 await
    if (doc.isClosed) {
      void vscode.window.showWarningMessage(
        'ImgBed Uploader：文档已关闭，链接未插入',
      );
    } else if (links.length > 0) {
      const plan = planFileInsert(
        doc.getText(),
        editor.selection.active.line,
        links,
      );
      if (plan.insert !== '') {
        const edit = new vscode.WorkspaceEdit();
        edit.insert(doc.uri, doc.positionAt(plan.offset), plan.insert);
        await vscode.workspace.applyEdit(edit); // 调用已在原子段内，await 只等结果
      }
    }

    // 报告（4.4，计数按文件）
    const notStarted = items.length - results.length;
    const details: string[] = [];
    for (const r of results) {
      details.push(
        r.ok ? `成功：${r.key} → ${r.url}` : `失败：${r.key} — ${r.error}`,
      );
    }
    if (notStarted > 0) {
      details.push(`跳过：${notStarted} 项未开始（已取消）`);
    }
    const failed = results.filter((r) => !r.ok).length;
    showReport(
      { succeeded: results.length - failed, failed, skipped: notStarted },
      details,
      {
        retry:
          failedKeys.length > 0
            ? {
                keys: failedKeys,
                run: async (keys) => {
                  // 重试前置关卡（T7 §2.5）：不为已关闭文档白传
                  if (editor.document.isClosed) {
                    void vscode.window.showWarningMessage(
                      'ImgBed Uploader：文档已关闭，请重新执行命令',
                    );
                    return;
                  }
                  await uploadLocalFiles(
                    editor,
                    keys
                      .map((k) => uriByPath.get(k))
                      .filter((u): u is vscode.Uri => u !== undefined),
                  );
                },
              }
            : undefined,
        authError,
      },
    );
  });
}
