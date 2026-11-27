import * as assert from 'assert';
import { type ParseResult, parseImageRefs } from '../parse';

// 黄金不变量：凡产出必查（设计 §5）
function parse(text: string): ParseResult {
  const res = parseImageRefs(text);
  for (const r of res.refs) {
    assert.strictEqual(
      text.slice(r.urlStart, r.urlEnd),
      r.rawUrl,
      `区间不变量失败: ${r.rawUrl}`,
    );
    assert.ok(r.urlStart >= 0 && r.urlEnd <= text.length);
    assert.ok(r.urlStart < r.urlEnd);
  }
  for (const s of res.skipped) {
    assert.ok(s.start < s.end, 'skipped 区间应非空');
    assert.notStrictEqual(s.reason, '');
  }
  for (let i = 1; i < res.refs.length; i += 1) {
    assert.ok(res.refs[i - 1].urlStart <= res.refs[i].urlStart, 'refs 应有序');
  }
  return res;
}

suite('parse 行内式矩阵', () => {
  test('基本行内式：URL 区间与清洗', () => {
    const text = '![a](./x.png)';
    const res = parse(text);
    assert.strictEqual(res.refs.length, 1);
    const r = res.refs[0];
    assert.strictEqual(r.kind, 'inline');
    assert.deepStrictEqual(r.target, { type: 'local', path: './x.png' });
    assert.strictEqual(r.key, 'x.png');
    assert.strictEqual(r.urlStart, 5);
    assert.strictEqual(r.rawUrl, './x.png');
    assert.strictEqual(r.useSpans, undefined);
  });

  test('title 三形式剥离且区间不含 title', () => {
    for (const text of [
      '![a](./x.png "t")',
      "![a](./x.png 't')",
      '![a](./x.png (t))',
    ]) {
      const res = parse(text);
      assert.strictEqual(res.refs.length, 1, text);
      assert.strictEqual(res.refs[0].rawUrl, './x.png', text);
      assert.deepStrictEqual(res.refs[0].target, {
        type: 'local',
        path: './x.png',
      });
    }
  });

  test('尖括号路径：含空格、含转义 >', () => {
    const res = parse('![a](<./x y.png>)');
    assert.strictEqual(res.refs[0].rawUrl, '<./x y.png>');
    assert.deepStrictEqual(res.refs[0].target, {
      type: 'local',
      path: './x y.png',
    });
    assert.strictEqual(res.refs[0].key, 'x y.png');

    const esc = parse('![a](<x\\>y.png>)');
    assert.strictEqual(esc.refs[0].rawUrl, '<x\\>y.png>');
    assert.deepStrictEqual(esc.refs[0].target, {
      type: 'local',
      path: 'x>y.png',
    });
  });

  test('%20 等编码 decode；decode 失败保留原值', () => {
    const ok = parse('![a](./x%20y.png)');
    assert.deepStrictEqual(ok.refs[0].target, {
      type: 'local',
      path: './x y.png',
    });
    const bad = parse('![a](./x%ZZ.png)');
    assert.deepStrictEqual(bad.refs[0].target, {
      type: 'local',
      path: './x%ZZ.png',
    });
  });

  test('嵌套括号与转义括号', () => {
    assert.deepStrictEqual(parse('![a](p(1).png)').refs[0].target, {
      type: 'local',
      path: 'p(1).png',
    });
    assert.deepStrictEqual(parse('![a](a\\(b\\).png)').refs[0].target, {
      type: 'local',
      path: 'a(b).png',
    });
    // 转义 \( 不闭合 dest
    assert.deepStrictEqual(parse('![a](a\\(b.png)').refs[0].target, {
      type: 'local',
      path: 'a(b.png',
    });
  });

  test('alt 含 [] 转义与嵌套', () => {
    const res = parse('![a[0]\\]](./x.png)');
    assert.strictEqual(res.refs.length, 1);
    assert.strictEqual(res.refs[0].rawUrl, './x.png');
  });

  test('链接内嵌图片：只认内层图片', () => {
    const res = parse('[![a](./x.png)](https://y)');
    assert.strictEqual(res.refs.length, 1);
    assert.strictEqual(res.refs[0].rawUrl, './x.png');
  });

  test('嵌套图片：CommonMark 内层优先，外层字面', () => {
    const res = parse('![a ![b](./y.png)](./x.png)');
    assert.strictEqual(res.refs.length, 1);
    assert.deepStrictEqual(res.refs[0].target, {
      type: 'local',
      path: './y.png',
    });
  });

  test('空目标静默跳过', () => {
    for (const text of ['![]()', '![](<>)', '![](  )']) {
      const res = parse(text);
      assert.strictEqual(res.refs.length, 0, text);
      assert.strictEqual(res.skipped.length, 0, text);
    }
  });

  test('query/fragment 截断：path 与 key 落在纯路径', () => {
    const res = parse('![a](./a.png?raw=1) ![b](./a.png#frag)');
    assert.strictEqual(res.refs.length, 2);
    assert.deepStrictEqual(res.refs[0].target, {
      type: 'local',
      path: './a.png',
    });
    assert.strictEqual(res.refs[0].key, 'a.png');
    assert.strictEqual(res.refs[1].key, 'a.png');
    // 粗筛也落在纯路径上：.pdf 截断后仍被拒
    assert.strictEqual(parse('![a](./a.pdf?raw=1)').refs.length, 0);
    // 纯 fragment 目标 → 空路径
    const frag = parse('![a](#anchor)');
    assert.strictEqual(frag.refs.length, 0);
    assert.strictEqual(frag.skipped.length, 0);
  });

  test('Windows 盘符判 local 不落 scheme', () => {
    for (const [text, path] of [
      ['![a](C:/img/a.png)', 'C:/img/a.png'],
      ['![a](C:\\img\\a.png)', 'C:\\img\\a.png'],
    ] as const) {
      const res = parse(text);
      assert.strictEqual(res.refs.length, 1, text);
      assert.deepStrictEqual(res.refs[0].target, { type: 'local', path });
      assert.strictEqual(res.refs[0].key, 'C:/img/a.png', text);
    }
  });
});

suite('parse 引用式矩阵', () => {
  test('定义处产出，useSpans 指向引用', () => {
    const text = '[r]: ./x.png "t"\n\n![a][r]';
    const res = parse(text);
    assert.strictEqual(res.refs.length, 1);
    const r = res.refs[0];
    assert.strictEqual(r.kind, 'refdef');
    assert.strictEqual(r.rawUrl, './x.png');
    assert.strictEqual(r.urlStart, text.indexOf('./x.png'));
    assert.deepStrictEqual(r.useSpans, [
      { start: text.indexOf('![a][r]'), end: text.indexOf('![a][r]') + 7 },
    ]);
  });

  test('三形态：![a][r] / ![r][] / ![r]', () => {
    const text = '[r]: ./x.png\n\n![a][r]\n\n![r][]\n\n![r]';
    const res = parse(text);
    assert.strictEqual(res.refs.length, 1);
    assert.strictEqual(res.refs[0].useSpans?.length, 3);
  });

  test('label 大小写 / 空白折叠匹配', () => {
    const res = parse('[My Label]: ./x.png\n\n![a][my  label]');
    assert.strictEqual(res.refs.length, 1);
  });

  test('重复 label 首个合法定义生效', () => {
    const res = parse('[r]: ./first.png\n\n[r]: ./second.png\n\n![a][r]');
    assert.strictEqual(res.refs.length, 1);
    assert.deepStrictEqual(res.refs[0].target, {
      type: 'local',
      path: './first.png',
    });
  });

  test('def 仅被普通链接使用 → 不产出', () => {
    const res = parse('[r]: ./x.png\n\n[text][r]');
    assert.strictEqual(res.refs.length, 0);
    assert.strictEqual(res.skipped.length, 0);
  });

  test('def 未被使用 → 不产出', () => {
    const res = parse('[r]: ./x.png\n\nhello');
    assert.strictEqual(res.refs.length, 0);
  });

  test('图片 + 链接共用 def → 产出', () => {
    const res = parse('[r]: ./x.png\n\n![a][r] and [text][r]');
    assert.strictEqual(res.refs.length, 1);
    assert.strictEqual(res.refs[0].useSpans?.length, 1);
  });

  test('多处图片引用共用 def：useSpans 覆盖全部引用区间', () => {
    const text = '[r]: ./x.png\n\n![a][r]\n\nsee below\n\n![b][r]';
    const res = parse(text);
    assert.strictEqual(res.refs.length, 1);
    assert.deepStrictEqual(res.refs[0].useSpans, [
      { start: text.indexOf('![a][r]'), end: text.indexOf('![a][r]') + 7 },
      { start: text.indexOf('![b][r]'), end: text.indexOf('![b][r]') + 7 },
    ]);
  });

  test('def dest 可疑且被图片引用 → 列入报告', () => {
    const res = parse('[r]: my file.png\n\n![a][r]');
    assert.strictEqual(res.refs.length, 0);
    assert.strictEqual(res.skipped.length, 1);
    assert.strictEqual(res.skipped[0].reason, 'unwrappedSpace');
  });

  test('def dest 可疑但无图片引用 → 静默（普通链接不报）', () => {
    const res = parse('[r]: my file.png\n\ntext');
    assert.strictEqual(res.skipped.length, 0);
  });
});

suite('parse HTML 矩阵', () => {
  test('双引号 / 单引号 / 无引号 src', () => {
    for (const text of [
      '<img src="./x.png">',
      "<img src='./x.png'>",
      '<img src=./x.png>',
    ]) {
      const res = parse(text);
      assert.strictEqual(res.refs.length, 1, text);
      const r = res.refs[0];
      assert.strictEqual(r.kind, 'html');
      assert.strictEqual(r.rawUrl, './x.png'); // 引号不含在区间内
      assert.deepStrictEqual(r.target, { type: 'local', path: './x.png' });
    }
  });

  test('大小写、多属性、属性跨行', () => {
    for (const text of [
      '<IMG SRC="./x.png">',
      '<img class="a" src="./x.png" alt="b">',
      '<img\n  class="a"\n  src="./x.png">',
    ]) {
      const res = parse(text);
      assert.strictEqual(res.refs.length, 1, text);
      assert.strictEqual(res.refs[0].rawUrl, './x.png');
    }
  });

  test('data-src / x-src 不命中', () => {
    for (const text of ['<img data-src="./x.png">', '<img x-src="./x.png">']) {
      const res = parse(text);
      assert.strictEqual(res.refs.length, 0, text);
      assert.strictEqual(res.skipped.length, 0, text);
    }
  });

  test('实体解码', () => {
    const res = parse('<img src="a&amp;b.png">');
    assert.deepStrictEqual(res.refs[0].target, {
      type: 'local',
      path: 'a&b.png',
    });
  });

  test('src={expr} 静默跳过', () => {
    const res = parse('<img src={img} />');
    assert.strictEqual(res.refs.length, 0);
    assert.strictEqual(res.skipped.length, 0);
  });

  test('src 无值 → 可疑跳过', () => {
    const res = parse('<img src>');
    assert.strictEqual(res.refs.length, 0);
    assert.strictEqual(res.skipped.length, 1);
    assert.strictEqual(res.skipped[0].reason, 'emptySrcAttr');
  });

  test('src="" 空值静默跳过', () => {
    const res = parse('<img src="">');
    assert.strictEqual(res.refs.length, 0);
    assert.strictEqual(res.skipped.length, 0);
  });
});

suite('parse 代码区矩阵', () => {
  test('围栏内不产出，正文对照组产出', () => {
    const res = parse('```\n![a](./x.png)\n```\n\n![b](./y.png)');
    assert.strictEqual(res.refs.length, 1);
    assert.deepStrictEqual(res.refs[0].target, {
      type: 'local',
      path: './y.png',
    });
  });

  test('~~~ 围栏、行内代码、缩进代码块', () => {
    assert.strictEqual(parse('~~~\n![a](./x.png)\n~~~').refs.length, 0);
    assert.strictEqual(parse('`![a](./x.png)`').refs.length, 0);
    assert.strictEqual(
      parse('intro\n\n    ![a](./x.png)\n\nafter').refs.length,
      0,
    );
  });

  test('围栏起始行 info string 含伪候选', () => {
    assert.strictEqual(parse('```js ![a](./x.png)\ntext\n```').refs.length, 0);
  });

  test('长围栏闭合规则：```` 可关 ```，``` 不关 ````', () => {
    const res = parse('````\n```\n![a](./x.png)\n````\n\n![b](./y.png)');
    assert.strictEqual(res.refs.length, 1);
    assert.deepStrictEqual(res.refs[0].target, {
      type: 'local',
      path: './y.png',
    });
  });

  test('未闭合围栏延伸到文档末尾', () => {
    assert.strictEqual(parse('```\n![a](./x.png)\n').refs.length, 0);
  });

  test('围栏内孤立反引号不开 code span，不吞正文图片', () => {
    const res = parse('```\n`\n```\n` ![a](./x.png)');
    assert.strictEqual(res.refs.length, 1);
  });

  test('缩进懒延续行是段落不是代码', () => {
    const res = parse('para\n    ![a](./x.png)\nmore');
    assert.strictEqual(res.refs.length, 1);
  });

  test('CRLF 换行的围栏', () => {
    assert.strictEqual(parse('```\r\n![a](./x.png)\r\n```').refs.length, 0);
  });
});

suite('parse 粗筛与 remote', () => {
  test('local 扩展名粗筛：大小写不敏感', () => {
    assert.strictEqual(parse('![a](./x.pdf)').refs.length, 0);
    assert.strictEqual(parse('![a](./noext)').refs.length, 0);
    assert.strictEqual(parse('![a](./x.PNG)').refs.length, 1);
  });

  test('remote 无扩展名不粗筛，host/key 正确', () => {
    const res = parse('![](https://img.shields.io/badge/foo-bar)');
    assert.strictEqual(res.refs.length, 1);
    assert.deepStrictEqual(res.refs[0].target, {
      type: 'remote',
      url: 'https://img.shields.io/badge/foo-bar',
      host: 'img.shields.io',
    });
    assert.strictEqual(res.refs[0].key, 'https://img.shields.io/badge/foo-bar');
  });

  test('remote 不做 URI decode：%2F 与 / 是不同 key', () => {
    const res = parse('![](https://x/a%2Fb.png) ![](https://x/a/b.png)');
    assert.strictEqual(res.refs.length, 2);
    assert.strictEqual(res.refs[0].key, 'https://x/a%2Fb.png');
    assert.strictEqual(res.refs[1].key, 'https://x/a/b.png');
  });

  test('data: 等其它 scheme 静默跳过', () => {
    const res = parse('![](data:image/png;base64,xx) ![](mailto:a@b.png)');
    assert.strictEqual(res.refs.length, 0);
    assert.strictEqual(res.skipped.length, 0);
  });
});

suite('parse 可疑跳过', () => {
  test('裸空格 dest：列入报告且不产出', () => {
    const res = parse('![a](my file.png)');
    assert.strictEqual(res.refs.length, 0);
    assert.strictEqual(res.skipped.length, 1);
    assert.strictEqual(res.skipped[0].reason, 'unwrappedSpace');
  });

  test('尖括号未闭合 / 非法残留', () => {
    const a = parse('![a](<p.png")');
    assert.strictEqual(a.skipped.length, 1);
    assert.strictEqual(a.skipped[0].reason, 'unclosedAngleUrl');
    const b = parse('![a](<p.png> xyz)');
    assert.strictEqual(b.skipped.length, 1);
    assert.strictEqual(b.skipped[0].reason, 'illegalResidue');
  });

  test('协议相对 URL 可疑跳过', () => {
    const res = parse('![](//host/a.png)');
    assert.strictEqual(res.refs.length, 0);
    assert.strictEqual(res.skipped.length, 1);
    assert.strictEqual(res.skipped[0].reason, 'protocolRelative');
  });

  test('括号未闭合可可疑跳过', () => {
    const res = parse('![a](./x.png');
    assert.strictEqual(res.skipped.length, 1);
    assert.strictEqual(res.skipped[0].reason, 'unclosedParen');
  });

  test('可疑 dest 内部的内层候选照常识别', () => {
    const res = parse('![a](my file.png ![b](./x.png))');
    assert.strictEqual(res.skipped.length, 1);
    assert.strictEqual(res.refs.length, 1);
    assert.deepStrictEqual(res.refs[0].target, {
      type: 'local',
      path: './x.png',
    });
  });
});

suite('parse 去重键', () => {
  test('同文件异写法同键', () => {
    const res = parse(
      '![a](./img/a.png) ![b](img/a.png) ![c](img/./a.png) ![d](img\\a.png)',
    );
    assert.strictEqual(res.refs.length, 4);
    for (const r of res.refs) {
      assert.strictEqual(r.key, 'img/a.png');
    }
  });

  test('不同路径不同键', () => {
    const res = parse('![a](../a.png) ![b](a.png)');
    assert.strictEqual(res.refs[0].key, '../a.png');
    assert.strictEqual(res.refs[1].key, 'a.png');
  });

  test('UNC 前导不折叠，与相对路径不误合并', () => {
    const text = String.raw`![a](\\\\server\share\a.png) ![b](server/share/a.png)`;
    const res = parse(text);
    assert.strictEqual(res.refs.length, 2);
    assert.strictEqual(res.refs[0].key, '//server/share/a.png');
    assert.strictEqual(res.refs[1].key, 'server/share/a.png');
  });
});
