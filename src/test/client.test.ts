import * as assert from 'assert';
import * as http from 'http';
import type { AddressInfo } from 'net';
import * as vscode from 'vscode';
import {
  TEST_PNG,
  UploadError,
  buildQuery,
  extractFileId,
  mapError,
  resolveUrl,
  testConnection,
  upload,
} from '../client';
import { normalize } from '../config';
import { initSecrets } from '../secrets';

suite('client 纯函数', () => {
  const base = normalize({ serverUrl: 'https://img.x' });

  test('buildQuery：固定参数恒传、空值省略、authCode 仅 authCode 类型传', () => {
    const q = buildQuery({ ...base, uploadFolder: 'img/test' }, 'my-code');
    assert.strictEqual(q.responseFormat, 'object');
    assert.strictEqual(q.returnFormat, 'full');
    assert.strictEqual(q.uploadChannel, 'telegram');
    assert.strictEqual(q.uploadNameType, 'default');
    assert.strictEqual(q.serverCompress, 'true');
    assert.strictEqual(q.autoRetry, 'true');
    assert.strictEqual(q.uploadFolder, 'img/test');
    assert.strictEqual(q.authCode, 'my-code');
    assert.ok(!('channelName' in q));
    assert.ok(!('expire' in q));

    const tokenQ = buildQuery({ ...base, authType: 'apiToken' }, 'tok');
    assert.ok(!('authCode' in tokenQ));

    const emptyQ = buildQuery(base, undefined);
    assert.ok(!('authCode' in emptyQ));
  });

  test('extractFileId：相对/绝对/无前缀/子路径/百分号编码解码', () => {
    assert.strictEqual(
      extractFileId('/file/abc.jpg', 'https://img.x'),
      'abc.jpg',
    );
    assert.strictEqual(
      extractFileId('https://img.x/file/abc.jpg', 'https://img.x'),
      'abc.jpg',
    );
    assert.strictEqual(
      extractFileId('/file/videos/a.mp4', 'https://img.x'),
      'videos/a.mp4',
    );
    assert.strictEqual(extractFileId('/abc.jpg', 'https://img.x'), 'abc.jpg');
    assert.strictEqual(
      extractFileId('/file/abc_%E5%9B%BE%201.png', 'https://img.x'),
      'abc_图 1.png',
    );
  });

  test('resolveUrl：customCdn → publicUrl → src 三级优先', () => {
    const cfg = { ...base, customCdn: 'https://cdn.x/file/' };
    assert.strictEqual(
      resolveUrl(
        { src: '/file/abc.jpg', publicUrl: 'https://pub/abc.jpg' },
        cfg,
      ),
      'https://cdn.x/file/abc.jpg',
    );
    assert.strictEqual(
      resolveUrl(
        { src: '/file/abc.jpg', publicUrl: 'https://pub/abc.jpg' },
        base,
      ),
      'https://pub/abc.jpg',
    );
    assert.strictEqual(
      resolveUrl({ src: 'https://img.x/file/abc.jpg' }, base),
      'https://img.x/file/abc.jpg',
    );
    assert.strictEqual(
      resolveUrl({ src: '/file/abc.jpg' }, base),
      'https://img.x/file/abc.jpg',
    );
  });

  test('TEST_PNG：PNG 签名 + IHDR 1x1（防常量损坏）', () => {
    assert.deepStrictEqual(
      [...TEST_PNG.slice(0, 8)],
      [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    );
    const buf = Buffer.from(TEST_PNG);
    assert.strictEqual(buf.readUInt32BE(16), 1);
    assert.strictEqual(buf.readUInt32BE(20), 1);
  });

  test('mapError：服务端原文透传、code 提取、401 追加提示', () => {
    const err = mapError(
      400,
      JSON.stringify({
        code: 'UPLOAD_FORMAT_NOT_ALLOWED',
        error: '格式不允许',
      }),
    );
    assert.ok(err instanceof UploadError);
    assert.strictEqual(err.message, '格式不允许');
    assert.strictEqual(err.status, 400);
    assert.strictEqual(err.code, 'UPLOAD_FORMAT_NOT_ALLOWED');

    const authErr = mapError(401, JSON.stringify({ message: '未授权' }));
    assert.strictEqual(authErr.message, '未授权（请检查认证信息）');

    const htmlErr = mapError(502, '<html>bad gateway</html>');
    assert.ok(htmlErr.message.includes('HTTP 502'));
    assert.ok(htmlErr.message.includes('bad gateway'));
    assert.strictEqual(htmlErr.code, undefined);
  });
});

suite('client.upload / testConnection 集成（进程内 mock 图床）', () => {
  // 路由约定：channelName 值触发特殊响应（upload 无法传任意 query，借道 channelName）
  let server: http.Server;
  let port: number;
  let lastReq: { url: string; headers: http.IncomingHttpHeaders; body: Buffer };
  let requestCount: number;

  const cfgFor = (channelName?: string) =>
    normalize({
      serverUrl: `http://127.0.0.1:${port}`,
      channelName: channelName ?? '',
    });

  setup(async () => {
    initSecrets({
      get: async () => 'my-code',
      store: async () => undefined,
      delete: async () => undefined,
    } as unknown as vscode.SecretStorage);
    requestCount = 0;

    server = http.createServer((req, res) => {
      requestCount += 1;
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        lastReq = {
          url: req.url ?? '',
          headers: req.headers,
          body: Buffer.concat(chunks),
        };
        const params = new URL(lastReq.url, 'http://x').searchParams;
        const respond = (status: number, payload: string) => {
          res.writeHead(status, { 'Content-Type': 'application/json' });
          res.end(payload);
        };
        switch (params.get('channelName')) {
          case 'fail':
            respond(
              400,
              JSON.stringify({
                code: 'UPLOAD_FORMAT_NOT_ALLOWED',
                error: '格式不允许',
              }),
            );
            break;
          case 'unauth':
            respond(401, JSON.stringify({ error: 'Invalid auth code' }));
            break;
          case 'badresp':
            respond(200, 'not-json');
            break;
          case 'nosrc':
            respond(200, JSON.stringify({ publicUrl: 'https://pub/x' }));
            break;
          case 'slow':
            setTimeout(
              () => respond(200, JSON.stringify({ src: '/file/x.png' })),
              3000,
            );
            break;
          default:
            respond(
              200,
              JSON.stringify({
                src: '/file/abc_图 1.png',
                publicUrl: 'https://pub/file/abc_图 1.png',
              }),
            );
        }
      });
    });
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });
    port = (server.address() as AddressInfo).port;
  });

  teardown(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  test('成功上传：query 映射 + authCode query + URL 优先级', async () => {
    const result = await upload(
      { name: 'a.png', data: new Uint8Array([1, 2, 3]) },
      normalize({
        serverUrl: `http://127.0.0.1:${port}`,
        uploadFolder: 'img/test',
      }),
    );
    const url = new URL(lastReq.url, 'http://x');
    assert.strictEqual(url.pathname, '/upload');
    assert.strictEqual(url.searchParams.get('responseFormat'), 'object');
    assert.strictEqual(url.searchParams.get('returnFormat'), 'full');
    assert.strictEqual(url.searchParams.get('uploadFolder'), 'img/test');
    assert.strictEqual(url.searchParams.get('authCode'), 'my-code');
    assert.strictEqual(url.searchParams.get('channelName'), null);
    assert.ok(lastReq.body.includes('name="file"'));
    assert.strictEqual(lastReq.headers.authorization, undefined);
    assert.strictEqual(result.url, 'https://pub/file/abc_图 1.png');
  });

  test('apiToken：走 Bearer 头，不进 query', async () => {
    await upload(
      { name: 'a.png', data: new Uint8Array([1]) },
      normalize({
        serverUrl: `http://127.0.0.1:${port}`,
        authType: 'apiToken',
      }),
    );
    const url = new URL(lastReq.url, 'http://x');
    assert.strictEqual(url.searchParams.get('authCode'), null);
    assert.strictEqual(lastReq.headers.authorization, 'Bearer my-code');
  });

  test('文件名保真：中文 + 空格原样进 multipart', async () => {
    await upload({ name: '图片 1.png', data: new Uint8Array([1]) }, cfgFor());
    assert.ok(lastReq.body.includes(Buffer.from('图片 1.png', 'utf8')));
  });

  test('customCdn 优先于 publicUrl', async () => {
    const result = await upload(
      { name: 'a.png', data: new Uint8Array([1]) },
      normalize({
        serverUrl: `http://127.0.0.1:${port}`,
        customCdn: 'https://cdn.x/file/',
      }),
    );
    assert.strictEqual(result.url, 'https://cdn.x/file/abc_图 1.png');
  });

  test('400：服务端原文透传 + code 提取（验收 8）', async () => {
    try {
      await upload(
        { name: 'a.png', data: new Uint8Array([1]) },
        cfgFor('fail'),
      );
      assert.fail('应当抛出 UploadError');
    } catch (err) {
      assert.ok(err instanceof UploadError);
      const uploadErr = err as UploadError;
      assert.strictEqual(uploadErr.message, '格式不允许');
      assert.strictEqual(uploadErr.status, 400);
      assert.strictEqual(uploadErr.code, 'UPLOAD_FORMAT_NOT_ALLOWED');
    }
  });

  test('响应缺 src / 非 JSON：报「上传响应格式异常」', async () => {
    for (const route of ['badresp', 'nosrc']) {
      try {
        await upload(
          { name: 'a.png', data: new Uint8Array([1]) },
          cfgFor(route),
        );
        assert.fail('应当抛出 UploadError');
      } catch (err) {
        assert.ok(err instanceof UploadError);
        assert.strictEqual((err as UploadError).message, '上传响应格式异常');
      }
    }
  });

  test('超时：注入毫秒级超时，报「上传超时」', async () => {
    try {
      await upload(
        { name: 'a.png', data: new Uint8Array([1]) },
        cfgFor('slow'),
        { timeoutMs: 200 },
      );
      assert.fail('应当超时');
    } catch (err) {
      assert.ok(err instanceof UploadError);
      assert.ok((err as UploadError).message.includes('上传超时'));
    }
  });

  test('serverUrl 非法：报「图床地址无效」', async () => {
    try {
      await upload(
        { name: 'a.png', data: new Uint8Array([1]) },
        normalize({ serverUrl: 'not a url' }),
      );
      assert.fail('应当抛出 UploadError');
    } catch (err) {
      assert.ok(err instanceof UploadError);
      assert.strictEqual(
        (err as UploadError).message,
        '图床地址无效，请检查 serverUrl 配置',
      );
      assert.strictEqual((err as UploadError).code, 'INVALID_SERVER_URL');
    }
  });

  test('testConnection 成功：detail 含渠道名与 URL，1x1 PNG 真实链路字节', async () => {
    const result = await testConnection(
      normalize({ serverUrl: `http://127.0.0.1:${port}` }),
    );
    if (!result.ok) {
      assert.fail('应当成功');
    }
    assert.strictEqual(result.url, 'https://pub/file/abc_图 1.png');
    assert.ok(result.detail.includes('渠道：telegram'));
    assert.ok(result.detail.includes(result.url));
    // mock 侧断言请求形态与文件字节（T3 设计 §5）
    assert.ok(lastReq.body.includes('name="file"'));
    assert.ok(lastReq.body.includes(Buffer.from('imgbed-test.png', 'utf8')));
    assert.ok(
      lastReq.body.includes(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      ),
    );
    assert.ok(
      lastReq.body.includes(
        Buffer.concat([
          Buffer.from('IHDR'),
          Buffer.from([0, 0, 0, 1, 0, 0, 0, 1]),
        ]),
      ),
    );
    assert.strictEqual(requestCount, 1);
  });

  test('testConnection 401：服务端原文 + 认证提示 + status 透传（验收 6）', async () => {
    const result = await testConnection(
      normalize({
        serverUrl: `http://127.0.0.1:${port}`,
        channelName: 'unauth',
      }),
    );
    if (result.ok) {
      assert.fail('应当失败');
    }
    assert.strictEqual(result.status, 401);
    assert.strictEqual(result.detail, 'Invalid auth code（请检查认证信息）');
  });

  test('testConnection 400：服务端原文 + code 透传', async () => {
    const result = await testConnection(
      normalize({
        serverUrl: `http://127.0.0.1:${port}`,
        channelName: 'fail',
      }),
    );
    if (result.ok) {
      assert.fail('应当失败');
    }
    assert.strictEqual(result.status, 400);
    assert.strictEqual(result.code, 'UPLOAD_FORMAT_NOT_ALLOWED');
    assert.strictEqual(result.detail, '格式不允许');
  });

  test('testConnection 连接被拒：detail 为「上传失败：…」', async () => {
    // 临时端口起后即关，保证连接被拒
    const probe = http.createServer();
    await new Promise<void>((resolve) =>
      probe.listen(0, '127.0.0.1', () => resolve()),
    );
    const deadPort = (probe.address() as AddressInfo).port;
    await new Promise<void>((resolve) => probe.close(() => resolve()));
    const result = await testConnection(
      normalize({ serverUrl: `http://127.0.0.1:${deadPort}` }),
    );
    if (result.ok) {
      assert.fail('应当失败');
    }
    assert.ok(result.detail.startsWith('上传失败：'));
  });

  test('testConnection serverUrl 非法：code=INVALID_SERVER_URL', async () => {
    const result = await testConnection(normalize({ serverUrl: 'not a url' }));
    if (result.ok) {
      assert.fail('应当失败');
    }
    assert.strictEqual(result.detail, '图床地址无效，请检查 serverUrl 配置');
    assert.strictEqual(result.code, 'INVALID_SERVER_URL');
  });

  test('testConnection catch-all：非 UploadError 异常转「测试连接失败：…」', async () => {
    initSecrets({
      get: async () => {
        throw new Error('boom');
      },
      store: async () => undefined,
      delete: async () => undefined,
    } as unknown as vscode.SecretStorage);
    const result = await testConnection(
      normalize({ serverUrl: `http://127.0.0.1:${port}` }),
    );
    if (result.ok) {
      assert.fail('应当失败');
    }
    assert.strictEqual(result.detail, '测试连接失败：boom');
    assert.strictEqual(requestCount, 0);
  });

  test('命令层：凭据缺失时引导前置拦截、mock 侧零请求（4.10）', async () => {
    // 前置：测试实例真实 SecretStorage 为空（本套件只注入假 SecretStorage，不写真实存储）
    const cfg = vscode.workspace.getConfiguration('imgbedUploader');
    await cfg.update(
      'serverUrl',
      `http://127.0.0.1:${port}`,
      vscode.ConfigurationTarget.Global,
    );
    await cfg.update('authType', 'apiToken', vscode.ConfigurationTarget.Global);
    try {
      // 引导弹窗等待交互，命令 Promise 不结束：不 await，观察零请求（T3 设计 §5）
      void vscode.commands.executeCommand('imgbed-uploader.testConnection');
      await new Promise((resolve) => setTimeout(resolve, 1000));
      assert.strictEqual(requestCount, 0);
    } finally {
      await cfg.update(
        'serverUrl',
        undefined,
        vscode.ConfigurationTarget.Global,
      );
      await cfg.update(
        'authType',
        undefined,
        vscode.ConfigurationTarget.Global,
      );
    }
  });
});
