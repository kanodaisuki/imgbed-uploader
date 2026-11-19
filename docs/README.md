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
| [T1-骨架装配.md](design/T1-骨架装配.md) | design/ | T1 方案设计：config/secrets/commands/菜单/首次引导 | 已冻结 |
