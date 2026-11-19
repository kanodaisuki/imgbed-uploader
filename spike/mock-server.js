// T0 spike：mock 图床，模拟 POST /upload（验证后整体删除）
// 用法：node mock-server.js   （监听 127.0.0.1:9099）
//   正常：  POST /upload
//   延迟：  POST /upload?delay=5000
//   失败：  POST /upload?fail=1   （返回 400 UPLOAD_FORMAT_NOT_ALLOWED）
const http = require('http');

const PORT = 9099;

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  if (req.method === 'POST' && url.pathname === '/upload') {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const size = Buffer.concat(chunks).length;
      const delay = Number(url.searchParams.get('delay') || 0);
      setTimeout(() => {
        if (url.searchParams.has('fail')) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ code: 'UPLOAD_FORMAT_NOT_ALLOWED', error: 'spike: 模拟服务端格式限制' }));
        } else {
          const id = `spike-${Date.now()}`;
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ src: `/file/${id}.png`, publicUrl: `http://127.0.0.1:${PORT}/file/${id}.png`, receivedBytes: size }));
        }
      }, delay);
      console.log(`[mock] ${req.method} ${req.url} body=${size}B delay=${delay}ms`);
    });
    return;
  }
  res.writeHead(404);
  res.end();
});

server.listen(PORT, () => console.log(`[mock] imgbed listening on http://127.0.0.1:${PORT}`));
