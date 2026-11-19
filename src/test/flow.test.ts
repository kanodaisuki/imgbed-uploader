import * as assert from 'assert';
import * as path from 'node:path';
import { type ImageRef, parseImageRefs } from '../parse';
import { buildReplacements, markdownText } from '../rewrite';
import {
  type UploadItem,
  planFileInsert,
  planUploads,
  resolveLocalPath,
  runUploads,
  selfHosts,
} from '../flow';

const BASE = {
  uploadRemoteImages: false,
  remoteWhitelist: [] as string[],
  selfHosts: [] as string[],
};

function localRef(key: string, at = 0): ImageRef {
  return {
    kind: 'inline',
    urlStart: at,
    urlEnd: at + 1,
    rawUrl: key,
    target: { type: 'local', path: key },
    key,
  };
}

function remoteRef(key: string, host: string, at = 0): ImageRef {
  return {
    kind: 'inline',
    urlStart: at,
    urlEnd: at + 1,
    rawUrl: key,
    target: { type: 'remote', url: key, host },
    key,
  };
}

function localItem(key: string, name: string): UploadItem {
  return {
    key,
    refs: [localRef(key)],
    source: { type: 'local', path: `img/${name}` },
  };
}

function remoteItem(url: string, host: string): UploadItem {
  return {
    key: url,
    refs: [remoteRef(url, host)],
    source: { type: 'remote', url },
  };
}

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

suite('flow planUploads 去重与分组', () => {
  test('同 key 3 引用 → 1 item、refs 含 3 区间（验收 10 上传侧）', () => {
    const plan = planUploads(
      [localRef('a.png', 0), localRef('a.png', 10), localRef('a.png', 20)],
      BASE,
    );
    assert.strictEqual(plan.items.length, 1);
    assert.strictEqual(plan.items[0].key, 'a.png');
    assert.strictEqual(plan.items[0].refs.length, 3);
    assert.deepStrictEqual(plan.skipped, []);
  });

  test('不同 key 按文档顺序成组', () => {
    const plan = planUploads(
      [localRef('b.png', 0), localRef('a.png', 10)],
      BASE,
    );
    assert.deepStrictEqual(
      plan.items.map((i) => i.key),
      ['b.png', 'a.png'],
    );
  });
});

suite('flow 远程策略与幂等', () => {
  test('remote 默认跳过（转存关）', () => {
    const plan = planUploads([remoteRef('https://x/a.png', 'x.com')], BASE);
    assert.strictEqual(plan.items.length, 0);
    assert.deepStrictEqual(plan.skipped, [
      { key: 'https://x/a.png', reason: '远程图像跳过（未开启转存）' },
    ]);
  });

  test('转存开启 + 白名单命中 → 跳过', () => {
    const plan = planUploads([remoteRef('https://x/a.png', 'x.com')], {
      ...BASE,
      uploadRemoteImages: true,
      remoteWhitelist: ['x.com'],
    });
    assert.strictEqual(plan.items.length, 0);
    assert.strictEqual(plan.skipped[0].reason, '命中白名单跳过');
  });

  test('转存开启 + 非白名单 → 进计划转存', () => {
    const plan = planUploads([remoteRef('https://x/a.png', 'x.com')], {
      ...BASE,
      uploadRemoteImages: true,
    });
    assert.strictEqual(plan.items.length, 1);
    assert.deepStrictEqual(plan.items[0].source, {
      type: 'remote',
      url: 'https://x/a.png',
    });
    assert.deepStrictEqual(plan.skipped, []);
  });

  test('已回写自识别：serverUrl/customCdn host 跳过（转存开启亦然）', () => {
    const plan = planUploads(
      [
        remoteRef('https://img.example.com/a.png', 'img.example.com'),
        remoteRef('https://cdn.example.com/b.png', 'cdn.example.com'),
        remoteRef('https://other.com/c.png', 'other.com'),
      ],
      {
        ...BASE,
        uploadRemoteImages: true,
        selfHosts: ['img.example.com', 'cdn.example.com'],
      },
    );
    assert.deepStrictEqual(
      plan.skipped.map((s) => s.reason),
      ['已回写链接，幂等跳过', '已回写链接，幂等跳过'],
    );
    assert.deepStrictEqual(
      plan.items.map((i) => i.key),
      ['https://other.com/c.png'],
    );
  });

  test('白名单匹配：trim/小写容错、子域不命中（5.4）', () => {
    const plan = planUploads(
      [
        remoteRef('https://img.shields.io/badge.svg', 'img.shields.io'),
        remoteRef('https://a.example.com/x.png', 'a.example.com'),
      ],
      {
        ...BASE,
        uploadRemoteImages: true,
        remoteWhitelist: [' IMG.Shields.IO ', 'example.com'],
      },
    );
    assert.strictEqual(plan.skipped[0].reason, '命中白名单跳过');
    assert.deepStrictEqual(
      plan.items.map((i) => i.key),
      ['https://a.example.com/x.png'],
    );
  });

  test('验收 12 投影：旧 CDN remote 全跳过零上传，本地引用照传', async () => {
    const refs = [
      remoteRef('https://old-cdn.x/file/a.png', 'old-cdn.x'),
      remoteRef('https://img.example.com/file/b.png', 'img.example.com'),
    ];
    // customCdn 已改过：selfHosts 只含新 host，旧 CDN 链接不识别但仍默认跳过
    const opts = { ...BASE, selfHosts: ['img.example.com'] };
    let ioCalls = 0;
    const io: Parameters<typeof runUploads>[1] = {
      readLocal: async () => {
        ioCalls += 1;
        return new Uint8Array();
      },
      downloadRemote: async () => {
        ioCalls += 1;
        throw new Error('unused');
      },
      upload: async () => {
        ioCalls += 1;
        return { url: 'https://x' };
      },
    };
    const plan = planUploads(refs, opts);
    assert.deepStrictEqual(plan.items, []);
    assert.strictEqual(plan.skipped.length, 2);
    await runUploads(plan.items, io, {
      onProgress: () => {},
      isCancelled: () => false,
    });
    assert.strictEqual(ioCalls, 0, 'fake io 零调用（零上传零改写）');

    // 对照：+1 个本地引用 → 仅本地进计划，旧 remote 照跳
    const plan2 = planUploads([...refs, localRef('a.png', 30)], opts);
    assert.deepStrictEqual(
      plan2.items.map((i) => i.key),
      ['a.png'],
    );
    assert.strictEqual(plan2.skipped.length, 2);
  });
});

suite('flow 选区过滤（FR-2）', () => {
  test('inline 按 URL 区间相交命中；不相交不命中且不计跳过', () => {
    const hit = planUploads([localRef('a.png', 10)], {
      ...BASE,
      selection: { start: 10, end: 12 },
    });
    assert.strictEqual(hit.items.length, 1);
    const miss = planUploads([localRef('a.png', 10)], {
      ...BASE,
      selection: { start: 11, end: 20 },
    });
    assert.deepStrictEqual(miss.items, []);
    assert.deepStrictEqual(miss.skipped, []); // 选区外不计跳过
  });

  test('refdef：useSpans 第 2 个与定义行 URL 区间都命中', () => {
    const ref: ImageRef = {
      kind: 'refdef',
      urlStart: 100,
      urlEnd: 110,
      rawUrl: './x.png',
      target: { type: 'local', path: './x.png' },
      key: 'x.png',
      useSpans: [
        { start: 5, end: 8 },
        { start: 40, end: 43 },
      ],
    };
    const byUse = planUploads([ref], {
      ...BASE,
      selection: { start: 41, end: 42 },
    });
    assert.strictEqual(byUse.items.length, 1);
    const byDef = planUploads([ref], {
      ...BASE,
      selection: { start: 102, end: 103 },
    });
    assert.strictEqual(byDef.items.length, 1);
    const none = planUploads([ref], {
      ...BASE,
      selection: { start: 0, end: 2 },
    });
    assert.deepStrictEqual(none.items, []);
  });
});

suite('flow resolveLocalPath（4.8）', () => {
  test('相对路径拼文档目录、绝对/盘符/UNC 直用', () => {
    const rel = resolveLocalPath('/docs', './img/a.png');
    assert.ok(rel.ok);
    if (rel.ok) {
      assert.strictEqual(rel.path, path.resolve('/docs', './img/a.png'));
    }
    const drive = resolveLocalPath('/docs', 'C:\\img\\a.png');
    assert.ok(drive.ok);
    if (drive.ok) {
      assert.strictEqual(drive.path, path.normalize('C:\\img\\a.png'));
    }
    const unc = resolveLocalPath('/docs', '\\\\server\\share\\a.png');
    assert.ok(unc.ok);
  });

  test('untitled 相对路径 → 失败「先保存」（验收 13）', () => {
    const r = resolveLocalPath(undefined, './img/a.png');
    assert.ok(!r.ok);
    if (!r.ok) {
      assert.ok(r.error.includes('先保存'));
    }
  });
});

suite('flow runUploads', () => {
  type Io = Parameters<typeof runUploads>[1];
  type Hooks = Parameters<typeof runUploads>[2];
  const noHooks: Hooks = { onProgress: () => {}, isCancelled: () => false };

  test('部分失败聚合：成功保留、error 透传、文件名取 basename（验收 2）', async () => {
    const uploaded: string[] = [];
    const io: Io = {
      readLocal: async (p) => {
        if (p.includes('bad')) {
          throw new Error(`文件不存在或不可读：${p}`);
        }
        return new Uint8Array([1]);
      },
      downloadRemote: async () => {
        throw new Error('unused');
      },
      upload: async (file) => {
        uploaded.push(file.name);
        return { url: `https://x/${file.name}` };
      },
    };
    const results = await runUploads(
      [
        localItem('a', 'a.png'),
        localItem('bad', 'bad.png'),
        localItem('c', 'c.png'),
      ],
      io,
      noHooks,
    );
    assert.strictEqual(results.length, 3);
    assert.strictEqual(results.filter((r) => r.ok).length, 2);
    assert.ok(!results[1].ok);
    if (!results[1].ok) {
      assert.ok(results[1].error.includes('文件不存在'));
    }
    assert.deepStrictEqual(uploaded.sort(), ['a.png', 'c.png']);
  });

  test('并发 3：同时在途 ≤ 3、全部完成、进度回调（4.2）', async () => {
    let inFlight = 0;
    let peak = 0;
    const releases: Array<() => void> = [];
    const progress: Array<[number, number]> = [];
    const io: Io = {
      readLocal: async () => new Uint8Array(),
      downloadRemote: async () => {
        throw new Error('unused');
      },
      upload: (file) =>
        new Promise<{ url: string }>((resolve) => {
          inFlight += 1;
          peak = Math.max(peak, inFlight);
          releases.push(() => {
            inFlight -= 1;
            resolve({ url: `https://x/${file.name}` });
          });
        }),
    };
    const items = ['1', '2', '3', '4', '5'].map((n) =>
      localItem(`k${n}`, `${n}.png`),
    );
    const done = runUploads(items, io, {
      onProgress: (d, t) => progress.push([d, t]),
      isCancelled: () => false,
    });
    await delay(10);
    assert.strictEqual(releases.length, 3, '只应同时派发 3 个');
    for (const release of releases.splice(0)) {
      release();
    }
    await delay(10);
    assert.strictEqual(releases.length, 2, '完成后补位派发');
    for (const release of releases.splice(0)) {
      release();
    }
    const results = await done;
    assert.strictEqual(results.length, 5);
    assert.strictEqual(peak, 3);
    assert.deepStrictEqual(progress[progress.length - 1], [5, 5]);
  });

  test('取消：停止派发、in-flight 完成保留、未派发数 = items − results（4.5）', async () => {
    let cancelled = false;
    const releases: Array<() => void> = [];
    const io: Io = {
      readLocal: async () => new Uint8Array(),
      downloadRemote: async () => {
        throw new Error('unused');
      },
      upload: (file) =>
        new Promise<{ url: string }>((resolve) => {
          releases.push(() => resolve({ url: `https://x/${file.name}` }));
        }),
    };
    const items = ['1', '2', '3', '4', '5'].map((n) =>
      localItem(`k${n}`, `${n}.png`),
    );
    const done = runUploads(items, io, {
      onProgress: () => {},
      isCancelled: () => cancelled,
    });
    await delay(10);
    cancelled = true;
    for (const release of releases.splice(0)) {
      release();
    }
    const results = await done;
    assert.strictEqual(results.length, 3, '只计已尝试项');
    assert.strictEqual(items.length - results.length, 2);
    assert.ok(results.every((r) => r.ok));
  });

  test('并发 1：串行派发（FR-4 逐个上传，T7 §2.3）', async () => {
    const releases: Array<() => void> = [];
    const io: Io = {
      readLocal: async () => new Uint8Array(),
      downloadRemote: async () => {
        throw new Error('unused');
      },
      upload: (file) =>
        new Promise<{ url: string }>((resolve) => {
          releases.push(() => resolve({ url: `https://x/${file.name}` }));
        }),
    };
    const items = ['1', '2', '3'].map((n) => localItem(`k${n}`, `${n}.png`));
    const done = runUploads(items, io, noHooks, 1);
    await delay(10);
    assert.strictEqual(releases.length, 1, '并发 1 时仅派发 1 个');
    for (const release of releases.splice(0)) {
      release();
    }
    await delay(10);
    assert.strictEqual(releases.length, 1, '完成 1 个后才补 1 个');
    for (const release of releases.splice(0)) {
      release();
    }
    await delay(10);
    for (const release of releases.splice(0)) {
      release();
    }
    const results = await done;
    assert.strictEqual(results.length, 3);
    assert.ok(results.every((r) => r.ok));
  });

  test('转存链路：downloadRemote 产物直传 upload', async () => {
    const calls: Array<{ name: string; data: Uint8Array }> = [];
    const data = new Uint8Array([7, 7]);
    const io: Io = {
      readLocal: async () => {
        throw new Error('unused');
      },
      downloadRemote: async () => ({ name: 'dl.png', data }),
      upload: async (file) => {
        calls.push({ name: file.name, data: file.data });
        return { url: 'https://x/dl.png' };
      },
    };
    const results = await runUploads(
      [remoteItem('https://old/a.png', 'old.com')],
      io,
      noHooks,
    );
    assert.strictEqual(results.length, 1);
    assert.ok(results[0].ok);
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].name, 'dl.png');
    assert.strictEqual(calls[0].data, data);
  });

  test('转存下载失败 → 失败项、error 透传（FR-5 原链接保留侧）', async () => {
    const io: Io = {
      readLocal: async () => {
        throw new Error('unused');
      },
      downloadRemote: async () => {
        throw new Error('下载超时（30 秒）');
      },
      upload: async () => {
        throw new Error('unused');
      },
    };
    const results = await runUploads(
      [remoteItem('https://old/a.png', 'old.com')],
      io,
      noHooks,
    );
    assert.ok(!results[0].ok);
    if (!results[0].ok) {
      assert.strictEqual(results[0].error, '下载超时（30 秒）');
    }
  });
});

suite('flow 重试过滤与重定位', () => {
  test('onlyKeys 只计划失败 key，不入计划的不计跳过', () => {
    const plan = planUploads([localRef('a.png', 0), localRef('b.png', 10)], {
      ...BASE,
      onlyKeys: new Set(['a.png']),
    });
    assert.deepStrictEqual(
      plan.items.map((i) => i.key),
      ['a.png'],
    );
    assert.deepStrictEqual(plan.skipped, []);
  });

  test('重定位：成功 key 全部引用回写（含选区外）、key 被改掉不回写（§2.3）', () => {
    const text = '![a](./x.png)\n\n![b](./y.png)\n\n![c](./x.png)';
    const { refs } = parseImageRefs(text);
    const succeeded = new Map([['x.png', 'https://x/a.png']]);
    const fresh = refs.filter((r) => succeeded.has(r.key));
    assert.strictEqual(fresh.length, 2);
    const reps = buildReplacements(fresh, succeeded);
    let out = text;
    for (const rep of reps) {
      out = out.slice(0, rep.start) + rep.text + out.slice(rep.end);
    }
    assert.strictEqual(
      out,
      '![a](https://x/a.png)\n\n![b](./y.png)\n\n![c](https://x/a.png)',
    );

    // 用户把第一处改成 ./z.png → key 变化 → 不回写
    const edited = '![a](./z.png)\n\n![b](./y.png)\n\n![c](./x.png)';
    const { refs: refs2 } = parseImageRefs(edited);
    assert.strictEqual(refs2.filter((r) => succeeded.has(r.key)).length, 1);
  });
});

suite('flow selfHosts（§2.2 自识别）', () => {
  test('serverUrl/customCdn 提取 hostname，无 scheme 补 https://，去重', () => {
    assert.deepStrictEqual(
      selfHosts('https://img.example.com', 'cdn.example.com/img'),
      ['img.example.com', 'cdn.example.com'],
    );
    assert.deepStrictEqual(
      selfHosts('https://img.example.com', 'https://img.example.com/x'),
      ['img.example.com'],
    );
    assert.deepStrictEqual(selfHosts('', ''), []);
  });
});

suite('flow planFileInsert 插入细则（FR-4）', () => {
  // splice 全文对比（T5 同法）+ 零删除红线内建断言
  const splice = (
    text: string,
    cursorLine: number,
    links: string[],
  ): string => {
    const plan = planFileInsert(text, cursorLine, links);
    const out =
      text.slice(0, plan.offset) + plan.insert + text.slice(plan.offset);
    assert.strictEqual(
      out.length,
      text.length + plan.insert.length,
      '零删除红线：结果 = 原文 + 纯新增',
    );
    return out;
  };

  test('光标行非空：下一行独立一行（中间行）', () => {
    assert.strictEqual(
      splice('line1\nline2\nline3', 1, ['![](a)', '![](b)']),
      'line1\nline2\n![](a)\n![](b)\nline3',
    );
  });

  test('光标行非空：文末行追加，不吞既有换行', () => {
    assert.strictEqual(
      splice('line1\nline2', 1, ['![](a)']),
      'line1\nline2\n![](a)',
    );
    assert.strictEqual(
      splice('line1\nline2\n', 1, ['![](a)']),
      'line1\nline2\n![](a)\n',
    );
  });

  test('光标行空行：就地 + 后续逐行，纯缩进保留', () => {
    assert.strictEqual(splice('a\n\nb', 1, ['L1', 'L2']), 'a\nL1\nL2\nb');
    assert.strictEqual(
      splice('a\n  \n  b', 1, ['L1', 'L2']),
      'a\n  L1\n  L2\n  b',
    );
  });

  test('空行 + 文末无尾换行：首链接行尾、其余补 EOL 开新行', () => {
    assert.strictEqual(splice('a\n  ', 1, ['L1', 'L2']), 'a\n  L1\n  L2');
  });

  test('前缀复制：列表/引用/组合链不破格', () => {
    assert.strictEqual(
      splice('- 项目\nx', 0, ['![](u)']),
      '- 项目\n- ![](u)\nx',
    );
    assert.strictEqual(
      splice('> 引用\nx', 0, ['![](u)']),
      '> 引用\n> ![](u)\nx',
    );
    assert.strictEqual(
      splice('> - 项目\nx', 0, ['![](u)']),
      '> - 项目\n> - ![](u)\nx',
    );
    assert.strictEqual(
      splice('  > - 项目\nx', 0, ['![](u)']),
      '  > - 项目\n  > - ![](u)\nx',
    );
  });

  test('前缀复制负例：纯文本行零前缀；标记行走下一行新列表项', () => {
    assert.strictEqual(splice('文本\nx', 0, ['![](u)']), '文本\n![](u)\nx');
    assert.strictEqual(splice('- \nx', 0, ['![](u)']), '- \n- ![](u)\nx');
  });

  test('多选顺序逐行排列；单链接一行', () => {
    assert.strictEqual(splice('a\nb', 0, ['1', '2', '3']), 'a\n1\n2\n3\nb');
    assert.strictEqual(splice('a\nb', 0, ['1']), 'a\n1\nb');
  });

  test('CRLF 文档保持 CRLF', () => {
    assert.strictEqual(splice('a\r\nb', 0, ['L1', 'L2']), 'a\r\nL1\r\nL2\r\nb');
    assert.strictEqual(splice('a\r\n  \r\nb', 1, ['L1']), 'a\r\n  L1\r\nb');
  });

  test('全失败：links 空 → 空 insert、全文不变', () => {
    assert.deepStrictEqual(planFileInsert('a\nb', 0, []), {
      offset: 0,
      insert: '',
    });
  });

  test('安全化组合：含空格 URL 包 <> 插入', () => {
    const link = `![](${markdownText('https://x/abc_图 1.png')})`;
    assert.strictEqual(link, '![](<https://x/abc_图 1.png>)');
    assert.strictEqual(splice('a\nb', 0, [link]), `a\n${link}\nb`);
  });
});
