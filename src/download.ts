// T10 设计：远程图像转存下载。纯 IO 模块，不 import vscode。
// GET → 60s 总时限 → 50 MiB 流式上限 → 字节嗅探 → 转存文件名（设计 §2.2-§2.4）。

export type ImageExt =
  'png' | 'jpg' | 'gif' | 'webp' | 'avif' | 'bmp' | 'ico' | 'svg';

export type DownloadedImage = { name: string; data: Uint8Array };

const TIMEOUT_MS = 60_000;
const MAX_BYTES = 50 * 1024 * 1024;
const SNIFF_BYTES = 512;
const MAX_NAME_CODE_POINTS = 100;
const TOO_LARGE = '远程图像过大（超过 50 MB）';

class TooLargeError extends Error {}

const ascii = (data: Uint8Array, start: number, end: number): string =>
  String.fromCharCode(...data.subarray(start, end));

// SVG prolog 容忍（设计 §2.3）：XML 声明/注释/DOCTYPE 不参与判定；
// HTML 错误页即使带 prolog，只要 <html>/<!doctype html> 先于 <svg> 出现就排除。
function isSvg(data: Uint8Array): boolean {
  const text = new TextDecoder().decode(data.subarray(0, SNIFF_BYTES));
  const lower = text.toLowerCase();
  const svg = lower.indexOf('<svg');
  if (svg === -1) {
    return false;
  }
  const html = lower.search(/<html[\s>]|<!doctype\s+html/);
  return html === -1 || html > svg;
}

// 字节签名（设计 §2.3）：4.1 的九种扩展名，jpg/jpeg 合流为 jpg。
export function sniffImageExt(data: Uint8Array): ImageExt | undefined {
  if (
    data.length >= 8 &&
    data[0] === 0x89 &&
    data[1] === 0x50 &&
    data[2] === 0x4e &&
    data[3] === 0x47 &&
    data[4] === 0x0d &&
    data[5] === 0x0a &&
    data[6] === 0x1a &&
    data[7] === 0x0a
  ) {
    return 'png';
  }
  if (
    data.length >= 3 &&
    data[0] === 0xff &&
    data[1] === 0xd8 &&
    data[2] === 0xff
  ) {
    return 'jpg';
  }
  if (data.length >= 6) {
    const head = ascii(data, 0, 6);
    if (head === 'GIF87a' || head === 'GIF89a') {
      return 'gif';
    }
  }
  if (
    data.length >= 12 &&
    ascii(data, 0, 4) === 'RIFF' &&
    ascii(data, 8, 12) === 'WEBP'
  ) {
    return 'webp';
  }
  if (data.length >= 12 && ascii(data, 4, 8) === 'ftyp') {
    const brands = ascii(data, 0, Math.min(32, data.length));
    if (brands.includes('avif') || brands.includes('avis')) {
      return 'avif';
    }
  }
  if (data.length >= 2 && data[0] === 0x42 && data[1] === 0x4d) {
    return 'bmp';
  }
  if (
    data.length >= 4 &&
    data[0] === 0 &&
    data[1] === 0 &&
    data[2] === 1 &&
    data[3] === 0
  ) {
    return 'ico';
  }
  return isSvg(data) ? 'svg' : undefined;
}

// 转存文件名（设计 §2.4）：URL basename → 清洗 → 嗅探扩展名对齐。
// 不抛错：非法 URL/空 basename 回退 remote.<ext>。
export function transferFileName(url: string, ext: ImageExt): string {
  let segment = '';
  try {
    segment = new URL(url).pathname.split('/').pop() ?? '';
  } catch {
    // 非法 URL 按空 basename 兜底
  }
  try {
    segment = decodeURIComponent(segment);
  } catch {
    // 解码失败保留原值（4.1 同容错）
  }
  segment = segment
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .trim()
    .replace(/[. ]+$/, '');

  const dot = segment.lastIndexOf('.');
  const hasExt = dot !== -1;
  let base = hasExt ? segment.slice(0, dot) : segment;
  base = [...base]
    .slice(0, MAX_NAME_CODE_POINTS)
    .join('')
    .replace(/[. ]+$/, '');
  if (base === '') {
    base = 'remote';
  }

  const originalExt = hasExt ? segment.slice(dot + 1) : '';
  const lowerExt = originalExt.toLowerCase();
  const match = lowerExt === ext || (ext === 'jpg' && lowerExt === 'jpeg');
  return `${base}.${match ? originalExt : ext}`;
}

function mapNetworkError(err: unknown): Error {
  if (err instanceof Error && err.name === 'TimeoutError') {
    return new Error('下载超时（60 秒）');
  }
  const cause = err instanceof Error ? err.cause : undefined;
  const detail =
    cause instanceof Error
      ? cause.message
      : err instanceof Error
        ? err.message
        : String(err);
  return new Error(`下载失败：${detail}`);
}

function nonImageMessage(res: Response): string {
  const type = (res.headers.get('content-type') ?? '').trim().slice(0, 100);
  return `非图片内容（Content-Type: ${type === '' ? '（无）' : type}）`;
}

async function cancelBody(res: Response): Promise<void> {
  if (res.body === null) {
    return;
  }
  try {
    await res.body.cancel();
  } catch {
    // 已关闭/已消费，忽略
  }
}

async function readLimited(
  body: ReadableStream<Uint8Array>,
  maxBytes: number,
): Promise<Uint8Array> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new TooLargeError(TOO_LARGE);
    }
    chunks.push(value);
  }
  const data = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    data.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return data;
}

// GET 下载（设计 §2.2/§2.5）：60s 总时限、50 MiB 流式上限、非图片校验。
// 失败统一 throw Error(message)，message 直接进 T6 失败报告。
export async function downloadRemote(
  url: string,
  opts?: { timeoutMs?: number; maxBytes?: number },
): Promise<DownloadedImage> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('远程图像地址无效');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('远程图像地址无效');
  }

  const timeoutMs = opts?.timeoutMs ?? TIMEOUT_MS;
  const maxBytes = opts?.maxBytes ?? MAX_BYTES;

  let res: Response;
  try {
    res = await fetch(parsed, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'User-Agent': 'ImgBed-Uploader' },
      credentials: 'omit',
    });
  } catch (err) {
    throw mapNetworkError(err);
  }

  if (!res.ok) {
    await cancelBody(res);
    throw new Error(`下载失败：HTTP ${res.status}`);
  }

  // 有 Content-Encoding 时该头是压缩长度，不能用于早失败（设计 §2.2）
  if (res.headers.get('content-encoding') === null) {
    const declared = Number(res.headers.get('content-length') ?? '');
    if (Number.isFinite(declared) && declared > maxBytes) {
      await cancelBody(res);
      throw new Error(TOO_LARGE);
    }
  }

  if (res.body === null) {
    throw new Error(nonImageMessage(res));
  }

  let data: Uint8Array;
  try {
    data = await readLimited(res.body, maxBytes);
  } catch (err) {
    if (err instanceof TooLargeError) {
      throw new Error(TOO_LARGE);
    }
    throw mapNetworkError(err);
  }

  const ext = sniffImageExt(data);
  if (ext === undefined) {
    throw new Error(nonImageMessage(res));
  }
  return { name: transferFileName(url, ext), data };
}
