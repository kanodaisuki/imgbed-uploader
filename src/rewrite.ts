// T5 设计：回写器。ImageRef[] + urlByKey → Replacement[]（数字偏移，按 start 降序）。
// 纯函数、不 import vscode（PLAN §1 依赖方向）。
// 语义红线：只替换 URL 区间，URL 之外零触碰（设计 §2.1）；缺 key / 空 URL 跳过（§2.4）。

import type { ImageRef } from './parse';

export type Replacement = { start: number; end: number; text: string };

// 空白/定界敏感集合与 T4 扫描器终止类对齐（设计 §2.3）：取两侧并集判不安全。
const UNSAFE_MD = /[\s()\\<>\u0000-\u001f\u007f]/;
const UNSAFE_HTML = /[\s"'<>\u0000-\u001f\u007f]/g;
// <> 包装内需编码：<、>、\ 与控制符（定界与转义敏感）
const ENCODE_IN_WRAP = /[<>\u0000-\u001f\u007f\\]/g;

// 百分号编码单字符：ASCII 用 %XX，非 ASCII（如 NBSP）按 UTF-8 字节
function pct(ch: string): string {
  const code = ch.charCodeAt(0);
  if (code <= 0x7f) {
    return `%${code.toString(16).padStart(2, '0').toUpperCase()}`;
  }
  return encodeURIComponent(ch);
}

// markdown（inline/refdef）：含不安全字符整体包 <>，包装内编码；否则裸写（设计 §2.3）
function markdownText(url: string): string {
  if (!UNSAFE_MD.test(url)) {
    return url;
  }
  return `<${url.replace(ENCODE_IN_WRAP, pct)}>`;
}

// HTML：空白、控制符、"、'、<、> 编码（三种属性形态统一最严口径）；其余原样（设计 §2.3）
function htmlText(url: string): string {
  return url.replace(UNSAFE_HTML, pct);
}

export function buildReplacements(
  refs: ImageRef[],
  urlByKey: Map<string, string>,
): Replacement[] {
  const out: Replacement[] = [];
  for (const ref of refs) {
    const url = urlByKey.get(ref.key);
    if (url === undefined || url.trim() === '') {
      continue;
    }
    out.push({
      start: ref.urlStart,
      end: ref.urlEnd,
      text: ref.kind === 'html' ? htmlText(url) : markdownText(url),
    });
  }
  return out.sort((a, b) => b.start - a.start);
}
