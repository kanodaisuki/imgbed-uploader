// T11 集成测试（docs/design/T11-集成测试.md §2.5 矩阵）：mock 图床 + 真实命令端到端。
// 打桩在本外层 suite 生命周期内启用（假 OutputChannel 是单例，设计 §2.2/§2.4）。
import * as assert from 'assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { type Mock, TEST_PNG, startMock } from './mockImgbed';
import { type Notifier, stubNotifications } from './notifications';

type TestHooks = {
  setCredential(secret: string): Promise<void>;
  clearCredential(): Promise<void>;
  hasCredential(): Promise<boolean>;
  useMemorySecrets(): void;
};

suite('T11 集成测试（mock 图床端到端）', () => {
  let mock: Mock;
  let notify: Notifier;
  let hooks: TestHooks;
  let tmp: string;
  const savedCfg = new Map<string, unknown>();
  const CFG_KEYS = [
    'serverUrl',
    'customCdn',
    'uploadRemoteImages',
    'remoteWhitelist',
  ];

  // ---------- 基建 ----------

  async function configure(overrides: Record<string, unknown>): Promise<void> {
    const cfg = vscode.workspace.getConfiguration('imgbedUploader');
    const values: Record<string, unknown> = {
      serverUrl: mock.urls.server,
      customCdn: `http://localhost:${mock.port}/cdn/`,
      uploadRemoteImages: false,
      remoteWhitelist: [],
      ...overrides,
    };
    for (const [key, value] of Object.entries(values)) {
      await cfg.update(key, value, vscode.ConfigurationTarget.Global);
    }
  }

  const cdn = (name: string): string =>
    `http://localhost:${mock.port}/cdn/${name}`;
  const summary = (s: number, f: number, k: number): string =>
    `ImgBed Uploader：成功 ${s} 项、失败 ${f} 项、跳过 ${k} 项`;
  const uploadAll = (): Thenable<unknown> =>
    vscode.commands.executeCommand('imgbed-uploader.uploadAll');

  function writePng(rel: string): vscode.Uri {
    const p = path.join(tmp, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, Buffer.from(TEST_PNG));
    return vscode.Uri.file(p);
  }

  async function openMd(
    name: string,
    content: string,
  ): Promise<vscode.TextEditor> {
    const p = path.join(tmp, name);
    fs.writeFileSync(p, content, 'utf8');
    return vscode.window.showTextDocument(
      await vscode.workspace.openTextDocument(p),
    );
  }

  // 不经 openTextDocument（会持模型引用、isClosed 永不翻转）——贴合用户真实打开路径
  async function openMdViaCommand(
    name: string,
    content: string,
  ): Promise<vscode.TextEditor> {
    const p = path.join(tmp, name);
    fs.writeFileSync(p, content, 'utf8');
    const uri = vscode.Uri.file(p);
    await vscode.commands.executeCommand('vscode.open', uri);
    await waitUntil(
      () =>
        vscode.window.activeTextEditor?.document.uri.toString() ===
        uri.toString(),
      '编辑器打开',
    );
    return vscode.window.activeTextEditor as vscode.TextEditor;
  }

  async function waitUntil(
    cond: () => boolean,
    what: string,
    ms = 10_000,
  ): Promise<void> {
    const start = Date.now();
    while (!cond()) {
      if (Date.now() - start > ms) {
        throw new Error(`waitUntil 超时：${what}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  async function closeEditors(): Promise<void> {
    // 脏文档 / untitled 会弹保存模态，必须走 revertAndClose（设计 §6）
    for (
      let i = 0;
      i < 10 && vscode.window.activeTextEditor !== undefined;
      i += 1
    ) {
      await vscode.commands.executeCommand(
        'workbench.action.revertAndCloseActiveEditor',
      );
    }
  }

  suiteSetup(async () => {
    notify = stubNotifications(); // 先打桩再激活扩展（设计 §2.2）
    mock = await startMock();
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'imgbed-it-'));
    const cfg = vscode.workspace.getConfiguration('imgbedUploader');
    for (const key of CFG_KEYS) {
      savedCfg.set(key, cfg.inspect(key)?.globalValue);
    }
    const ext = vscode.extensions.getExtension<TestHooks>(
      'kanodaisuki.imgbed-uploader',
    );
    assert.ok(ext, '未找到扩展 kanodaisuki.imgbed-uploader');
    hooks = await ext.activate();
    hooks.useMemorySecrets(); // 内存凭据：真 SecretStorage 写读传播不可靠（施工记录）
  });

  suiteTeardown(async () => {
    for (const key of CFG_KEYS) {
      await vscode.workspace
        .getConfiguration('imgbedUploader')
        .update(key, savedCfg.get(key), vscode.ConfigurationTarget.Global);
    }
    await hooks.clearCredential();
    notify.restore();
    await mock.stop();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  setup(async () => {
    notify.resolveAll();
    notify.calls.length = 0;
    notify.lines.length = 0;
    mock.reset();
    await hooks.setCredential('integration-test');
  });

  teardown(async () => {
    await closeEditors();
    notify.resolveAll();
  });

  // ---------- 11 条验收 ----------

  suite('验收 1 — 本地 + 白名单远程 + 转存一键上传', () => {
    test('4 条链接回写（含 1 条转存）、白名单不动、GET 零请求', async () => {
      writePng('img/a.png');
      writePng('img/b.png');
      writePng('img/c.png');
      await configure({
        uploadRemoteImages: true,
        remoteWhitelist: ['127.0.0.1'],
      });
      const editor = await openMd(
        'accept1.md',
        [
          '![a](./img/a.png)',
          '![b](img/b.png)',
          '![c](./img/c.png)',
          `![w](${mock.urls.white})`,
          `![t](${mock.urls.transfer})`,
        ].join('\n'),
      );

      await uploadAll();

      assert.strictEqual(mock.uploadCount(), 4);
      assert.deepStrictEqual(
        mock.requests
          .filter((r) => r.method === 'POST')
          .map((r) => r.filename)
          .sort(),
        ['a.png', 'b.png', 'black.png', 'c.png'],
      );
      assert.strictEqual(
        mock.requests.some((r) => r.path === '/white.png'),
        false,
        '白名单图应为 plan 层跳过、不下载',
      );
      const dl = mock.requests.find((r) => r.path === '/black.png');
      assert.ok(dl, '转存图应被下载');
      assert.strictEqual(dl.headers.authorization, undefined);
      assert.strictEqual(dl.headers.cookie, undefined);
      assert.strictEqual(dl.headers.referer, undefined);

      assert.strictEqual(
        editor.document.getText(),
        [
          `![a](${cdn('a.png')})`,
          `![b](${cdn('b.png')})`,
          `![c](${cdn('c.png')})`,
          `![w](${mock.urls.white})`,
          `![t](${cdn('black.png')})`,
        ].join('\n'),
      );
      const info = notify.calls.find((c) => c.message === summary(4, 0, 1));
      assert.ok(info, '应有成功 4 跳过 1 的汇总通知');
      assert.strictEqual(info.kind, 'info');
      assert.deepStrictEqual(info.buttons, []);
      assert.ok(notify.lines.some((l) => l.includes('命中白名单跳过')));
    });
  });

  suite('验收 2 — 部分失败与重试失败项', () => {
    test('1 张失败：其余回写、原链接保留、重试后补传', async () => {
      writePng('img/a.png');
      writePng('img/b.png');
      writePng('img/c.png');
      mock.setBehavior('b.png', [
        {
          status: 400,
          body: JSON.stringify({
            code: 'UPLOAD_FORMAT_NOT_ALLOWED',
            error: '格式不允许',
          }),
        },
      ]);
      await configure({});
      const editor = await openMd(
        'accept2.md',
        '![a](./img/a.png)\n![b](./img/b.png)\n![c](./img/c.png)',
      );

      await uploadAll();

      assert.strictEqual(mock.uploadCount(), 3);
      assert.strictEqual(
        editor.document.getText(),
        `![a](${cdn('a.png')})\n![b](./img/b.png)\n![c](${cdn('c.png')})`,
      );
      const warn = notify.calls.find((c) => c.message === summary(2, 1, 0));
      assert.ok(warn, '应有成功 2 失败 1 的汇总通知');
      assert.strictEqual(warn.kind, 'warn');
      assert.deepStrictEqual(warn.buttons, ['重试失败项']);
      assert.ok(
        notify.lines.some(
          (l) => l.includes('失败：') && l.includes('格式不允许'),
        ),
      );

      await notify.click(summary(2, 1, 0), '重试失败项');
      await waitUntil(() => mock.uploadCount() === 4, '重试恰补传 1 次');
      await waitUntil(
        () => editor.document.getText().includes(cdn('b.png')),
        '失败项重试后回写',
      );
      assert.strictEqual(
        editor.document.getText(),
        `![a](${cdn('a.png')})\n![b](${cdn('b.png')})\n![c](${cdn('c.png')})`,
      );
    });
  });

  suite('验收 3 — 一次 undo 完整撤销', () => {
    test('全部替换后一次 Ctrl+Z 全文复原', async () => {
      writePng('img/a.png');
      writePng('img/b.png');
      const text = '![a](./img/a.png)\n![b](./img/b.png)';
      await configure({});
      const editor = await openMd('accept3.md', text);

      await uploadAll();
      assert.strictEqual(mock.uploadCount(), 2);
      assert.ok(editor.document.isDirty, '回写后应为未保存修改');

      // undo 命令依赖编辑器控件 DOM 焦点（后台窗口静默 no-op，T11 施工记录）：
      // 每轮重新聚焦 + 重试直到复原
      for (let i = 0; i < 40 && editor.document.getText() !== text; i += 1) {
        await vscode.commands.executeCommand(
          'workbench.action.focusActiveEditorGroup',
        );
        await vscode.commands.executeCommand('undo');
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      assert.strictEqual(editor.document.getText(), text, 'undo 后全文复原');
    });
  });

  suite('验收 4 — 连续执行两次全部跳过', () => {
    test('第二次不新增文件、文本逐字不变', async () => {
      writePng('img/a.png');
      writePng('img/b.png');
      writePng('img/c.png');
      await configure({
        uploadRemoteImages: true,
        remoteWhitelist: ['127.0.0.1'],
      });
      const editor = await openMd(
        'accept4.md',
        [
          '![a](./img/a.png)',
          '![b](img/b.png)',
          '![c](./img/c.png)',
          `![w](${mock.urls.white})`,
          `![t](${mock.urls.transfer})`,
        ].join('\n'),
      );

      await uploadAll();
      assert.strictEqual(mock.uploadCount(), 4);
      const after = editor.document.getText();

      await uploadAll();
      assert.strictEqual(mock.uploadCount(), 4, '第二次不应新增上传');
      assert.strictEqual(editor.document.getText(), after);
      const info = notify.calls.find((c) => c.message === summary(0, 0, 5));
      assert.ok(info, '第二次应报全跳过');
      assert.ok(notify.lines.some((l) => l.includes('已回写链接，幂等跳过')));
    });
  });

  suite('验收 5 — buffer 未保存引用', () => {
    test('未保存新增引用可上传回写，磁盘不落盘', async () => {
      writePng('img/a.png');
      writePng('img/b.png');
      const text = '![a](./img/a.png)\n';
      await configure({});
      const editor = await openMd('accept5.md', text);
      await editor.edit((eb) =>
        eb.insert(
          editor.document.positionAt(editor.document.getText().length),
          '![b](./img/b.png)',
        ),
      );
      assert.ok(editor.document.isDirty);
      assert.strictEqual(
        fs.readFileSync(path.join(tmp, 'accept5.md'), 'utf8'),
        text,
        'buffer 编辑不应落盘',
      );

      await uploadAll();
      assert.strictEqual(mock.uploadCount(), 2);
      assert.strictEqual(
        editor.document.getText(),
        `![a](${cdn('a.png')})\n![b](${cdn('b.png')})`,
      );
      assert.strictEqual(
        fs.readFileSync(path.join(tmp, 'accept5.md'), 'utf8'),
        text,
        '回写不应落盘',
      );
    });
  });

  suite('验收 6 — 测试连接失败原因 / 未配置凭据引导', () => {
    test('① 凭据错误：错误通知含服务端原文与行动按钮', async () => {
      mock.setBehavior('imgbed-test.png', [
        { status: 401, body: JSON.stringify({ error: 'Invalid auth code' }) },
      ]);
      await configure({});
      await openMd('accept6.md', '![a](./img/a.png)');

      const p = vscode.commands.executeCommand(
        'imgbed-uploader.testConnection',
      );
      await notify.click('Invalid auth code');
      await p;

      const err = notify.calls.find((c) => c.kind === 'error');
      assert.ok(err, '应有错误通知');
      assert.strictEqual(err.message, 'Invalid auth code（请检查认证信息）');
      assert.deepStrictEqual(err.buttons, ['重新测试', '重新设置认证信息']);
    });

    test('② 未配置凭据：弹引导且图床零请求', async () => {
      writePng('img/a.png');
      await configure({});
      await openMd('accept6b.md', '![a](./img/a.png)');
      await hooks.clearCredential();
      assert.strictEqual(await hooks.hasCredential(), false, '凭据应已清除');

      const p = uploadAll();
      await Promise.race([
        notify.click('未配置认证信息'),
        (async () => {
          await new Promise((resolve) => setTimeout(resolve, 3000));
          throw new Error(
            `3s 无引导通知；诊断 calls=${JSON.stringify(
              notify.calls.map((c) => [c.kind, c.message]),
            )} requests=${mock.requests.length} ` +
              `authCode=${JSON.stringify(
                mock.requests.map((r) => r.query.get('authCode')),
              )} authType=${String(
                vscode.workspace
                  .getConfiguration('imgbedUploader')
                  .get('authType'),
              )}`,
          );
        })(),
      ]);
      await p;

      const warn = notify.calls.find((c) =>
        c.message.includes('未配置认证信息'),
      );
      assert.ok(warn, '应有未配置认证信息引导');
      assert.strictEqual(warn.kind, 'warn');
      assert.deepStrictEqual(warn.buttons, ['设置认证信息']);
      assert.strictEqual(mock.requests.length, 0);
    });
  });

  suite('验收 8 — 400 格式拒绝错误原样呈现', () => {
    test('服务端错误原文进明细、文本不动', async () => {
      writePng('img/bad.png');
      mock.setBehavior('bad.png', [
        {
          status: 400,
          body: JSON.stringify({
            code: 'UPLOAD_FORMAT_NOT_ALLOWED',
            error: '格式不允许',
          }),
        },
      ]);
      await configure({});
      const editor = await openMd('accept8.md', '![x](./img/bad.png)');

      await uploadAll();

      assert.strictEqual(editor.document.getText(), '![x](./img/bad.png)');
      const fails = notify.lines.filter(
        (l) => l.includes('失败：') && l.includes('格式不允许'),
      );
      assert.strictEqual(fails.length, 1, '明细应有且仅有一条失败原因');
    });
  });

  suite('验收 9 — 相对路径两写法与 %20 编码路径', () => {
    test('均按文档所在目录解析上传并回写', async () => {
      writePng('img/a.png');
      writePng('img/b.png');
      writePng('img/my pic.png');
      await configure({});
      const editor = await openMd(
        'accept9.md',
        '![a](./img/a.png)\n![b](img/b.png)\n![c](./img/my%20pic.png)',
      );

      await uploadAll();

      assert.strictEqual(mock.uploadCount(), 3);
      assert.strictEqual(
        editor.document.getText(),
        // my pic.png 的 URL 值含空格，markdownText 包 <>（设计 §6 观察项）
        `![a](${cdn('a.png')})\n![b](${cdn('b.png')})\n![c](<${cdn('my pic.png')}>)`,
      );
    });
  });

  suite('验收 10 — 同路径去重', () => {
    test('同路径 3 处只上传 1 次、回写同一链接', async () => {
      writePng('img/a.png');
      await configure({});
      const ref = '![x](./img/a.png)';
      const editor = await openMd('accept10.md', `${ref}\n${ref}\n${ref}`);

      await uploadAll();

      assert.strictEqual(mock.uploadCount(), 1);
      const expected = `![x](${cdn('a.png')})`;
      assert.strictEqual(
        editor.document.getText(),
        `${expected}\n${expected}\n${expected}`,
      );
    });
  });

  suite('验收 12 — 改 customCdn 后全部跳过', () => {
    test('同 host 换 path 自识别跳过；换 host 落远程跳过', async () => {
      writePng('img/a.png');
      writePng('img/b.png');
      const text = '![a](./img/a.png)\n![b](./img/b.png)';
      const cdn1 = `http://127.0.0.1:${mock.port}/cdn/`;
      await configure({
        customCdn: cdn1,
        uploadRemoteImages: false,
      });
      const editor = await openMd('accept12.md', text);

      await uploadAll();
      assert.strictEqual(mock.uploadCount(), 2);
      const after = `![a](${cdn1}a.png)\n![b](${cdn1}b.png)`;
      assert.strictEqual(editor.document.getText(), after);

      // 同 host 换 path：靠 customCdn host 自识别，不是远程跳过兜底
      await configure({
        customCdn: `http://127.0.0.1:${mock.port}/cdn2/`,
        uploadRemoteImages: false,
      });
      await uploadAll();
      assert.strictEqual(mock.uploadCount(), 2);
      assert.strictEqual(editor.document.getText(), after);
      assert.ok(notify.lines.some((l) => l.includes('已回写链接，幂等跳过')));

      // 换 host：自识别失效，落远程跳过（T8 §6 边界显式钉住）
      await configure({
        customCdn: `http://[::1]:${mock.port}/cdn3/`,
        uploadRemoteImages: false,
      });
      await uploadAll();
      assert.strictEqual(mock.uploadCount(), 2);
      assert.strictEqual(editor.document.getText(), after);
      assert.ok(
        notify.lines.some((l) => l.includes('远程图像跳过（未开启转存）')),
      );
    });
  });

  suite('验收 13 — untitled 文档相对路径', () => {
    test('进失败报告提示先保存、零请求、文本不动', async () => {
      await configure({});
      const doc = await vscode.workspace.openTextDocument({
        content: '![x](./img/a.png)',
        language: 'markdown',
      });
      const editor = await vscode.window.showTextDocument(doc);

      await uploadAll();

      assert.strictEqual(mock.requests.length, 0);
      assert.strictEqual(editor.document.getText(), '![x](./img/a.png)');
      const warn = notify.calls.find((c) => c.message === summary(0, 1, 0));
      assert.ok(warn, '应有失败 1 的汇总通知');
      assert.strictEqual(warn.kind, 'warn');
      assert.deepStrictEqual(warn.buttons, ['重试失败项']);
      assert.ok(
        notify.lines.some((l) =>
          l.includes('未保存文档无法解析相对路径，请先保存文档'),
        ),
      );
    });
  });

  // ---------- 兄弟设计委托项 ----------

  suite('T10 附加 — 远程 403 失败保留原链接', () => {
    test('不误弹重新设置认证信息', async () => {
      await configure({ uploadRemoteImages: true, remoteWhitelist: [] });
      mock.setGetStatus('/black.png', 403);
      const text = `![t](${mock.urls.transfer})`;
      const editor = await openMd('t10-403.md', text);

      await uploadAll();

      assert.strictEqual(mock.uploadCount(), 0);
      assert.strictEqual(editor.document.getText(), text);
      const warn = notify.calls.find((c) => c.message === summary(0, 1, 0));
      assert.ok(warn, '应有失败 1 的汇总通知');
      assert.deepStrictEqual(warn.buttons, ['重试失败项']);
      assert.ok(notify.lines.some((l) => l.includes('下载失败：HTTP 403')));
    });
  });

  suite('T7 壳层 — uploadLocalFiles 两入口与插入细则', () => {
    test('① 命令面板入口：选择框 → 下一行独立行插入、单次编辑', async () => {
      const u1 = writePng('pick/p1.png');
      const u2 = writePng('pick/p2.png');
      await configure({});
      const original = 'line1\ncursor here\nline3\n';
      const editor = await openMd('t7-picker.md', original);
      editor.selection = new vscode.Selection(
        new vscode.Position(1, 0),
        new vscode.Position(1, 0),
      );
      notify.setOpenDialog([u1, u2]);

      await vscode.commands.executeCommand('imgbed-uploader.uploadFile');

      assert.strictEqual(
        editor.document.getText(),
        `line1\ncursor here\n![](${cdn('p1.png')})\n![](${cdn('p2.png')})\nline3\n`,
      );
      // undo 命令依赖编辑器控件 DOM 焦点（后台窗口静默 no-op，T11 施工记录）：
      // 每轮重新聚焦 + 重试直到复原
      for (
        let i = 0;
        i < 40 && editor.document.getText() !== original;
        i += 1
      ) {
        await vscode.commands.executeCommand(
          'workbench.action.focusActiveEditorGroup',
        );
        await vscode.commands.executeCommand('undo');
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      assert.strictEqual(
        editor.document.getText(),
        original,
        '单次编辑一次 undo 复原',
      );
    });

    test('② 资源管理器入口：菜单参数 (uri, uris) 同样插入', async () => {
      const u = writePng('pick/p3.png');
      await configure({});
      const editor = await openMd(
        't7-explorer.md',
        'line1\ncursor here\nline3\n',
      );
      editor.selection = new vscode.Selection(
        new vscode.Position(1, 0),
        new vscode.Position(1, 0),
      );

      await vscode.commands.executeCommand('imgbed-uploader.uploadFile', u, [
        u,
      ]);

      assert.strictEqual(
        editor.document.getText(),
        `line1\ncursor here\n![](${cdn('p3.png')})\nline3\n`,
      );
    });

    test('③ 上传中关文档：链接不插入并提示', async () => {
      const u = writePng('pick/p4.png');
      mock.setBehavior('p4.png', [{ delayMs: 6000 }]);
      await configure({});
      const editor = await openMdViaCommand(
        't7-close.md',
        'line1\ncursor here\nline3\n',
      );

      const p = vscode.commands.executeCommand(
        'imgbed-uploader.uploadFile',
        u,
        [u],
      );
      await waitUntil(() => mock.uploadCount() === 1, '上传进行中');
      const activeBefore =
        vscode.window.activeTextEditor?.document.uri.toString();
      await vscode.commands.executeCommand(
        'workbench.action.closeActiveEditor',
      );
      const activeAfter =
        vscode.window.activeTextEditor?.document.uri.toString();
      const samples: string[] = [];
      const t0 = Date.now();
      const poll = (async () => {
        while (Date.now() - t0 < 5500) {
          samples.push(`${Date.now() - t0}ms:${editor.document.isClosed}`);
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
      })();
      await p;
      await poll;

      const warn = notify.calls.find(
        (c) => c.message === 'ImgBed Uploader：文档已关闭，链接未插入',
      );
      assert.ok(
        warn,
        `应有文档已关闭提示；诊断 closed=${editor.document.isClosed} ` +
          `activeBefore=${activeBefore} activeAfter=${activeAfter} ` +
          `samples=${samples.join(' ')} ` +
          `calls=${JSON.stringify(notify.calls.map((c) => c.message))} ` +
          `uploads=${mock.uploadCount()}`,
      );
    });

    test('④ 无活动 md/mdx 编辑器：提示先打开', async () => {
      const u = writePng('pick/p5.png');
      await configure({});
      const p = path.join(tmp, 'plain.txt');
      fs.writeFileSync(p, 'hello', 'utf8');
      await vscode.window.showTextDocument(
        await vscode.workspace.openTextDocument(p),
      );

      await vscode.commands.executeCommand('imgbed-uploader.uploadFile', u, [
        u,
      ]);

      const info = notify.calls.find(
        (c) => c.message === 'ImgBed Uploader：请先打开 Markdown / MDX 文档',
      );
      assert.ok(info, '应有请先打开 Markdown 提示');
      assert.strictEqual(mock.uploadCount(), 0);
    });
  });

  suite('T6 壳层 — uploadSelected 选区过滤', () => {
    test('2 个引用选中 1 个：只上传回写选区内', async () => {
      writePng('img/a.png');
      writePng('img/b.png');
      await configure({});
      const text = '![x](./img/a.png)\n![y](./img/b.png)';
      const editor = await openMd('t6-sel.md', text);
      const start = text.indexOf('./img/a.png');
      editor.selection = new vscode.Selection(
        editor.document.positionAt(start),
        editor.document.positionAt(start + './img/a.png'.length),
      );

      await vscode.commands.executeCommand('imgbed-uploader.uploadSelected');

      assert.strictEqual(mock.uploadCount(), 1);
      assert.strictEqual(
        editor.document.getText(),
        `![x](${cdn('a.png')})\n![y](./img/b.png)`,
      );
    });
  });
});
