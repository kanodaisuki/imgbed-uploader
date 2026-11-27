import * as assert from 'assert';
import * as http from 'http';
import type { AddressInfo } from 'node:net';
import { downloadRemote, sniffImageExt, transferFileName } from '../download';
import { zhCn } from './locale';

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
const GIF = Buffer.from('GIF89a......');
const WEBP = Buffer.concat([
  Buffer.from('RIFF'),
  Buffer.from([0, 0, 0, 0]),
  Buffer.from('WEBP'),
]);
const AVIF = Buffer.concat([
  Buffer.from([0, 0, 0, 0x1c]),
  Buffer.from('ftypavifmif1'),
]);
const HEIC = Buffer.concat([
  Buffer.from([0, 0, 0, 0x18]),
  Buffer.from('ftypheicmif1'),
]);
const BMP = Buffer.from('BM12345678');
const ICO = Buffer.from([0, 0, 1, 0, 1, 0]);
const SVG = Buffer.from(
  '<?xml version="1.0"?><!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" ' +
    '"http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd"><svg></svg>',
);
const HTML = Buffer.from(
  '<!doctype html><html><body><svg></svg></body></html>',
);
const HTML_WITH_PROLOG = Buffer.from(
  '<?xml version="1.0"?><html><body><svg></svg></body></html>',
);

suite('download 纯函数', () => {
  test('sniffImageExt：九种扩展名的字节签名', () => {
    assert.strictEqual(sniffImageExt(PNG), 'png');
    assert.strictEqual(sniffImageExt(JPEG), 'jpg');
    assert.strictEqual(sniffImageExt(GIF), 'gif');
    assert.strictEqual(sniffImageExt(WEBP), 'webp');
    assert.strictEqual(sniffImageExt(AVIF), 'avif');
    assert.strictEqual(sniffImageExt(BMP), 'bmp');
    assert.strictEqual(sniffImageExt(ICO), 'ico');
    assert.strictEqual(sniffImageExt(SVG), 'svg');
  });

  test('sniffImageExt：SVG prolog 变体容忍', () => {
    const variants = [
      Buffer.from('<!-- note -->\n<svg></svg>'),
      Buffer.from('<SVG xmlns="http://www.w3.org/2000/svg"></SVG>'),
      Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('<svg/>')]),
      Buffer.from('  \n\t<svg></svg>'),
    ];
    for (const data of variants) {
      assert.strictEqual(sniffImageExt(data), 'svg');
    }
  });

  test('sniffImageExt：HTML/文本/截断/边界负例', () => {
    assert.strictEqual(sniffImageExt(HTML), undefined);
    assert.strictEqual(sniffImageExt(HTML_WITH_PROLOG), undefined);
    assert.strictEqual(sniffImageExt(Buffer.from('hello world')), undefined);
    assert.strictEqual(sniffImageExt(Buffer.alloc(0)), undefined);
    assert.strictEqual(sniffImageExt(Buffer.from([0xff, 0xd8])), undefined);
    assert.strictEqual(sniffImageExt(Buffer.from('RIFF0000WAVE')), undefined);
    assert.strictEqual(sniffImageExt(HEIC), undefined);
    assert.strictEqual(sniffImageExt(Buffer.from([0, 0, 1])), undefined);
  });

  test('transferFileName：basename 解码、清洗与大小写保留', () => {
    assert.strictEqual(transferFileName('https://x/a/b.png', 'png'), 'b.png');
    assert.strictEqual(
      transferFileName('https://x/a/%E5%9B%BE%201.PNG', 'png'),
      '图 1.PNG',
    );
    assert.strictEqual(
      transferFileName('https://x/photo.jpeg', 'jpg'),
      'photo.jpeg',
    );
    assert.strictEqual(
      transferFileName('https://x/photo.php', 'jpg'),
      'photo.jpg',
    );
    assert.strictEqual(transferFileName('https://x/photo', 'png'), 'photo.png');
    assert.strictEqual(transferFileName('https://x/a.png?x=1', 'png'), 'a.png');
    assert.strictEqual(transferFileName('https://x/%zz.png', 'png'), '%zz.png');
    assert.strictEqual(
      transferFileName('https://x/a%3Cb%3Ec%3Ad.png', 'png'),
      'a_b_c_d.png',
    );
    assert.strictEqual(transferFileName('https://x/a.png...', 'png'), 'a.png');
  });

  test('transferFileName：空 basename、仅扩展名与非法 URL 兜底', () => {
    assert.strictEqual(transferFileName('https://x/', 'png'), 'remote.png');
    assert.strictEqual(transferFileName('https://x/.png', 'png'), 'remote.png');
    assert.strictEqual(transferFileName('not a url', 'png'), 'remote.png');
    assert.strictEqual(
      transferFileName('https://x/.hidden.png', 'png'),
      '.hidden.png',
    );
  });

  test('transferFileName：base 截断到 100 code point 且保留扩展名', () => {
    const name = transferFileName(`https://x/${'a'.repeat(300)}.png`, 'png');
    assert.strictEqual(name, `${'a'.repeat(100)}.png`);
  });
});

suite('downloadRemote 集成（进程内 mock HTTP）', () => {
  let server: http.Server;
  let port: number;
  let lastHeaders: http.IncomingHttpHeaders;

  const url = (p: string): string => `http://127.0.0.1:${port}${p}`;

  setup(async () => {
    server = http.createServer((req, res) => {
      lastHeaders = req.headers;
      const pathname = (req.url ?? '').split('?')[0];
      switch (pathname) {
        case '/ok.png':
          res.writeHead(200, { 'Content-Type': 'image/png' });
          res.end(PNG);
          break;
        case '/octet.png':
          res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
          res.end(PNG);
          break;
        case '/lie.png':
          res.writeHead(200, { 'Content-Type': 'image/png' });
          res.end(JPEG);
          break;
        case '/html-as-png':
          res.writeHead(200, { 'Content-Type': 'image/png' });
          res.end(HTML);
          break;
        case '/html':
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(HTML);
          break;
        case '/no-header':
          res.writeHead(200);
          res.end(PNG);
          break;
        case '/empty':
          res.writeHead(200, { 'Content-Type': 'image/png' });
          res.end();
          break;
        case '/403':
          res.writeHead(403, { 'Content-Length': '2' });
          res.end('no');
          break;
        case '/404':
          res.writeHead(404);
          res.end();
          break;
        case '/half':
          res.writeHead(200, { 'Content-Type': 'image/png' });
          res.write(PNG);
          setTimeout(() => res.destroy(), 30);
          break;
        case '/hang-headers':
          break;
        case '/hang-body':
          res.writeHead(200, { 'Content-Type': 'image/png' });
          res.write(PNG);
          break;
        case '/big':
          res.writeHead(200, { 'Content-Type': 'image/png' });
          res.end(Buffer.concat([PNG, Buffer.alloc(200)]));
          break;
        case '/redirect':
          res.writeHead(302, { Location: '/ok.png' });
          res.end();
          break;
        default:
          res.writeHead(500);
          res.end();
      }
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

  test('200 图片：字节原样返回、文件名来自 URL', async () => {
    const image = await downloadRemote(url('/ok.png'));
    assert.strictEqual(image.name, 'ok.png');
    assert.ok(Buffer.from(image.data).equals(PNG));
  });

  test('判定不看 Content-Type：octet-stream 与缺失头都能成功', async () => {
    assert.strictEqual(
      (await downloadRemote(url('/octet.png'))).name,
      'octet.png',
    );
    assert.strictEqual(
      (await downloadRemote(url('/no-header'))).name,
      'no-header.png',
    );
  });

  test('嗅探纠正扩展名：头写 png、字节是 JPEG → .jpg', async () => {
    const image = await downloadRemote(url('/lie.png'));
    assert.strictEqual(image.name, 'lie.jpg');
    assert.ok(Buffer.from(image.data).equals(JPEG));
  });

  test('头撒谎/HTML 页面 → 非图片内容', async () => {
    await assert.rejects(
      () => downloadRemote(url('/html-as-png')),
      zhCn
        ? /非图片内容（Content-Type: image\/png）/
        : /Not an image \(Content-Type: image\/png\)/,
    );
    await assert.rejects(
      () => downloadRemote(url('/html')),
      zhCn
        ? /非图片内容（Content-Type: text\/html）/
        : /Not an image \(Content-Type: text\/html\)/,
    );
    await assert.rejects(
      () => downloadRemote(url('/empty')),
      zhCn ? /非图片内容/ : /Not an image/,
    );
  });

  test('非 2xx → 下载失败：HTTP <status>', async () => {
    await assert.rejects(
      () => downloadRemote(url('/403')),
      zhCn ? /下载失败：HTTP 403/ : /Download failed: HTTP 403/,
    );
    await assert.rejects(
      () => downloadRemote(url('/404')),
      zhCn ? /下载失败：HTTP 404/ : /Download failed: HTTP 404/,
    );
  });

  test('body 读取非超时中断 → 下载失败且不是 terminated 裸文案', async () => {
    await assert.rejects(
      () => downloadRemote(url('/half')),
      (err: Error) => {
        assert.ok(
          err.message.startsWith(zhCn ? '下载失败：' : 'Download failed: '),
        );
        assert.ok(!err.message.includes('terminated'));
        return true;
      },
    );
  });

  test('超时：等响应头 / body 卡住都映射为下载超时', async () => {
    await assert.rejects(
      () => downloadRemote(url('/hang-headers'), { timeoutMs: 50 }),
      zhCn ? /下载超时（60 秒）/ : /Download timed out \(60 s\)/,
    );
    await assert.rejects(
      () => downloadRemote(url('/hang-body'), { timeoutMs: 50 }),
      zhCn ? /下载超时（60 秒）/ : /Download timed out \(60 s\)/,
    );
  });

  test('流式上限：chunked 超限 → 远程图像过大', async () => {
    await assert.rejects(
      () => downloadRemote(url('/big'), { maxBytes: 100 }),
      zhCn
        ? /远程图像过大（超过 50 MB）/
        : /Remote image is too large \(over 50 MB\)/,
    );
  });

  test('重定向跟随：文件名仍取原 URL', async () => {
    const image = await downloadRemote(url('/redirect'));
    assert.strictEqual(image.name, 'redirect.png');
    assert.ok(Buffer.from(image.data).equals(PNG));
  });

  test('非 http(s) → 远程图像地址无效', async () => {
    await assert.rejects(
      () => downloadRemote('file:///x.png'),
      zhCn ? /远程图像地址无效/ : /Invalid remote image URL/,
    );
  });

  test('远端收不到凭据：无 Authorization/Cookie/Referer，UA 为诚实标识', async () => {
    await downloadRemote(url('/ok.png'));
    assert.strictEqual(lastHeaders.authorization, undefined);
    assert.strictEqual(lastHeaders.cookie, undefined);
    assert.strictEqual(lastHeaders.referer, undefined);
    assert.strictEqual(lastHeaders['user-agent'], 'ImgBed-Uploader');
  });
});
