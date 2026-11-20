import { defineConfig } from '@vscode/test-cli';

export default defineConfig({
  files: 'out/test/**/*.test.js',
  // T11 设计 §4：pin 版本防 stable 上游漂移；集成用例含真实命令 + 轮询等待。
  // 内置 Copilot/AgentHost 在测试实例里活动会抢占焦点/拖慢时序（T11 施工记录），定向禁用；
  // 核心 Chat UI 并入 workbench 核心摘不掉，另由 suiteSetup 的 chat.disableAIFeatures 隐藏。
  version: '1.147.0',
  launchArgs: ['--disable-extension', 'github.copilot-chat'],
  mocha: { timeout: 60_000 },
});
