# T8 方案设计：CDN 回写

- 状态：已冻结（2026-11-19 评审通过并实现，单测 3 项全部通过）
- 对应任务：[`../plans/PLAN.md`](../plans/PLAN.md) T8（0.25d，任务清单最轻——4.3 逻辑 T2 已含，本任务补强与补场景）
- 前置：T2（`resolveUrl`/`extractFileId` 已落实 4.3）、T6（幂等跳过保证「已有链接不被改写」）。验收映射：验收 12
- 基线：[`../requirements/Requirement.md`](../requirements/Requirement.md) FR-6、4.3（回写链接优先级）、4.6（仅本次上传生成的链接）

## 1. 范围

FR-6 收尾：4.3 优先级链已落 `client.resolveUrl`（T2 §2.4），本任务**补两个信任边界加固**（§2.2）+ **补验收 12 测试投影**（§2.3）。**不做**：存量迁移命令（第 8 节「暂不做」）、`customCdn` 设置项声明（T1 已配）。

## 2. 方案与取舍

### 2.1 位置不动：URL 解析留在 client 出口一处

FR-6「对 FR-1/2/3/4/5 的所有回写统一生效」由**单点出口**保证——五个入口最终都过 `upload()` → `resolveUrl`（T9 粘贴、T7 文件插入的 `![](url)` 同源）。本任务零接口变更。

- ❌ 被否：flow/rewrite 层再做 CDN 拼接——两处规则漂移，统一生效就破了

### 2.2 两个加固（服务端响应与配置的信任边界，T2 遗留边角）

1. **`customCdn` 无 scheme → 补 `https://`**（在 `config.normalizeCdn` 归一，`resolveUrl` 零改动）：配置 `cdn.x/img` 现状会拼出 `cdn.x/img/a.png` 回写进 markdown = **相对链接，写坏文档**（全项目红线）。规则：
   - **按 `://` 判定有无 scheme**，不按 `scheme:`——`localhost:8080/img`、`cdn.x:8080/file` 会把 `localhost:` 误认成协议，恰恰漏掉最常见的自建 CDN 写法。判定表达式与 `flow.selfHosts` **同一字面量** `^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/`（现状为该正则、并非 `includes('://')`——两式对 `host:port` 结论一致但病态输入有行为差，实施时两处保持同一字面量并交叉注释，才是真的不漂，二次评审）。
   - 无 `://`：剥前导 `/`（`//cdn.x/img` 同）后补 `https://`；剥后为空 → 视为未启用。
   - 显式 `http://` 或其它带 `://` 的协议原样保留。
   - 归一**顺序**：`trim` → scheme 处理 → 剥尾 `/` → **剥尾后 `://` 之后无非空 host（含无内容）则 `''`** → 追加单个 `/`（二次评审钉判定）。
   - 例：`cdn.x/img` → `https://cdn.x/img/`；`//cdn.x/img` → `https://cdn.x/img/`；`localhost:8080/img` → `https://localhost:8080/img/`；`http://cdn.x/` 原样；`/`、`//`、`://`、`https://`、空白 → `''`（未启用）。
   - 与 T6 `selfHosts` 的容错口径对齐。FR-6 字面「customCdn + 文件ID」的 **scheme 语义 PLAN 勘误已登记**（变更记录 2026-11-19 行），实施时核对、不重复追加。
2. **文件 ID 为空 → 落回下一级优先级**：病态 `src`（pathname 剥完为空）时 `customCdn + ''` 会产出 CDN 根链接——空 fileId 跳过 customCdn 分支，走 `publicUrl` → `src`。
3. **`resolveUrl` 响应字段防御（原 §6 记债项，二次评审做掉）**：① 绝对 URL 判定改**大小写不敏感**（`/^https?:\/\//i`——大写 `HTTPS://…` 现状会被拼成 `serverUrl + HTTPS://…` 写坏文档）；② `publicUrl` **trim 后判空**、为空落回 `src`（与空 fileId 同口径，纯空白 `publicUrl` 不再产出坏链接）。两条同为服务端响应信任边界校验，各一行 + 各一条用例，一次收口不留债。

`flow.selfHosts` 的补 scheme 分支自此仅对直接调用可达（`Config.customCdn` 已恒带 scheme）：**保留不动**——T6 冻结测试仍覆盖它，删掉只会多一处改动。

- ❌ 被否：校验报错拒绝无 scheme 配置——4.9 式可行动作成本高，https 推断与 T6 自识别同口径、用户无感
- ❌ 被否：原样拼接（现状）——相对链接进文档就是「用正确数据写出坏文档」

### 2.3 验收 12 测试投影：机制已备，补场景

验收 12「修改 customCdn 后再次一键上传：全部跳过，已有链接不被改写」的机制 = T6 远程默认跳过 / 已回写自识别（改过 customCdn 后，新旧链接都是 remote → 默认跳过）。补 flow 单测投影：混合**旧 CDN 前缀**的已回写 remote refs → `items` 空、skipped 全、fake io **零调用**（零上传零改写）；再加一条对照——旧前缀 remote + 1 个本地引用 → `items` 仅含本地引用、旧 remote 全 skip（证明跳过不误伤新工作、也不漏传）。端到端验收 12 归 T11（已在集成清单）。

### 2.4 拼接 join 语义：已实现，补用例钉住

`normalizeCdn` 已保证 `customCdn` 恰好一个尾 `/`（T2 §2.4 拼接前置），`extractFileId` 已剥前导 `/`——`customCdn + 文件ID` 无粘连、无双斜杠、子路径（`uploadFolder`）形态正确。补回归用例锁住（防未来归一化改动破坏拼接）。

## 3. 接口

零接口变更：`resolveUrl` 签名与三级优先次序不动；`normalizeCdn` 为 `config.ts` 内部函数，输出形状不变（以 `/` 结尾的前缀）。

不变量（供后续维护）：**`Config.customCdn` 恒为 `''` 或 `scheme://…/`**——由 `config.normalize` 唯一出口保证，`resolveUrl` 不重复容错；直接构造 `Config`（测试/脚本）视为违反契约。

## 4. 对既有模块的影响

| 模块 | 变更 |
| --- | --- |
| `src/config.ts` | `normalizeCdn` 补 scheme 归一（按 `://`）与退化输入兜底（约 6 行） |
| `src/client.ts` | `resolveUrl`：空 fileId / 纯空白 `publicUrl` 落回下一级、绝对 URL 判定大小写不敏感（约 3 行） |
| `src/test/extension.test.ts` | 并入既有 `config.normalize` suite：无 scheme / `//` / `host:port` / 退化输入（`/`、`//`、`https://`、空白）/ 尾斜杠 join |
| `src/test/client.test.ts` | 补 `resolveUrl`：空 fileId 回落、子路径 fileId 拼接、大写 scheme `src` 原样返回、纯空白 `publicUrl` 回落 |
| `src/test/flow.test.ts` | 补验收 12 投影（旧 CDN remote 全跳过、本地引用照传、fake io 零调用） |
| `package.json` | `customCdn` description 补「可省略 `https://`」「仅 http 的 CDN 需显式写 `http://`」 |
| [`../plans/PLAN.md`](../plans/PLAN.md) | 勘误已登记（变更记录 2026-11-19 行），本任务核对、不重复追加 |

## 5. 测试方式

- **config 归一**（`extension.test.ts` 既有 `config.normalize` suite）：`cdn.x/img` → `https://cdn.x/img/`；`//cdn.x/img` → `https://cdn.x/img/`；`localhost:8080/img` → `https://localhost:8080/img/`（`host:port` 不误判为 scheme）；`http://cdn.x/img/` 原样（显式 http 保留）；`https://cdn.x/img//` → 恰好一个尾 `/`；`/`、`//`、`://`、`https://`、空白 → `''`（未启用，退化判定钉「剥尾后 `://` 之后无非空 host」）。
- **resolveUrl 回落**（`client.test.ts`）：空 fileId → `publicUrl` → `src`（不产出 CDN 根）；纯空白 `publicUrl` → 落回 `src`；大写 scheme `src`（`HTTPS://…`）原样返回不拼接；`customCdn + 子路径 fileId`（`videos/a.mp4`）拼接正确。
- **验收 12 投影**（flow）：文档 refs 全为已回写 remote（含旧 customCdn 形态 URL）→ `planUploads` items 空、skipped 全部「已回写链接，幂等跳过 / 远程图像跳过」、`runUploads` fake io 零调用；对照：旧前缀 remote + 1 个本地引用 → items 仅本地引用。
- **回归**：既有 **131 项**（本任务前基线）全绿 + 本任务新增项；`resolveUrl` 三级优先矩阵 T2 已有，不动。

## 6. 边界说明

- 存量旧 CDN 链接**永不改写**（FR-6 明文；remote 跳过保证），存量迁移命令列第 8 节。
- 旧 customCdn（配置改过）+ **转存开启**时会被当外部图搬运（T6 §6 既有边角，加 `remoteWhitelist` 规避）；验收 12 的「全部跳过」以默认配置（转存关）口径成立，转存开启口径以白名单为准。
- scheme 推断仅在完全无 `://` 时发生；用户显式 `http://`、自定义协议均原样保留。默认补 `https://`，**仅支持 http 的 CDN 必须显式写 `http://`**（`cdn.x:8080` 按 `https://cdn.x:8080/` 解释），设置项描述同步提示。
- `publicUrl` 异域前缀不经 customCdn 改写（4.3 次序使然），其转存自识别缺口同 T6 §6。

## 7. 变更记录

| 日期 | 位置 | 变更 | 依据 |
| --- | --- | --- | --- |
| 2026-11-19 | §2.2 / §5 | scheme 判定改为按 `://`（不按 `scheme:`），补 `host:port` 用例——`localhost:8080/img` 正是会继续写坏文档的形态 | 评审 P0 |
| 2026-11-19 | §2.2 / §5 | 归一顺序与退化输入明确：`/`、`//`、`https://`、空白 → 未启用 `''` | 评审 P1 |
| 2026-11-19 | §3 / §4 / §5 | `Config.customCdn` 不变量写入 §3；normalize 测试落 `extension.test.ts` 既有 suite；`flow.selfHosts` 补 scheme 分支保留 | 评审 P1 |
| 2026-11-19 | §2.3 / §4 / §5 / §6 | 补「旧 remote + 本地引用」对照投影；影响表补 `package.json`；PLAN 勘误改为核对；§6 记 `resolveUrl` 两处可选加固 | 评审 P1/P2 |
| 2026-11-19 | §2.2 / §4 / §5 / §6 | `resolveUrl` 两处加固从「记债」升为 §2.2 第 3 条做掉（绝对 URL 判定大小写不敏感、`publicUrl` trim 后判空落回 `src`） | 二次评审意见 |
| 2026-11-19 | §2.2 | selfHosts 机制表述改实际正则 `^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/`（原 `includes('://')` 与代码不符），两处同字面量交叉注释 | 二次评审意见 |
| 2026-11-19 | §2.2 / §5 | 退化判定钉为「剥尾后 `://` 之后无非空 host」，清单与用例补裸 `://` | 二次评审意见 |
