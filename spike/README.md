# T0 Spike 操作手册

验证 `docs/design/T0-粘贴可行性验证.md` 第 3 节的 V1–V9。**验证完成后本目录整体删除。**

## 准备（两条命令）

```powershell
# 1. 启动 mock 图床（保持运行）
node spike/mock-server.js

# 2. 启动 spike 扩展开发窗口（独立 VS Code 窗口，标题含 [Extension Development Host]）
code --extensionDevelopmentPath=<本仓库绝对路径>\spike
```

在弹出的开发窗口中打开任意 `.md` 文件（新建一个空的即可）。用命令面板（Ctrl+Shift+P）的 `Spike:` 命令切换模式和查看日志。

## 验证步骤

日志实时写入 `spike/spike-log.jsonl`，每做完一步**告诉我一声**，我读日志分析结果。

| 步骤 | 模式（Spike: 设置模式） | 操作 | 验证点 | 观察 / 记录 |
| --- | --- | --- | --- | --- |
| 1 | log | 扩展开了就算过 | **V1** | 日志 `activate` 里 `hasProviderApi:true`、无报错弹窗 |
| 2 | log | 截图（Win+Shift+S），在 md 里 Ctrl+V | **V2** | 我读日志看 `provide.start` 的 items：image 类 mime、字节数；再看 `doc.changed` 里默认粘贴插入了什么（本地链接？） |
| 3 | log | 资源管理器复制一个图片文件，md 里 Ctrl+V | **V2b** | 日志里 provider 是否被调用、items 的 mime 形态（`text/uri-list` / files） |
| 4 | upload | 截图，md 里 Ctrl+V | **V6/V9** | 是否直接插入 `![](http://127.0.0.1:9099/...)`；有无粘贴选择 widget 弹出（**V6b**）；光标是否在链接后；Ctrl+Z 是否一次撤销 |
| 5 | upload | 右键菜单"粘贴"、菜单栏"编辑→粘贴"各来一次 | **V6** | 与 Ctrl+V 行为一致 |
| 6 | upload | 连续快速粘贴 3 张截图 | **V6** | 3 条链接都出现？顺序是否稳定？ |
| 7 | delay | 截图粘贴，盯住界面 | **V3** | 粘贴等待 5s 期间：编辑器卡不卡？有没有任何等待提示（光标 spinner / 无反馈）？能否 Esc 取消？ |
| 8 | fail | 截图粘贴 | **V4** | 先弹"上传失败"提示，然后回落默认粘贴（本地链接插入、图片落盘）？二者顺序和时机 |
| 9 | throw | 截图粘贴 | **V4** | 抛错后默认粘贴是否照常、有无报错残留 |
| 10 | log | 剪贴板放纯文本，md 里选中一段文字后 Ctrl+V | **V8** | 选区被替换、provider 被调用后返回 undefined 不产生副作用 |
| 11 | log | 截图粘贴后 Ctrl+Z | **V9** | 一次撤销后文档完全复原 |
| 12 | upload | 同 4，但先 `Spike: 切换 yieldTo` 关掉再试一次 | **V6b** | widget / 默认 edit 归属是否变化 |
| 13 | log | 在 `.mdx`（需装 MDX 扩展）或 `.txt` 里重复步骤 2 | **V7/V4** | mdx 下 provider 是否被调用；**回落时图片是否直接消失（mdx 无内置降级）** |
| 14 | （最后）hang | 截图粘贴后立刻关窗口 | **V3 极端** | 粘贴挂起的形态；仅在前面全部做完后测试 |

## 注意

- `hang` 模式会让粘贴永远挂起，只能重开窗口，**放最后做**。
- 步骤 2/3 的 `log` 模式会回落默认粘贴（图片落盘到工作区），属预期，不是 bug。
- 每步的日志我都能从 `spike-log.jsonl` 读到完整数据（mime、字节数、耗时、返回行为），你只需描述界面观感（卡不卡、有没有 widget、提示的先后）。
