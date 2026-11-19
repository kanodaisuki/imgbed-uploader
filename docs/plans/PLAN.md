# ImgBed Uploader 实施计划（任务拆分）

依据 [`../requirements/Requirement.md`](../requirements/Requirement.md)（已冻结）。本文档拆分模块、接口与任务，评审通过后按任务清单实施。

**执行流程（强制）**：每项任务开工前先产出方案设计文档，放入 `docs/design/`，一任务一文、以任务编号命名（如 `design/T4-解析器设计.md`）；**方案评审通过后方可开工**。设计内容至少覆盖：方案取舍（含被否掉的备选）、接口/数据结构变更、对既有模块的影响、本任务的测试方式。任务完成以验收映射通过为准。

## 1. 模块划分

沿用脚手架结构（esbuild 打包，`src/extension.ts` 为入口），按"纯逻辑与 VS Code API 分离"的原则拆分——纯逻辑可脱离 VS Code 跑普通单测：

```
src/
  extension.ts          # activate/deactivate：装配与注册，不含业务逻辑
  commands.ts           # 命令注册表（对应 Requirement 第 6 节）
  config.ts             # 设置读取与规范化（serverUrl 去尾斜杠、trim 等）→ Config
  secrets.ts            # SecretStorage 封装（凭据存取）
  client.ts             # 上传客户端：upload()、testConnection()、错误映射（4.2/4.3/4.9）
  download.ts           # FR-5 远程图像下载（超时、非图片内容校验）
  parse.ts              # [纯函数] 文档文本 → ImageRef[]（4.1 全部语法）
  rewrite.ts            # [纯函数] ImageRef + 新URL → 替换区间列表（4.7）
  flow.ts               # 流程编排：解析→去重→上传(并发3)→回写→报告（FR-1/2/4/5，4.4-4.6/4.8）
  paste.ts              # FR-3 粘贴处理（技术路线见任务 T0）
  ui.ts                 # withProgress、互斥锁、汇总报告 + Output Channel、首次引导（4.4/4.5/4.10）
src/test/
  parse.test.ts         # 语法矩阵单测
  rewrite.test.ts       # 回写区间 / 倒序 / 只换 URL 单测
  flow.test.ts          # 去重、幂等、部分失败语义单测
  extension.test.ts     # 保留脚手架自带，后续替换为冒烟用例
```

依赖方向：`flow → parse/rewrite/client/download/config`，`parse/rewrite` 不 import `vscode`（用数字偏移而非 `Position`，转换放在 flow/ui 层）。

## 2. 核心接口（草案）

```ts
// parse.ts
type ImageRef = {
  kind: 'inline' | 'refdef' | 'html';   // 行内式 / 引用式定义 / <img>
  urlStart: number;                     // URL 部分在文档文本中的偏移（回写区间）
  urlEnd: number;
  rawUrl: string;                       // 原始 URL 文本（含 <>、编码，原样不动）
  target: { type: 'local'; path: string }  // path 已清洗：剥 <>、剥 title、decode
       | { type: 'remote'; host: string };
  key: string;                          // 去重键：local 用规范化绝对路径，remote 用完整 URL
};
function parseImageRefs(text: string): ImageRef[];

// rewrite.ts
type Replacement = { start: number; end: number; text: string };
function buildReplacements(refs: ImageRef[], urlByKey: Map<string, string>): Replacement[];
// 调用方倒序应用，或整体一次 WorkspaceEdit

// client.ts
type UploadResult = { url: string };    // URL 已按 4.3 优先级解析好
function upload(file: { name: string; data: Uint8Array }, cfg: Config): Promise<UploadResult>;
function testConnection(cfg: Config): Promise<{ ok: boolean; detail: string; url?: string }>;

// flow.ts
type ItemOutcome = { ref: ImageRef; ok: boolean; url?: string; error?: string };
function uploadDocument(...): Promise<ItemOutcome[]>;   // 供 FR-1/2/5 与「重试失败项」复用
```

粘贴（内存数据）与文件上传共用 `upload()`，`Uint8Array` 入参避免落临时文件。

## 3. 任务清单

估时为单人净工作量；依赖列指明前置任务。验收映射指 [`../requirements/Requirement.md`](../requirements/Requirement.md) 第 7 节条目。

| # | 任务 | 内容 | 依赖 | 验收映射 | 估时 |
| --- | --- | --- | --- | --- | --- |
| T0 | 粘贴可行性 spike | 验证 FR-3 技术路线：`DocumentPasteEditProvider`（已转正 stable，详见 `design/T0`）vs 重写 `editor.action.clipboardPasteAction`。产出结论写回本文档 | - | - | 0.5d |
| T1 | 骨架装配 | `config.ts`、`secrets.ts`、`commands.ts`、菜单 `when` 子句、首次引导（4.10） | - | 6 | 0.5d |
| T2 | 上传客户端 | `client.ts`：multipart 上传、Query 参数映射、鉴权、错误映射（4.2/4.3/4.9） | T1 | 8 | 1d |
| T3 | 测试连接 | `testConnection`：1x1 测试 PNG 端到端验证（第 6 节约定） | T2 | 6 | 0.5d |
| T4 | 解析器 | `parse.ts` + 语法矩阵单测（4.1 全部写法、代码块跳过、title 剥离、decode 容错） | - | 5、9 | 1d |
| T5 | 回写器 | `rewrite.ts` + 单测（只换 URL、倒序、alt/title/引用式不动） | T4 | 3 | 0.5d |
| T6 | 文档上传流程 | FR-1/2/5 编排：去重（4.6）、路径解析（4.8）、并发 3、进度/取消/互斥（4.5）、部分失败报告与重试（4.4） | T2 T4 T5 | 1、2、4、5、10、12、13 | 1.5d |
| T7 | 文件上传流程 | FR-4：文件选择框、资源管理器右键、插入位置细则 | T2 T5 | 1 | 0.5d |
| T8 | CDN 回写 | FR-6：`customCdn + 文件ID` 优先级接入（4.3 已含逻辑，本任务补验收场景） | T6 | 12 | 0.25d |
| T9 | 粘贴上传 | FR-3 按 T0 结论实现：内存上传、文件名生成、失败降级不丢图 | T0 T2 | 7、11 | 1d |
| T10 | 远程图像转存 | FR-5：下载（`download.ts`）、hostname 白名单、失败保留原链接 | T6 | 1 | 0.5d |
| T11 | 测试与验收走查 | 补集成测试（mock 图床 + vscode-test，覆盖 11 条验收）；人工过粘贴 2 条 + 真实图床走查；修缺陷、补 `CHANGELOG.md` | 全部 | 1–13 | 1.5d |

合计约 **8.5 人天**。建议里程碑：T3 结束 = v0.1（可手动上传验证链路）；T8 结束 = v0.2（核心可用）；T11 结束 = v1.0。

## 4. 测试策略

三层，端到端测试由 AI 通过 `@vscode/test-electron` 自动执行（启动真实 VS Code 实例），无需人工逐条验证：

- **单元测试**（`parse` / `rewrite` / `flow` 纯函数，普通 mocha）：语法矩阵、去重、幂等、部分失败、URL 优先级、白名单 hostname 匹配。
- **集成 / 端到端测试**（`@vscode/test-electron` + **本地 mock 图床**）：mock 图床为 Node HTTP 服务模拟 `POST /upload`，可编程返回成功 / 400(`UPLOAD_FORMAT_NOT_ALLOWED`) / 401 / 超时等响应。测试用例真实执行命令、编辑文档、断言回写文本与报告行为。覆盖验收标准 13 条中的 11 条（1–6、8–10、12、13），含撤销（执行 undo 后断言文本复原）。
- **手动验收**（仅 2 条 + 走查）：
  - 验收 7、11：粘贴行为（真实剪贴板 + Ctrl+V，自动化模拟不可靠）；
  - 真实图床走查：在真实 CloudFlare ImgBed 实例上执行 `testConnection` + 一次真上传（mock 测不出真实渠道行为）；
  - 主观体验：右键菜单位置、进度条观感、通知是否刷屏。

## 5. 风险

| 风险 | 影响 | 对策 |
| --- | --- | --- |
| 粘贴接管 API 不可用 / 有副作用 | FR-3 体验降级 | T0 先行；备选方案为命令式「粘贴并上传」快捷键 |
| Markdown 语法边界（嵌套括号、转义） | 漏图或误改 | 解析器保守策略：可疑处跳过并列入失败报告，绝不误改文本（4.1） |
| MDX 的 `editorLangId` 取决于用户装的 MDX 扩展 | 菜单不显示 | `when` 同时匹配 `markdown` 与 `mdx`，命令面板始终可用 |
| 服务端版本差异（`responseFormat` 等新参数） | 旧实例上传失败 | 只对最新版图床负责，不做数组格式回退（`design/T2` §6）；错误透传（4.9） |

## 变更记录（冻结后勘误）

| 日期 | 位置 | 变更 | 依据 |
| --- | --- | --- | --- |
| 2026-11-19 | §5 风险表 | 「服务端版本差异」对策改为"只对最新版图床负责，不做数组格式回退" | [`../design/T2-上传客户端.md`](../design/T2-上传客户端.md) §6 |
| 2026-11-19 | §2 client.ts 草案 | `testConnection` 返回值改可辨识联合 `TestResult`，失败侧增可选 `status?`/`code?`（原 `{ ok, detail, url? }`） | [`../design/T3-测试连接.md`](../design/T3-测试连接.md) §3 |
| 2026-11-19 | §2 parse.ts 草案 | `parseImageRefs` 返回值改 `ParseResult`（refs + skipped，落实风险表「可疑处跳过并列入失败报告」）；`key` 语义改「文档内词法规范化路径」（parse 无文档目录可依，去重为文档内行为）；remote target 补 `url` 字段；refdef 条目补 `useSpans`（FR-2 选区归属） | [`../design/T4-解析器设计.md`](../design/T4-解析器设计.md) §2.4/§2.6/§2.7 |
| 2026-11-19 | §2 parse.ts 草案 | `ImageRef` 增 refdef 专用可选字段 `useStart/useEnd`（首个图片式引用区间；URL 区间在定义行，FR-2 选区归属不能只看 `urlStart`） | [`../design/T4-解析器设计.md`](../design/T4-解析器设计.md) §2.4 |
