import { type Config } from './config';
import { getCredential } from './secrets';

// T2 设计：multipart 上传客户端。单发无状态，可安全并发调用。
// 超时固定 60s（需求 4.2），opts 仅测试注入用（T2 设计 §6）。

export class UploadError extends Error {
  status?: number;
  code?: string;

  constructor(message: string, opts?: { status?: number; code?: string }) {
    super(message);
    this.name = 'UploadError';
    this.status = opts?.status;
    this.code = opts?.code;
  }
}

export type UploadResult = { url: string };

const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
};

function mimeOf(name: string): string {
  const ext = (name.split('.').pop() ?? '').toLowerCase();
  return MIME_BY_EXT[ext] ?? 'application/octet-stream';
}

// 固定参数恒传，可选参数空则省略（T2 设计 §2.2）
export function buildQuery(
  cfg: Config,
  credential?: string,
): Record<string, string> {
  const query: Record<string, string> = {
    responseFormat: 'object',
    returnFormat: 'full',
    uploadChannel: cfg.uploadChannel,
    uploadNameType: cfg.uploadNameType,
    serverCompress: String(cfg.serverCompress),
    autoRetry: String(cfg.autoRetry),
  };
  if (cfg.channelName !== '') {
    query.channelName = cfg.channelName;
  }
  if (cfg.uploadFolder !== '') {
    query.uploadFolder = cfg.uploadFolder;
  }
  if (cfg.expire !== '') {
    query.expire = cfg.expire;
  }
  if (
    cfg.authType === 'authCode' &&
    credential !== undefined &&
    credential !== ''
  ) {
    query.authCode = credential;
  }
  return query;
}

// 文件 ID = src 的 pathname 剥 /file/ 前缀（T2 设计 §2.4，落实 T1 的无前导 / 约定）
// pathname 经 URL 规范化会百分号编码，解码回原文保真（解码失败保留原值）
export function extractFileId(src: string, serverUrl: string): string {
  let pathname = new URL(src, serverUrl).pathname;
  try {
    pathname = decodeURIComponent(pathname);
  } catch {
    // 解码失败保留原值
  }
  return pathname.replace(/^\/file\//, '').replace(/^\//, '');
}

// URL 优先级：customCdn + 文件ID → publicUrl → src / serverUrl + src（需求 4.3）
export function resolveUrl(
  res: { src: string; publicUrl?: string },
  cfg: Config,
): string {
  if (cfg.customCdn !== '') {
    return cfg.customCdn + extractFileId(res.src, cfg.serverUrl);
  }
  if (res.publicUrl !== undefined && res.publicUrl !== '') {
    return res.publicUrl;
  }
  if (/^https?:\/\//.test(res.src)) {
    return res.src;
  }
  return cfg.serverUrl + (res.src.startsWith('/') ? '' : '/') + res.src;
}

// 服务端错误原文透传（验收 8）；message 即给用户看的话（T2 设计 §2.5）
export function mapError(status: number, body: string): UploadError {
  let text: string | undefined;
  let code: string | undefined;
  try {
    const parsed = JSON.parse(body) as {
      error?: unknown;
      message?: unknown;
      code?: unknown;
    };
    if (typeof parsed.error === 'string') {
      text = parsed.error;
    } else if (typeof parsed.message === 'string') {
      text = parsed.message;
    }
    if (typeof parsed.code === 'string') {
      code = parsed.code;
    }
  } catch {
    // 非 JSON 响应体，走下方兜底
  }
  if (text === undefined) {
    text = `HTTP ${status}：${body.slice(0, 200)}`;
  }
  if (status === 401 || status === 403) {
    text += '（请检查认证信息）';
  }
  return new UploadError(text, { status, code });
}

export async function upload(
  file: { name: string; data: Uint8Array },
  cfg: Config,
  opts?: { timeoutMs?: number },
): Promise<UploadResult> {
  // URL 预校验拦截，不用 fetch 的 TypeError 判定（DNS 失败同样抛 TypeError）
  try {
    new URL(cfg.serverUrl);
  } catch {
    throw new UploadError('图床地址无效，请检查 serverUrl 配置');
  }

  const timeoutMs = opts?.timeoutMs ?? 60_000;
  const credential = await getCredential();
  const query = buildQuery(cfg, credential);

  const form = new FormData();
  // 文件名原样进 FormData，不转写不 trim（T2 设计 §3）
  form.append(
    'file',
    new Blob([file.data], { type: mimeOf(file.name) }),
    file.name,
  );

  const headers: Record<string, string> = {};
  if (
    cfg.authType === 'apiToken' &&
    credential !== undefined &&
    credential !== ''
  ) {
    headers.Authorization = `Bearer ${credential}`;
  }

  let res: Response;
  try {
    res = await fetch(
      `${cfg.serverUrl}/upload?${new URLSearchParams(query).toString()}`,
      {
        method: 'POST',
        body: form,
        headers,
        signal: AbortSignal.timeout(timeoutMs),
      },
    );
  } catch (err) {
    if (err instanceof Error && err.name === 'TimeoutError') {
      throw new UploadError(`上传超时（${Math.round(timeoutMs / 1000)} 秒）`);
    }
    const cause = err instanceof Error ? err.cause : undefined;
    const detail = cause instanceof Error ? cause.message : String(err);
    throw new UploadError(`上传失败：${detail}`);
  }

  const body = await res.text();
  if (!res.ok) {
    throw mapError(res.status, body);
  }

  let parsed: { src?: unknown; publicUrl?: unknown };
  try {
    parsed = JSON.parse(body) as { src?: unknown; publicUrl?: unknown };
  } catch {
    throw new UploadError('上传响应格式异常', { status: res.status });
  }
  if (typeof parsed.src !== 'string' || parsed.src === '') {
    throw new UploadError('上传响应格式异常', { status: res.status });
  }
  return {
    url: resolveUrl(
      {
        src: parsed.src,
        publicUrl:
          typeof parsed.publicUrl === 'string' ? parsed.publicUrl : undefined,
      },
      cfg,
    ),
  };
}
