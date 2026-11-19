import * as assert from 'assert';
import { type ImageRef, parseImageRefs } from '../parse';
import { type Replacement, buildReplacements } from '../rewrite';

// 核心断言方式：把 Replacement[] 按返回顺序 splice 进原文（设计 §5）
function apply(text: string, reps: Replacement[]): string {
  let out = text;
  for (const r of reps) {
    out = out.slice(0, r.start) + r.text + out.slice(r.end);
  }
  return out;
}

// 手工构造 ImageRef（区间与 key 对齐 T4 产出形态）
function refOf(
  text: string,
  rawUrl: string,
  key: string,
  kind: ImageRef['kind'] = 'inline',
  occurrence = 0,
): ImageRef {
  let start = -1;
  for (let i = 0; i <= occurrence; i += 1) {
    start = text.indexOf(rawUrl, start + 1);
    assert.notStrictEqual(start, -1, `fixture 中找不到 ${rawUrl}`);
  }
  return {
    kind,
    urlStart: start,
    urlEnd: start + rawUrl.length,
    rawUrl,
    target: { type: 'local', path: rawUrl },
    key,
  };
}

suite('rewrite 只换 URL、结构不动', () => {
  test('行内式 title 原样', () => {
    const text = '![alt](./x.png "t")';
    const reps = buildReplacements(
      [refOf(text, './x.png', 'x.png')],
      new Map([['x.png', 'https://x/a.png']]),
    );
    assert.strictEqual(apply(text, reps), '![alt](https://x/a.png "t")');
  });

  test('尖括号区间含包装 → 整体换成裸安全 URL', () => {
    const text = '![a](<./x y.png>)';
    const reps = buildReplacements(
      [refOf(text, '<./x y.png>', 'x y.png')],
      new Map([['x y.png', 'https://x/a.png']]),
    );
    assert.strictEqual(apply(text, reps), '![a](https://x/a.png)');
  });

  test('HTML 引号原样只换值', () => {
    const text = '<img src="./x.png">';
    const reps = buildReplacements(
      [refOf(text, './x.png', 'x.png', 'html')],
      new Map([['x.png', 'https://x/a.png']]),
    );
    assert.strictEqual(apply(text, reps), '<img src="https://x/a.png">');
  });

  test('refdef 只换定义处，引用处不动', () => {
    const text = '[r]: ./x.png "t"\n\n![a][r]';
    const reps = buildReplacements(
      [refOf(text, './x.png', 'x.png', 'refdef')],
      new Map([['x.png', 'https://x/a.png']]),
    );
    assert.strictEqual(
      apply(text, reps),
      '[r]: https://x/a.png "t"\n\n![a][r]',
    );
  });
});

suite('rewrite 倒序与多处', () => {
  test('3 处一次替换：输出降序、splice 无索引漂移', () => {
    const text = '![a](./a.png)\n![b](./b.png)\n![c](./c.png)';
    const refs = [
      refOf(text, './a.png', 'a.png'),
      refOf(text, './b.png', 'b.png'),
      refOf(text, './c.png', 'c.png'),
    ];
    const reps = buildReplacements(
      refs,
      new Map([
        ['a.png', 'https://x/1.png'],
        ['b.png', 'https://x/2.png'],
        ['c.png', 'https://x/3.png'],
      ]),
    );
    for (let i = 1; i < reps.length; i += 1) {
      assert.ok(reps[i - 1].start > reps[i].start, '应按 start 降序');
    }
    assert.strictEqual(
      apply(text, reps),
      '![a](https://x/1.png)\n![b](https://x/2.png)\n![c](https://x/3.png)',
    );
  });

  test('同 key 3 处 → 3 处同一 URL（验收 10 回写侧）', () => {
    const text = '![a](./x.png)\n![b](./x.png)\n![c](./x.png)';
    const refs = [
      refOf(text, './x.png', 'x.png', 'inline', 0),
      refOf(text, './x.png', 'x.png', 'inline', 1),
      refOf(text, './x.png', 'x.png', 'inline', 2),
    ];
    const reps = buildReplacements(
      refs,
      new Map([['x.png', 'https://x/a.png']]),
    );
    assert.strictEqual(
      apply(text, reps),
      '![a](https://x/a.png)\n![b](https://x/a.png)\n![c](https://x/a.png)',
    );
  });
});

suite('rewrite 缺 key / 空 URL 跳过', () => {
  test('缺 key：原文保留，其余正常（4.4）', () => {
    const text = '![a](./a.png)\n![b](./b.png)';
    const refs = [
      refOf(text, './a.png', 'a.png'),
      refOf(text, './b.png', 'b.png'),
    ];
    const reps = buildReplacements(
      refs,
      new Map([['a.png', 'https://x/1.png']]),
    );
    assert.strictEqual(
      apply(text, reps),
      '![a](https://x/1.png)\n![b](./b.png)',
    );
  });

  test('URL 值为空串或纯空白：跳过（§2.4）', () => {
    const text = '![a](./a.png)\n![b](./b.png)\n![c](./c.png)';
    const refs = [
      refOf(text, './a.png', 'a.png'),
      refOf(text, './b.png', 'b.png'),
      refOf(text, './c.png', 'c.png'),
    ];
    const reps = buildReplacements(
      refs,
      new Map([
        ['a.png', ''],
        ['b.png', '   '],
        ['c.png', 'https://x/3.png'],
      ]),
    );
    assert.strictEqual(
      apply(text, reps),
      '![a](./a.png)\n![b](./b.png)\n![c](https://x/3.png)',
    );
  });
});

suite('rewrite 安全化矩阵（§2.3）', () => {
  // 同一 URL 过 markdown 与 html 两个上下文
  const check = (url: string, md: string, html: string) => {
    const mdText = '![](./x.png)';
    assert.strictEqual(
      apply(
        mdText,
        buildReplacements(
          [refOf(mdText, './x.png', 'x.png')],
          new Map([['x.png', url]]),
        ),
      ),
      `![](${md})`,
    );
    const htmlText = '<img src="./x.png">';
    assert.strictEqual(
      apply(
        htmlText,
        buildReplacements(
          [refOf(htmlText, './x.png', 'x.png', 'html')],
          new Map([['x.png', url]]),
        ),
      ),
      `<img src="${html}">`,
    );
  };

  test('安全 URL：两上下文均裸写原样', () =>
    check('https://x/a.png', 'https://x/a.png', 'https://x/a.png'));

  test('空格：markdown 包 <> 一字不差、html 编码 %20', () =>
    check(
      'https://x/abc_图 1.png',
      '<https://x/abc_图 1.png>',
      'https://x/abc_图%201.png',
    ));

  test('括号：markdown 一律包装（宁稳勿省）、html 只编码空白', () =>
    check(
      'https://x/report (final).png',
      '<https://x/report (final).png>',
      'https://x/report%20(final).png',
    ));

  test('引号：html 编码 %22/%27、markdown 裸写', () =>
    check(
      `https://x/a"b'c.png`,
      `https://x/a"b'c.png`,
      'https://x/a%22b%27c.png',
    ));

  test('尖括号/反斜杠：markdown 包装内 %3C/%3E/%5C、html 只编码尖括号', () =>
    check(
      'https://x/a<b>c\\d.png',
      '<https://x/a%3Cb%3Ec%5Cd.png>',
      'https://x/a%3Cb%3Ec\\d.png',
    ));

  test('控制符（换行）：两上下文均百分号编码', () =>
    check(
      'https://x/a\nb.png',
      '<https://x/a%0Ab.png>',
      'https://x/a%0Ab.png',
    ));

  test('NBSP（T4 终止类并集）：markdown 包装保留字面量、html 按 UTF-8 编码', () =>
    check(
      'https://x/a\u00a0b.png',
      '<https://x/a\u00a0b.png>',
      'https://x/a%C2%A0b.png',
    ));

  test('refdef 同 markdown 规则（含 <> 包装）', () => {
    const text = '[r]: ./x.png "t"';
    const reps = buildReplacements(
      [refOf(text, './x.png', 'x.png', 'refdef')],
      new Map([['x.png', 'https://x/abc_图 1.png']]),
    );
    assert.strictEqual(apply(text, reps), '[r]: <https://x/abc_图 1.png> "t"');
  });
});

suite('rewrite 无引号属性形态', () => {
  test('无引号 src + 含空格 URL：空白不得终结属性值（P0 场景）', () => {
    const text = '<img src=./x.png>';
    const reps = buildReplacements(
      [refOf(text, './x.png', 'x.png', 'html')],
      new Map([['x.png', 'https://x/abc_图 1.png']]),
    );
    assert.strictEqual(apply(text, reps), '<img src=https://x/abc_图%201.png>');
  });

  test('单引号属性过同一矩阵', () => {
    const text = "<img src='./x.png'>";
    const reps = buildReplacements(
      [refOf(text, './x.png', 'x.png', 'html')],
      new Map([['x.png', "https://x/a'b c.png"]]),
    );
    assert.strictEqual(
      apply(text, reps),
      "<img src='https://x/a%27b%20c.png'>",
    );
  });
});

suite('rewrite 解析往返（与 T4 区间口径契约）', () => {
  test('parseImageRefs 产出直接喂 buildReplacements，splice 全文逐字对比', () => {
    const text = [
      '![alt](./x.png "t")',
      '',
      '![d](<./y z.png>)',
      '',
      '[r]: ./x.png "d"',
      '',
      '![c][r]',
      '',
      '<img src="./x.png">',
      '<img src=./x.png>',
      '',
      '![e](https://old.example/a.png)',
    ].join('\n');
    const { refs } = parseImageRefs(text);
    for (const r of refs) {
      assert.strictEqual(text.slice(r.urlStart, r.urlEnd), r.rawUrl);
    }
    const urlByKey = new Map([
      ['x.png', 'https://x/abc_图 1.png'],
      ['y z.png', 'https://x/y.png'],
      ['https://old.example/a.png', 'https://new.example/b.png'],
    ]);
    const expected = [
      '![alt](<https://x/abc_图 1.png> "t")',
      '',
      '![d](https://x/y.png)',
      '',
      '[r]: <https://x/abc_图 1.png> "d"',
      '',
      '![c][r]',
      '',
      '<img src="https://x/abc_图%201.png">',
      '<img src=https://x/abc_图%201.png>',
      '',
      '![e](https://new.example/b.png)',
    ].join('\n');
    assert.strictEqual(
      apply(text, buildReplacements(refs, urlByKey)),
      expected,
    );
  });
});

suite('rewrite 乱序输入与空输入', () => {
  test('refs 打乱顺序：输出仍降序、全文正确', () => {
    const text = '![a](./a.png)\n![b](./b.png)\n![c](./c.png)';
    const refs = [
      refOf(text, './a.png', 'a.png'),
      refOf(text, './b.png', 'b.png'),
      refOf(text, './c.png', 'c.png'),
    ];
    const map = new Map([
      ['a.png', 'https://x/1.png'],
      ['b.png', 'https://x/2.png'],
      ['c.png', 'https://x/3.png'],
    ]);
    const shuffled = buildReplacements([refs[2], refs[0], refs[1]], map);
    assert.deepStrictEqual(shuffled, buildReplacements(refs, map));
    assert.strictEqual(
      apply(text, shuffled),
      '![a](https://x/1.png)\n![b](https://x/2.png)\n![c](https://x/3.png)',
    );
  });

  test('空引用集 / 空 map：返回空数组', () => {
    assert.deepStrictEqual(buildReplacements([], new Map()), []);
    const text = '![a](./a.png)';
    assert.deepStrictEqual(
      buildReplacements([refOf(text, './a.png', 'a.png')], new Map()),
      [],
    );
  });
});
