# 文档索引

本目录存放 ImgBed Uploader 插件的全部过程文档。按生命周期分类，命名用英文目录 + 中文文件名。

## 目录结构

| 目录 | 放什么 | 状态 |
| --- | --- | --- |
| [requirements/](requirements/) | 需求文档（做什么、验收标准） | `Requirement.md` 已冻结 |
| [design/](design/) | 方案设计（模块设计、接口设计、关键技术方案，如粘贴接管方案） | 待产出 |
| [plans/](plans/) | 实施计划（任务拆分、排期、里程碑） | `PLAN.md` 待评审 |
| decisions/（按需创建） | 技术决策记录（ADR，一条决策一份短文） | 按需 |

## 归类规则

1. **按生命周期归目录**：需求 → 设计 → 计划 →（实施中产生的）决策记录。代码级说明（如模块内注释、开发指南）放仓库根 `README.md` 或 `vsc-extension-quickstart.md`，不进本目录。
2. **一篇主题一份文档**：方案设计按任务拆分，以任务编号命名（如 `design/T4-解析器设计.md`、`design/T0-粘贴可行性验证.md`），不写大而全的总设计文档。每个任务的方案设计须评审通过后方可开工（见 [`plans/PLAN.md`](plans/PLAN.md) 执行流程）。
3. **文件命名**：中文描述性命名，可带序号控制阅读顺序（如 `01-总体设计.md`）。
4. **状态标注**：文档头部注明状态（草稿 / 评审中 / 已冻结 / 已废弃）和依赖关系；冻结文档不再直接修改，勘误级变更在文档内「变更记录」小节登记（位置、变更、依据），结构性变更走 `decisions/` 或新版本文档。
5. **交叉引用用相对路径**：如 [`requirements/Requirement.md`](requirements/Requirement.md)。

## 文档清单

| 文档 | 目录 | 说明 | 状态 |
| --- | --- | --- | --- |
| [Requirement.md](requirements/Requirement.md) | requirements/ | 插件需求文档：功能需求 FR-1~6、公共规则、设置、验收标准 | 已冻结 |
| [PLAN.md](plans/PLAN.md) | plans/ | 实施计划：模块划分、接口草案、任务 T0~T11、风险 | 已冻结 |
| [T0-粘贴可行性验证.md](design/T0-粘贴可行性验证.md) | design/ | T0 方案设计：粘贴技术路线验证计划与选型决策规则 | 已冻结（spike 完成，结论已填，选型：方案 A） |
| [T1-骨架装配.md](design/T1-骨架装配.md) | design/ | T1 方案设计：config/secrets/commands/菜单/首次引导 | 已冻结（T1 已实现，验收通过） |
| [T2-上传客户端.md](design/T2-上传客户端.md) | design/ | T2 方案设计：client.ts 上传客户端（fetch/参数映射/错误映射） | 已冻结（T2 已实现，验收通过） |
| [T3-测试连接.md](design/T3-测试连接.md) | design/ | T3 方案设计：testConnection（1x1 测试 PNG 端到端验证） | 已冻结（T3 已实现，验收通过） |
| [T4-解析器设计.md](design/T4-解析器设计.md) | design/ | T4 方案设计：parse.ts 解析器（4.1 语法矩阵/代码区跳过/可疑跳过报告） | 已冻结（T4 已实现，验收通过） |
| [T5-回写器设计.md](design/T5-回写器设计.md) | design/ | T5 方案设计：rewrite.ts 回写器（只换 URL/倒序输出/URL 上下文安全化） | 已冻结（T5 已实现，验收通过） |
| [T6-文档上传流程设计.md](design/T6-文档上传流程设计.md) | design/ | T6 方案设计：flow.ts 流程编排（去重/并发 3/进度取消互斥/部分失败报告/回写重定位） | 已冻结（T6 已实现，验收通过） |
| [T7-文件上传流程设计.md](design/T7-文件上传流程设计.md) | design/ | T7 方案设计：flow.ts 文件上传（两入口收束/FR-4 插入细则/串行上传/报告重试） | 已冻结（T7 已实现，验收通过） |
| [T8-CDN回写设计.md](design/T8-CDN回写设计.md) | design/ | T8 方案设计：FR-6 收尾（customCdn 无 scheme 归一/空文件ID 回落/验收 12 投影） | 已冻结（T8 已实现，验收通过） |
| [T9-粘贴上传.md](design/T9-粘贴上传.md) | design/ | T9 方案设计：paste.ts 粘贴接管（内存上传/失败降级落盘/超时取消/文件名生成） | 已冻结（T9 已实现，验收通过） |
| [T10-远程图像转存.md](design/T10-远程图像转存.md) | design/ | T10 方案设计：download.ts 远程转存（60s 总时限/50 MiB 流式上限/字节嗅探非图片校验/转存文件名） | 已冻结（T10 已实现，单测 17 项通过） |
| [T11-集成测试.md](design/T11-集成测试.md) | design/ | T11 方案设计：集成测试（mock 图床三 hostname/通知与 OutputChannel 打桩/11 条验收 + 兄弟委托 14 suite） | 已冻结（集成测试已实现，169 项全绿；待人工走查与 CHANGELOG） |
