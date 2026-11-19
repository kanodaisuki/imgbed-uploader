import * as assert from 'assert';
import {
  buildInsertText,
  localImageLink,
  mdImageLink,
  pasteFileName,
  resolveCollision,
} from '../paste';

// T9 设计 §5：纯函数单测
suite('paste 纯函数', () => {
  const NOW = new Date(2026, 10, 19, 14, 30, 1);

  test('pasteFileName：截图生成 paste-*（mime 扩展名）、原名保留', () => {
    assert.strictEqual(
      pasteFileName(NOW, undefined, 'image/png'),
      'paste-20261119-143001.png',
    );
    assert.strictEqual(
      pasteFileName(NOW, undefined, 'image/jpeg'),
      'paste-20261119-143001.jpg',
    );
    assert.strictEqual(
      pasteFileName(NOW, undefined, 'image/svg+xml'),
      'paste-20261119-143001.svg',
    );
    // 未知 mime 默认 png
    assert.strictEqual(
      pasteFileName(NOW, undefined, 'image/tiff'),
      'paste-20261119-143001.png',
    );
    // 原名（含中文/空格）原样保留
    assert.strictEqual(
      pasteFileName(NOW, '图片 1.png', 'image/png'),
      '图片 1.png',
    );
    assert.strictEqual(
      pasteFileName(NOW, 'my pic.png', 'image/png'),
      'my pic.png',
    );
    // 空名视同无名（合成名已被上游丢弃，这里再兜一层）
    assert.strictEqual(
      pasteFileName(NOW, '', 'image/png'),
      'paste-20261119-143001.png',
    );
  });

  test('mdImageLink：裸写；空格/括号 <> 包装（rewrite 安全化口径）', () => {
    assert.strictEqual(
      mdImageLink('https://img.x/a.png'),
      '![](https://img.x/a.png)',
    );
    assert.strictEqual(
      mdImageLink('https://img.x/a b.png'),
      '![](<https://img.x/a b.png>)',
    );
    assert.strictEqual(
      mdImageLink('https://img.x/a(b).png'),
      '![](<https://img.x/a(b).png>)',
    );
  });

  test('localImageLink：相对/子目录/上跳/反斜杠/绝对（untitled）', () => {
    assert.strictEqual(
      localImageLink('C:/ws', 'C:/ws/paste.png'),
      '![](./paste.png)',
    );
    assert.strictEqual(
      localImageLink('C:/ws', 'C:/ws/img/paste.png'),
      '![](./img/paste.png)',
    );
    assert.strictEqual(
      localImageLink('C:/ws/docs', 'C:/ws/paste.png'),
      '![](../paste.png)',
    );
    // Windows 反斜杠输入
    assert.strictEqual(
      localImageLink('C:\\ws\\docs', 'C:\\ws\\paste.png'),
      '![](../paste.png)',
    );
    // docDir 为 undefined（untitled）→ 绝对路径
    assert.strictEqual(
      localImageLink(undefined, 'C:\\ws\\paste.png'),
      '![](C:/ws/paste.png)',
    );
    // 不同盘无法相对 → 退绝对路径
    assert.strictEqual(
      localImageLink('C:/ws', 'D:/x/paste.png'),
      '![](D:/x/paste.png)',
    );
    // posix
    assert.strictEqual(
      localImageLink('/home/u/ws', '/home/u/ws/paste.png'),
      '![](./paste.png)',
    );
    // 含空格文件名安全化
    assert.strictEqual(
      localImageLink('C:/ws', 'C:/ws/my file.png'),
      '![](<./my file.png>)',
    );
  });

  test('resolveCollision：占用递增 -1/-2、无扩展名、点开头不拆', () => {
    assert.strictEqual(
      resolveCollision('base.png', () => false),
      'base.png',
    );
    assert.strictEqual(
      resolveCollision('base.png', (n) => n === 'base.png'),
      'base-1.png',
    );
    assert.strictEqual(
      resolveCollision(
        'base.png',
        (n) => n === 'base.png' || n === 'base-1.png',
      ),
      'base-2.png',
    );
    assert.strictEqual(
      resolveCollision('base', (n) => n === 'base'),
      'base-1',
    );
    assert.strictEqual(
      resolveCollision('a.b.png', (n) => n === 'a.b.png'),
      'a.b-1.png',
    );
  });

  test('buildInsertText：空 → undefined、一行一张按序', () => {
    assert.strictEqual(buildInsertText([]), undefined);
    assert.strictEqual(buildInsertText(['![](a)']), '![](a)');
    assert.strictEqual(
      buildInsertText(['![](a)', '![](b)', '![](c)']),
      '![](a)\n![](b)\n![](c)',
    );
  });
});
