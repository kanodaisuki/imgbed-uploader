# D1：client.ts / download.ts 允许 import vscode（仅限 l10n 文案）

- 状态：已冻结（2026-11-27，随 T12 实施登记）
- 影响：`src/client.ts`、`src/download.ts`；T2 / T10 设计中「非 vscode 层」的约定
- 依据：[`../design/T12-多语言支持.md`](../design/T12-多语言支持.md) §5-S2 规约 5、§7

## 背景

T2 / T10 设计将 client.ts / download.ts 定为非 vscode 层（不 import vscode），控制依赖方向、便于纯 IO 侧测试（PLAN.md 的纯函数标记仅 parse/rewrite）。T12 需要两模块的用户可见错误消息过 `vscode.l10n.t`，与该约定冲突。

## 决策

约定下调为：**client.ts / download.ts 可 `import vscode`，但仅限 `vscode.l10n.t` 文案用途**。两模块不使用其它 vscode API，纯 IO 行为与依赖方向不变。`parse.ts` 纯函数约定不破——reason 走 code + 映射表（T12 §2 补充裁决）。

## 影响

- client.ts / download.ts 各增 `import * as vscode from 'vscode'`，消息产生处直接 `l10n.t`
- T2 / T10 设计文档中「不 import vscode」的表述以本决策为准（原文不再回改，按归类规则 4 以决策记录覆盖）
- 测试均运行在扩展宿主内，无兼容问题
