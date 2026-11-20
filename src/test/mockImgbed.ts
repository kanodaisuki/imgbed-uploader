// T11 设计 §2.1：进程内 mock 图床 + 远程图。一台服务三个 hostname 角色：
// localhost = 图床 API（serverUrl）、127.0.0.1 = 白名单远程图、[::1] = 待转存远程图
// （selfHosts 自识别 / remoteWhitelist 精确等值要求三者 hostname 互不相同）。
// TEST_PNG 内联：测试 out/ 树与扩展 dist/ 包不同源，不跨树 import client.ts（设计 §2.3）。
import * as http from 'http';
import type { AddressInfo } from 'node:net';

export const TEST_PNG: Uint8Array = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=',
  'base64',
);

// 行为队列元素：固定响应，或延迟后走默认 200（T7 壳层「上传中关文档」用）
export type Behavior = { status: number; body: string } | { delayMs: number };

export type LoggedRequest = {
  method: string;
  path: string;
  filename?: string;
  query: URLSearchParams;
  headers: http.IncomingHttpHeaders;
};

export type Mock = {
  port: number;
  urls: { server: string; white: string; transfer: string };
  requests: LoggedRequest[];
  uploadCount(): number;
  setBehavior(filename: string, queue: Behavior[]): void; // 键 = multipart filename
  setGetStatus(path: string, status: number): void; // 远程图 GET 200/403
  reset(): void; // 清 requests/计数/行为队列（beforeEach）
  stop(): Promise<void>;
};

const filenameOf = (body: Buffer): string | undefined =>
  /filename="([^"]*)"/.exec(body.toString('latin1'))?.[1];

export async function startMock(): Promise<Mock> {
  const requests: LoggedRequest[] = [];
  const behaviors = new Map<string, Behavior[]>();
  const getStatuses = new Map<string, number>();

  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      const url = new URL(req.url ?? '/', 'http://x');
      const filename = filenameOf(body);
      requests.push({
        method: req.method ?? '',
        path: url.pathname,
        filename,
        query: url.searchParams,
        headers: req.headers,
      });

      if (req.method === 'POST' && url.pathname === '/upload') {
        // src 由上传文件名派生：4.3 首级 customCdn + 文件ID 的期望值建立在这条上（设计 §2.1）
        const respond = (status: number, payload: string) => {
          res.writeHead(status, { 'Content-Type': 'application/json' });
          res.end(payload);
        };
        const ok = () =>
          respond(
            200,
            JSON.stringify({
              src: `/file/${filename ?? ''}`,
              publicUrl: `https://pub.example/file/${filename ?? ''}`,
            }),
          );
        const queue =
          filename === undefined ? undefined : behaviors.get(filename);
        const behavior = queue?.shift();
        if (behavior === undefined) {
          ok();
        } else if ('delayMs' in behavior) {
          setTimeout(ok, behavior.delayMs);
        } else {
          respond(behavior.status, behavior.body);
        }
        return;
      }

      // GET 远程图：默认 TEST_PNG 字节，setGetStatus 可改 403 等
      const status = getStatuses.get(url.pathname) ?? 200;
      if (status !== 200) {
        res.writeHead(status, { 'Content-Type': 'text/plain' });
        res.end('denied');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'image/png' });
      res.end(Buffer.from(TEST_PNG));
    });
  });

  await new Promise<void>((resolve) => {
    server.listen(0, () => resolve());
  });
  const port = (server.address() as AddressInfo).port;

  return {
    port,
    urls: {
      server: `http://localhost:${port}`,
      white: `http://127.0.0.1:${port}/white.png`,
      transfer: `http://[::1]:${port}/black.png`,
    },
    requests,
    uploadCount: () =>
      requests.filter((r) => r.method === 'POST' && r.path === '/upload')
        .length,
    setBehavior: (filename, queue) => {
      behaviors.set(filename, [...queue]);
    },
    setGetStatus: (p, status) => {
      getStatuses.set(p, status);
    },
    reset: () => {
      requests.length = 0;
      behaviors.clear();
      getStatuses.clear();
    },
    // undici keep-alive 空闲连接让裸 close() 等不到 callback，先断连接（设计 §2.1）
    stop: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    },
  };
}
