import { defineConfig } from '@vscode/test-cli';

// T12 §5-S4 L2：zh-cn 双 locale 矩阵。与 .vscode-test.mjs 同款 pin/launchArgs，
// 追加 --locale=zh-cn 与中文语言包，激活 package.nls.zh-cn.json / bundle.l10n.zh-cn.json。
export default defineConfig({
  files: 'out/test/**/*.test.js',
  version: '1.147.0',
  launchArgs: ['--disable-extension', 'github.copilot-chat', '--locale=zh-cn'],
  installExtensions: ['MS-CEINTL.vscode-language-pack-zh-hans'],
  mocha: { timeout: 60_000 },
});
