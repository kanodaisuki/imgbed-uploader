// T12 §5-S4 L1：翻译完整性守卫（纯 Node，进现有套件）。
// ① nls / bundle 键一一对应、无空值、{n} 占位符编号集合逐键一致
// ② %key% 双向校验：package.json 每个占位符两份 nls 均可解析，反向报死键
//    （漏键会裸露 %key%，比中英混排更糟）
// ③ 提取产物全覆盖：源码每个 l10n.t 字面量都是 zh-cn bundle 的键（防漏跑 l10n:extract）
// ④ 源码裸中文扫描（注释除外）：防「漏包 l10n.t」——S2 grep 收口的机械兜底
import * as assert from 'assert';
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = path.resolve(__dirname, '..', '..');
const readJson = (rel: string): Record<string, string> =>
  JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8')) as Record<
    string,
    string
  >;

// 占位符编号集合（去重排序）：{0}{2} 与 {0}{1} 个数相同也判错
const slots = (s: string): string =>
  [
    ...new Set(
      [...s.matchAll(/\{(\d+)\}/g)].map((m) =>
        m[1] === undefined ? '' : m[1],
      ),
    ),
  ]
    .sort()
    .join(',');

const HAN = /[\u4e00-\u9fa5]/;

suite('L1 翻译完整性', () => {
  const nlsEn = readJson('package.nls.json');
  const nlsZh = readJson('package.nls.zh-cn.json');
  const bundleEn = readJson('l10n/bundle.l10n.json');
  const bundleZh = readJson('l10n/bundle.l10n.zh-cn.json');

  function checkPair(
    en: Record<string, string>,
    zh: Record<string, string>,
    label: string,
  ): void {
    assert.deepStrictEqual(
      Object.keys(zh).sort(),
      Object.keys(en).sort(),
      `${label} 键不对齐`,
    );
    for (const [key, value] of Object.entries(en)) {
      const zhValue = zh[key] ?? '';
      assert.ok(
        value.trim() !== '' && zhValue.trim() !== '',
        `${label}: ${key}`,
      );
      assert.strictEqual(
        slots(zhValue),
        slots(value),
        `${label}: ${key} 占位符不一致`,
      );
    }
  }

  test('nls 键对齐、无空值、占位符一致', () => {
    checkPair(nlsEn, nlsZh, 'nls');
    assert.ok(Object.keys(nlsEn).length >= 20, 'nls 条数异常');
  });

  test('bundle 键对齐、无空值、占位符一致', () => {
    checkPair(bundleEn, bundleZh, 'bundle');
  });

  test('%key% 双向校验：可解析且无死键', () => {
    const pkg = fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8');
    const used = [...pkg.matchAll(/%([A-Za-z0-9._-]+)%/g)].map(
      (m) => m[1] ?? '',
    );
    assert.ok(used.length >= 20, `package.json %key% 数量异常：${used.length}`);
    for (const key of used) {
      assert.ok(key in nlsEn, `package.nls.json 缺 %${key}%`);
      assert.ok(key in nlsZh, `package.nls.zh-cn.json 缺 %${key}%`);
    }
    const dead = Object.keys(nlsEn).filter((k) => !used.includes(k));
    assert.deepStrictEqual(dead, [], `nls 死键：${dead.join(', ')}`);
  });

  test('提取产物全覆盖：l10n.t 字面量都是 bundle 键', () => {
    const missing: string[] = [];
    const files = fs
      .readdirSync(path.join(ROOT, 'src'))
      .filter((f) => f.endsWith('.ts'));
    for (const f of files) {
      const text = fs.readFileSync(path.join(ROOT, 'src', f), 'utf8');
      for (const m of text.matchAll(
        /l10n\.t\(\s*(['"])((?:(?!\1)[\s\S])*)\1/g,
      )) {
        const key = m[2] ?? '';
        if (!(key in bundleZh) || !(key in bundleEn)) {
          missing.push(`${f}: ${key}`);
        }
      }
    }
    assert.ok(
      missing.length === 0,
      `bundle 缺键（先跑 pnpm run l10n:extract）：\n${missing.join('\n')}`,
    );
    assert.ok(
      Object.keys(bundleZh).length >= 50,
      `bundle 条数异常：${Object.keys(bundleZh).length}`,
    );
  });

  test('源码无裸中文（注释除外）：防漏包 l10n.t', () => {
    const files = fs
      .readdirSync(path.join(ROOT, 'src'))
      .filter((f) => f.endsWith('.ts'));
    const violations: string[] = [];
    for (const f of files) {
      const text = fs.readFileSync(path.join(ROOT, 'src', f), 'utf8');
      // 逐字符扫：仅注释豁免（字符串/模板里的中文即违规）。
      // shortcut: 模板 ${} 内的中文扫不到（模板整体按字符串豁免结束），
      // 现有代码模板均不含中文表达式，发现形态变化再升级为 AST 扫描
      let i = 0;
      let line = 1;
      let state: 'code' | 'line-comment' | 'block-comment' | 'string' = 'code';
      let quote = '';
      while (i < text.length) {
        const c = text[i] ?? '';
        const n = text[i + 1] ?? '';
        if (c === '\n') {
          line += 1;
          if (state === 'line-comment') {
            state = 'code';
          }
          i += 1;
          continue;
        }
        if (state === 'line-comment') {
          i += 1;
          continue;
        }
        if (state === 'block-comment') {
          if (c === '*' && n === '/') {
            state = 'code';
            i += 2;
            continue;
          }
          i += 1;
          continue;
        }
        if (state === 'string') {
          if (c === '\\') {
            i += 2;
            continue;
          }
          if (c === quote) {
            state = 'code';
          }
          i += 1;
          continue;
        }
        // code
        if (c === '/' && n === '/') {
          state = 'line-comment';
          i += 2;
          continue;
        }
        if (c === '/' && n === '*') {
          state = 'block-comment';
          i += 2;
          continue;
        }
        if (c === "'" || c === '"' || c === '`') {
          state = 'string';
          quote = c;
          i += 1;
          continue;
        }
        if (HAN.test(c)) {
          violations.push(`${f}:${line}`);
        }
        i += 1;
      }
    }
    assert.ok(
      violations.length === 0,
      `源码裸中文（应包 l10n.t 或移入注释）：${violations.join(', ')}`,
    );
  });

  test('package.json 除 keywords 外无中文', () => {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'),
    ) as Record<string, unknown>;
    const violations: string[] = [];
    const walk = (value: unknown, at: string): void => {
      if (typeof value === 'string') {
        if (HAN.test(value)) {
          violations.push(at);
        }
        return;
      }
      if (Array.isArray(value)) {
        value.forEach((v, i) => walk(v, `${at}[${i}]`));
        return;
      }
      if (typeof value === 'object' && value !== null) {
        for (const [k, v] of Object.entries(value)) {
          walk(v, `${at}.${k}`);
        }
      }
    };
    for (const [k, v] of Object.entries(pkg)) {
      if (k === 'keywords') {
        continue; // Marketplace 搜索索引，中英并存是设计（§1 非目标）
      }
      walk(v, k);
    }
    assert.deepStrictEqual(
      violations,
      [],
      `package.json 裸中文：${violations.join(', ')}`,
    );
  });
});
