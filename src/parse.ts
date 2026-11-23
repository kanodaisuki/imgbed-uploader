// T4 设计：解析器。文档文本 → ImageRef[] + 可疑跳过条目。
// 纯函数、数字偏移，不 import vscode（PLAN §1 依赖方向）。
// 唯一红线：绝不产出错误区间——错误区间 = 误改文本（设计 §6）。

export type ImageRef = {
  kind: 'inline' | 'refdef' | 'html';
  urlStart: number;
  urlEnd: number;
  rawUrl: string;
  target:
    | { type: 'local'; path: string }
    | { type: 'remote'; url: string; host: string };
  key: string;
  useSpans?: { start: number; end: number }[]; // refdef 专用（设计 §2.4）
};

export type Skipped = { start: number; end: number; reason: string };

export type ParseResult = { refs: ImageRef[]; skipped: Skipped[] };

// 扩展名粗筛常量（4.1）：仅作用于 local（设计 §3）。清单单源导出（picker 过滤器复用，T7 §2.6）
export const IMAGE_EXTENSIONS = [
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'avif',
  'svg',
  'bmp',
  'ico',
] as const;
const IMAGE_EXTS = new RegExp(`\\.(${IMAGE_EXTENSIONS.join('|')})$`, 'i');

type Span = [number, number];

// ---------- 代码区（设计 §2.2） ----------

function eachLine(
  text: string,
  cb: (start: number, end: number, content: string) => void,
): void {
  let pos = 0;
  for (;;) {
    let nl = text.indexOf('\n', pos);
    if (nl === -1) {
      nl = text.length;
    }
    const raw = text.slice(pos, nl);
    cb(pos, nl, raw.endsWith('\r') ? raw.slice(0, -1) : raw);
    if (nl >= text.length) {
      return;
    }
    pos = nl + 1;
  }
}

// 围栏代码块 + 缩进代码块；计算次序：围栏 → 缩进（设计 §2.2）
function computeBlockCodeRanges(text: string): Span[] {
  const fences: Span[] = [];
  let open: { char: string; len: number; start: number } | undefined;
  eachLine(text, (start, end, content) => {
    const m = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(content);
    if (open === undefined) {
      const mark = m?.[1] ?? '';
      const info = m?.[2] ?? '';
      // 起始行 info string 含反引号则不是围栏
      if (mark !== '' && !(mark.charAt(0) === '`' && info.includes('`'))) {
        open = { char: mark.charAt(0), len: mark.length, start };
      }
    } else {
      const c = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(content);
      const mark = c?.[1] ?? '';
      if (
        mark !== '' &&
        mark.charAt(0) === open.char &&
        mark.length >= open.len
      ) {
        fences.push([open.start, end]);
        open = undefined;
      }
    }
  });
  if (open !== undefined) {
    fences.push([open.start, text.length]); // 未闭合围栏延伸到文档末尾
  }

  const inFence = (i: number) => fences.some(([s, e]) => i >= s && i < e);
  const indented: Span[] = [];
  let state: 'blank' | 'para' | 'code' = 'blank';
  eachLine(text, (start, end, content) => {
    if (inFence(start)) {
      state = 'blank';
      return;
    }
    if (content.trim() === '') {
      state = 'blank';
      return;
    }
    if (/^(?: {4,}|\t)/.test(content)) {
      if (state !== 'para') {
        indented.push([start, end]);
        state = 'code';
      }
      return;
    }
    state = 'para'; // 段落/列表行；缩进后续行按懒延续处理（设计 §2.2 近似）
  });
  return [...fences, ...indented].sort((a, b) => a[0] - b[0]);
}

// 行内代码：仅在围栏/缩进代码区之外的自由段内配对（设计 §2.2）
function computeInlineCodeRanges(text: string, blockRanges: Span[]): Span[] {
  const spans: Span[] = [];
  const scanSegment = (segStart: number, segEnd: number) => {
    let i = segStart;
    while (i < segEnd) {
      if (text[i] !== '`') {
        i += 1;
        continue;
      }
      let j = i;
      while (j < segEnd && text[j] === '`') {
        j += 1;
      }
      let found = -1;
      let k = j;
      while (k < segEnd) {
        if (text[k] !== '`') {
          k += 1;
          continue;
        }
        let m = k;
        while (m < segEnd && text[m] === '`') {
          m += 1;
        }
        if (m - k === j - i) {
          found = m;
          break;
        }
        k = m;
      }
      if (found === -1) {
        i = j;
      } else {
        spans.push([i, found]);
        i = found;
      }
    }
  };
  let pos = 0;
  for (const [s, e] of blockRanges) {
    if (s > pos) {
      scanSegment(pos, s);
    }
    pos = Math.max(pos, e);
  }
  scanSegment(pos, text.length);
  return spans;
}

// ---------- 小工具 ----------

function isEscaped(text: string, i: number): boolean {
  let n = 0;
  for (let k = i - 1; k >= 0 && text[k] === '\\'; k -= 1) {
    n += 1;
  }
  return n % 2 === 1;
}

function findUnescaped(
  text: string,
  from: number,
  to: number,
  ch: string,
): number {
  for (let i = from; i < to; i += 1) {
    if (text[i] === '\\') {
      i += 1;
    } else if (text[i] === ch) {
      return i;
    }
  }
  return -1;
}

// 平衡括号扫描（\x 转义不计深度），遇空行截断（段落边界，保守）
function scanBalanced(
  text: string,
  from: number,
  open: string,
  close: string,
): number {
  let depth = 1;
  for (let i = from; i < text.length; i += 1) {
    const c = text[i];
    if (c === '\\') {
      i += 1;
    } else if (c === '\n' && /^[ \t]*\r?\n/.test(text.slice(i + 1, i + 5))) {
      return -1;
    } else if (c === open) {
      depth += 1;
    } else if (c === close) {
      depth -= 1;
      if (depth === 0) {
        return i;
      }
    }
  }
  return -1;
}

// markdown 反转义（CommonMark 标点集，设计 §2.3 步 3）
function mdUnescape(s: string): string {
  return s.replace(/\\([!-/:-@[-`{-~])/g, '$1');
}

// HTML 实体解码最小集（设计 §2.3 步 3）
const HTML_NAMED: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};
function htmlUnescape(s: string): string {
  return s.replace(
    /&(amp|lt|gt|quot|apos|#x[0-9a-fA-F]+|#[0-9]+);/g,
    (all, body: string) => {
      const named = HTML_NAMED[body];
      if (named !== undefined) {
        return named;
      }
      const code =
        body[1] === 'x' || body[1] === 'X'
          ? parseInt(body.slice(2), 16)
          : parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : all;
    },
  );
}

// URL 分类（设计 §2.3 步 4）
function classify(url: string): 'local' | 'remote' | 'other' | 'protoRelative' {
  if (/^[A-Za-z]:[\\/]/.test(url)) {
    return 'local'; // Windows 盘符优先于 scheme 判定
  }
  const scheme = /^([A-Za-z][A-Za-z0-9+.-]*):/.exec(url);
  const protocol = scheme?.[1]?.toLowerCase();
  if (protocol !== undefined) {
    return protocol === 'http' || protocol === 'https' ? 'remote' : 'other';
  }
  if (url.startsWith('//')) {
    return 'protoRelative';
  }
  return 'local';
}

// 本地路径 key：文档内词法规范化（设计 §2.3 步 6）
function normalizeKey(p: string): string {
  const unified = p.replace(/\\/g, '/');
  const unc = unified.startsWith('//');
  const isAbs = unc || /^[A-Za-z]:\//.test(unified) || unified.startsWith('/');
  const out: string[] = [];
  for (const seg of unified.split('/')) {
    if (seg === '' || seg === '.') {
      continue;
    }
    if (seg === '..') {
      if (out.length > 0 && out[out.length - 1] !== '..') {
        out.pop();
        continue;
      }
      if (isAbs) {
        continue;
      }
    }
    out.push(seg);
  }
  const body = out.join('/');
  if (unc) {
    return `//${body}`;
  }
  return isAbs && !/^[A-Za-z]:/.test(body) ? `/${body}` : body;
}

function normalizeLabel(label: string): string {
  return label.trim().replace(/\s+/g, ' ').toLowerCase();
}

function isTitle(s: string): boolean {
  return (
    /^"[^"\n]*"$/.test(s) ||
    /^'[^'\n]*'$/.test(s) ||
    /^\((?:[^()\n]|\\.)*\)$/.test(s)
  );
}

// ---------- dest 子程序（设计 §2.3） ----------

type DestResult =
  | { kind: 'ok'; rawStart: number; rawEnd: number; inner: string }
  | { kind: 'empty'; start: number; end: number }
  | { kind: 'suspicious'; start: number; end: number; reason: string };

// markdown 候选的 dest 解析：title 剥离 → <> → 裸路径
function parseMdDest(text: string, from: number, to: number): DestResult {
  let s = from;
  let e = to;
  while (s < e && /[ \t\n]/.test(text.charAt(s))) {
    s += 1;
  }
  while (e > s && /[ \t\n]/.test(text.charAt(e - 1))) {
    e -= 1;
  }
  if (s >= e) {
    return { kind: 'empty', start: from, end: to };
  }
  if (text[s] === '<') {
    const gt = findUnescaped(text, s + 1, e, '>');
    if (gt === -1) {
      return {
        kind: 'suspicious',
        start: s,
        end: e,
        reason: '尖括号 URL 未闭合',
      };
    }
    const inner = text.slice(s + 1, gt);
    if (inner === '') {
      return { kind: 'empty', start: from, end: to };
    }
    const rest = text.slice(gt + 1, e).trim();
    if (rest !== '' && !isTitle(rest)) {
      return {
        kind: 'suspicious',
        start: s,
        end: e,
        reason: 'URL 后存在非法残留',
      };
    }
    return { kind: 'ok', rawStart: s, rawEnd: gt + 1, inner };
  }
  let p = s;
  while (p < e && !/[ \t\n]/.test(text.charAt(p))) {
    if (text[p] === '\\') {
      p += 1;
    }
    p += 1;
  }
  const rest = text.slice(p, e).trim();
  if (rest !== '' && !isTitle(rest)) {
    return {
      kind: 'suspicious',
      start: s,
      end: e,
      reason: 'URL 含未包裹空格或非法残留',
    };
  }
  return { kind: 'ok', rawStart: s, rawEnd: p, inner: text.slice(s, p) };
}

// ---------- 清洗 / 归类（设计 §2.3 步 3~6） ----------

type Target =
  | { type: 'local'; path: string; key: string }
  | { type: 'remote'; url: string; host: string; key: string }
  | { type: 'silent' }
  | { type: 'suspicious'; reason: string };

function resolveTarget(rawInner: string, html: boolean): Target {
  const cleaned = html ? htmlUnescape(rawInner) : mdUnescape(rawInner);
  const kind = classify(cleaned);
  if (kind === 'other') {
    return { type: 'silent' };
  }
  if (kind === 'protoRelative') {
    return { type: 'suspicious', reason: '协议相对 URL 暂不支持' };
  }
  if (kind === 'remote') {
    try {
      const u = new URL(cleaned);
      return { type: 'remote', url: cleaned, host: u.hostname, key: cleaned };
    } catch {
      return { type: 'suspicious', reason: 'URL 无法解析' };
    }
  }
  // local：截断 ?/# 后 decode 容错（设计 §2.3 步 5）
  let path = cleaned.replace(/[?#][\s\S]*$/, '');
  try {
    path = decodeURIComponent(path);
  } catch {
    // 解码失败保留原值继续（4.1）
  }
  if (path === '') {
    return { type: 'silent' };
  }
  if (!IMAGE_EXTS.test(path)) {
    return { type: 'silent' };
  }
  return { type: 'local', path, key: normalizeKey(path) };
}

// ---------- 主流程 ----------

export function parseImageRefs(text: string): ParseResult {
  const blockRanges = computeBlockCodeRanges(text);
  const codeRanges = [
    ...blockRanges,
    ...computeInlineCodeRanges(text, blockRanges),
  ].sort((a, b) => a[0] - b[0]);
  const inCode = (i: number) => codeRanges.some(([s, e]) => i >= s && i < e);

  const refs: ImageRef[] = [];
  const skipped: Skipped[] = [];

  // 1. 引用定义（设计 §2.4）：label → dest 结果；合法定义首个生效，
  //    首个可疑时允许被后续合法定义取代（CommonMark：解析失败的不是定义）
  const defs = new Map<
    string,
    { lineStart: number; lineEnd: number; dest: DestResult }
  >();
  eachLine(text, (lineStart, lineEnd, content) => {
    if (inCode(lineStart)) {
      return;
    }
    const m = /^ {0,3}\[/.exec(content);
    if (m === null) {
      return;
    }
    const labelOpen = lineStart + m[0].length - 1;
    const labelClose = scanBalanced(text, labelOpen + 1, '[', ']');
    if (labelClose === -1 || labelClose >= lineEnd) {
      return;
    }
    if (text[labelClose + 1] !== ':') {
      return;
    }
    const dest = parseMdDest(text, labelClose + 2, lineEnd);
    const key = normalizeLabel(text.slice(labelOpen + 1, labelClose));
    const prev = defs.get(key);
    if (
      prev === undefined ||
      (prev.dest.kind === 'suspicious' && dest.kind !== 'suspicious')
    ) {
      defs.set(key, { lineStart, lineEnd, dest });
    }
  });

  // 2. 候选扫描：图片使用 / 行内式 / <img>；跳过代码区与有效定义行
  const defLines: Span[] = [];
  for (const { lineStart, lineEnd, dest } of defs.values()) {
    if (dest.kind !== 'suspicious') {
      defLines.push([lineStart, lineEnd]);
    }
  }
  const inDefLine = (i: number) => defLines.some(([s, e]) => i >= s && i < e);

  const usages = new Map<string, { start: number; end: number }[]>();
  const markUsage = (label: string, start: number, end: number) => {
    const list = usages.get(label) ?? [];
    list.push({ start, end });
    usages.set(label, list);
  };

  function emitDest(
    kind: 'inline' | 'refdef',
    dest: DestResult,
    useSpans?: { start: number; end: number }[],
  ) {
    if (dest.kind === 'empty') {
      return;
    }
    if (dest.kind === 'suspicious') {
      skipped.push(dest);
      return;
    }
    const t = resolveTarget(dest.inner, false);
    if (t.type === 'silent') {
      return;
    }
    if (t.type === 'suspicious') {
      skipped.push({
        start: dest.rawStart,
        end: dest.rawEnd,
        reason: t.reason,
      });
      return;
    }
    refs.push({
      kind,
      urlStart: dest.rawStart,
      urlEnd: dest.rawEnd,
      rawUrl: text.slice(dest.rawStart, dest.rawEnd),
      target:
        t.type === 'local'
          ? { type: 'local', path: t.path }
          : { type: 'remote', url: t.url, host: t.host },
      key: t.key,
      ...(useSpans !== undefined ? { useSpans } : {}),
    });
  }

  // HTML <img>：解析属性找首个字面 src（设计 §2.5）
  function emitHtml(tagStart: number): number {
    let p = tagStart + 4;
    while (p < text.length) {
      while (p < text.length && /\s/.test(text.charAt(p))) {
        p += 1;
      }
      if (text[p] === '>' || p >= text.length) {
        return p + 1;
      }
      if (text[p] === '/') {
        p += 1;
        continue;
      }
      const nameStart = p;
      while (p < text.length && !/[\s=/>]/.test(text.charAt(p))) {
        p += 1;
      }
      const name = text.slice(nameStart, p).toLowerCase();
      while (p < text.length && /[ \t]/.test(text.charAt(p))) {
        p += 1;
      }
      if (text[p] !== '=') {
        if (name === 'src') {
          skipped.push({ start: nameStart, end: p, reason: 'src 属性无值' });
          return p;
        }
        continue;
      }
      p += 1;
      while (p < text.length && /[ \t]/.test(text.charAt(p))) {
        p += 1;
      }
      if (text[p] === '{') {
        // JSX 表达式：非字面路径，静默跳过（设计 §2.5）
        const close = text.indexOf('}', p);
        p = close === -1 ? text.length : close + 1;
        if (name === 'src') {
          return p;
        }
        continue;
      }
      let valueStart: number;
      let valueEnd: number;
      if (text[p] === '"' || text[p] === "'") {
        const quote = text.charAt(p);
        valueStart = p + 1;
        valueEnd = text.indexOf(quote, valueStart);
        if (valueEnd === -1) {
          valueEnd = text.length;
        }
        p = valueEnd + 1;
      } else {
        valueStart = p;
        while (p < text.length && !/[\s"'`=<>]/.test(text.charAt(p))) {
          p += 1;
        }
        valueEnd = p;
      }
      if (name !== 'src') {
        continue;
      }
      const value = text.slice(valueStart, valueEnd);
      if (value === '') {
        return p; // src="" 空路径静默跳过（设计 §2.3 步 7）
      }
      const t = resolveTarget(value, true);
      if (t.type === 'suspicious') {
        skipped.push({ start: valueStart, end: valueEnd, reason: t.reason });
      } else if (t.type === 'local') {
        refs.push({
          kind: 'html',
          urlStart: valueStart,
          urlEnd: valueEnd,
          rawUrl: value,
          target: { type: 'local', path: t.path },
          key: t.key,
        });
      } else if (t.type === 'remote') {
        refs.push({
          kind: 'html',
          urlStart: valueStart,
          urlEnd: valueEnd,
          rawUrl: value,
          target: { type: 'remote', url: t.url, host: t.host },
          key: t.key,
        });
      }
      return p;
    }
    return text.length;
  }

  let i = 0;
  while (i < text.length) {
    if (inCode(i)) {
      const r = codeRanges.find(([s, e]) => i >= s && i < e);
      i = r ? r[1] : i + 1;
      continue;
    }
    if (inDefLine(i)) {
      const r = defLines.find(([s, e]) => i >= s && i < e);
      i = r ? r[1] : i + 1;
      continue;
    }

    // 行内式 / 引用式使用
    if (text[i] === '!' && text[i + 1] === '[' && !isEscaped(text, i)) {
      const altClose = scanBalanced(text, i + 2, '[', ']');
      if (altClose === -1) {
        i += 2;
        continue;
      }
      // 嵌套图片：CommonMark 内层优先，外层按字面文本处理
      let nested = false;
      for (let k = i + 2; k + 1 < altClose; k += 1) {
        if (text[k] === '\\') {
          k += 1;
        } else if (
          text[k] === '!' &&
          text[k + 1] === '[' &&
          !isEscaped(text, k)
        ) {
          nested = true;
          break;
        }
      }
      if (nested) {
        i += 2;
        continue;
      }
      const alt = text.slice(i + 2, altClose);
      const after = altClose + 1;
      if (text[after] === '(') {
        const close = scanBalanced(text, after + 1, '(', ')');
        if (close === -1) {
          const lineEnd = text.indexOf('\n', after);
          skipped.push({
            start: i,
            end: lineEnd === -1 ? text.length : lineEnd,
            reason: '括号未闭合',
          });
          i = after + 1;
          continue;
        }
        const dest = parseMdDest(text, after + 1, close);
        emitDest('inline', dest);
        // 可疑时继续扫描 dest 内部（外层非链接，内层候选照常识别）
        i = dest.kind === 'suspicious' ? after + 1 : close + 1;
        continue;
      }
      if (text[after] === '[') {
        const labelClose = scanBalanced(text, after + 1, '[', ']');
        if (labelClose !== -1) {
          const raw = text.slice(after + 1, labelClose);
          markUsage(
            normalizeLabel(raw.trim() === '' ? alt : raw),
            i,
            labelClose + 1,
          );
          i = labelClose + 1;
          continue;
        }
      }
      // 快捷引用式 ![label]
      markUsage(normalizeLabel(alt), i, after);
      i = after;
      continue;
    }

    // HTML <img>
    if (
      text[i] === '<' &&
      !isEscaped(text, i) &&
      /^img/i.test(text.slice(i + 1, i + 4)) &&
      /[\s/>]/.test(text[i + 4] ?? '>')
    ) {
      i = emitHtml(i);
      continue;
    }
    i += 1;
  }

  // 3. 引用定义产出（设计 §2.4）：仅被 ≥1 个图片式引用使用
  for (const [label, def] of defs) {
    const used = usages.get(label);
    if (used === undefined || used.length === 0) {
      continue;
    }
    const sorted = [...used].sort((a, b) => a.start - b.start);
    if (def.dest.kind === 'suspicious') {
      skipped.push(def.dest); // 定义可疑但被图片引用：列入报告（设计 §2.4）
      continue;
    }
    emitDest('refdef', def.dest, sorted);
  }

  refs.sort((a, b) => a.urlStart - b.urlStart);
  skipped.sort((a, b) => a.start - b.start);
  return { refs, skipped };
}
