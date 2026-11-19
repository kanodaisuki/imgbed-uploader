# ImgBed Uploader 插件需求文档

## 1. 背景与目标

### 1.1 背景

[CloudFlare ImgBed](https://github.com/MarSeventh/CloudFlare-ImgBed) 是一个支持 Docker 与 Serverless 部署的开源图床和文件托管方案，可将 Telegram、Discord、Cloudflare R2、S3 兼容存储、Hugging Face 和 WebDAV 等后端统一接入一个管理界面，并提供上传、读取、目录与标签管理、身份认证、内容审查、HTTP API、WebDAV 和公开浏览等能力。

- [项目文档主页](https://cfbed.sanyue.de/guide/introduction.html)
- [API 文档](https://cfbed.sanyue.de/api/)

写作 Markdown 时，本地图片需要逐张手动上传图床再回写链接，流程繁琐。已有插件 [MdImgUpload](https://github.com/sinoser/MdImgUpload) 实现了基本的图片上传，但功能不完善。

### 1.2 目标

开发 VS Code 插件 **ImgBed Uploader**：将 Markdown / MDX 文档中的本地图片上传到用户自部署的 CloudFlare ImgBed 图床，并将文档中的图片链接回写为远程地址。核心体验目标：**自然、高效、可依赖**——入口随手可及、批量操作有进度可撤销、失败可理解可重试、重复执行不产生副作用、任何路径都不丢用户的数据。

### 1.3 非目标（v1 不做）

- 管理类 API（删除 / 列表 / 随机图 / Token 管理）
- 图片本地压缩、转 WebP
- 分块上传、HuggingFace 大文件直传（Markdown 图片通常远小于渠道上限）
- Obsidian 式 `![[img.png]]` 语法
- 上传历史 / 回滚日志、整个工作区的批量上传

## 2. 术语与约定

| 术语 | 含义 |
| --- | --- |
| 图床 | 用户自部署的 CloudFlare ImgBed 实例，以 `serverUrl` 标识 |
| 本地图像 | 图像引用指向本地文件系统路径（相对或绝对） |
| 远程图像 | 图像引用指向 `http(s)://` URL |
| 回写 | 将文档中的图像 URL 替换为图床远程地址 |
| 设置前缀 | 所有设置项使用 `imgbedUploader.` 前缀 |

- 插件仅调用图床的 `POST /upload` 接口（[上传 API](https://cfbed.sanyue.de/api/upload.html)），内部固定使用 `responseFormat=object&returnFormat=full`（回写需要完整链接），这两个参数不做成设置。
- 插件内提示文案使用简体中文。

## 3. 功能需求

### FR-1 一键上传当前文档的本地图像

- 在 Markdown / MDX 编辑器中任一位置右键 →「上传文档全部本地图像」；编辑器标题栏提供一键上传按钮（最高频入口）。
- 解析文档中全部图像引用（见 4.1），将本地图像逐个上传并回写链接。
- 远程图像默认跳过；是否转存由 FR-5 控制。
- 行为遵循第 4 节全部公共规则。

### FR-2 上传选定的图像引用

- 在 Markdown 文本编辑器中选中一段图像语法（如 `![alt](./a.png)`）后右键 →「上传选定图片」。
- 上传选区内的全部图像引用（通常一张），成功后原位回写链接。
- 选区不包含合法图像引用时提示并退出，不修改文档。

### FR-3 剪贴板粘贴上传

- 在 Markdown / MDX 文档中粘贴图片（截图、复制的图片文件）时，自动上传图床并在光标处插入 Markdown 图像链接，格式 `![](url)`（alt 留空）。
- 上传使用剪贴板内存数据，不产生本地临时文件；截图无文件名时按 `paste-YYYYMMDD-HHmmss.png` 生成上传文件名。
- **上传失败时降级为 VS Code 默认行为（图片保存到工作区并插入本地链接），绝不静默丢图**，并提示失败原因。
- 由设置项 `imgbedUploader.pasteUpload` 控制开关；关闭时走 VS Code 默认行为（保存到工作区）。
- 插入后光标落在链接之后。
- 粘贴到非 Markdown / MDX 文档时走 VS Code 默认行为，不插入 Markdown 链接。

### FR-4 上传本地图片文件

两个并列入口，行为一致：上传所选文件，插入 `![](url)`：

1. **命令 + 文件选择框**：命令面板执行「上传本地图片」，弹出文件选择框（可多选）。
2. **资源管理器右键**：右键一个或多个图片文件 →「上传本地图片」。

- 插入位置：光标行的**下一行**独立一行；光标行为空行时就地插入；多选按文件选择顺序逐行排列。
- 无活动 Markdown / MDX 编辑器时（如直接在资源管理器右键），提示先打开目标文档，不新建文档。
- 多选时逐个上传，逐行插入，失败项跳过并列入报告。

### FR-5 远程图像转存

- 由设置项 `imgbedUploader.uploadRemoteImages`（默认 `false`）控制一键上传（FR-1）是否处理远程图像。
- 开启后：命中 `imgbedUploader.remoteWhitelist` 白名单的远程图像跳过不动；**不在**白名单的先下载、再上传图床、然后回写新链接。
- 下载失败（超时、403、非图片内容）计入失败报告，原链接保留。

### FR-6 自定义 CDN 链接

- 设置项 `imgbedUploader.customCdn` 配置后，回写 URL = `customCdn + 文件ID`。
- 留空时优先使用上传响应的 `publicUrl`（服务端「默认 URL 前缀」的结果），否则用 `serverUrl + src`。
- 对 FR-1/2/3/4/5 的所有回写统一生效。
- **仅作用于本次上传生成的链接**：文档中已有的远程链接（含旧 CDN 前缀）不改写（见 4.6），存量迁移命令列第 8 节。

## 4. 公共行为规则（适用于 FR-1 ~ FR-5）

### 4.1 图像引用解析规则

一键上传需识别以下**全部**写法，否则会漏图：

- 行内式 `![alt](path)` 与 `![alt](path "title")`，alt / title 原样保留，只替换 URL 部分
- 引用式 `![alt][ref]` 与 `![ref]`，配合文档中的 `[ref]: path` 定义，替换定义处的 URL
- HTML `<img src="...">`（MDX 中的常见写法）
- 尖括号路径 `<./a b.png>`（剥离 `<>`）、URL 编码路径（`%20` 等，`decodeURIComponent` 解码失败时保留原值继续，不抛异常）
- 路径后随标题的剥离（`![a](p.png "t")`），标题支持 `"..."`、`'...'`、`(...)` 三种包裹，剥离后再解析路径
- 跳过代码块 / 行内代码中的图像语法

图像扩展名粗筛使用内置常量 `png/jpg/jpeg/gif/webp/avif/svg/bmp/ico`（不做设置项）；格式是否允许上传由服务端裁决（见 4.9）。

### 4.2 上传请求约定

- 端点 `POST {serverUrl}/upload`，`multipart/form-data`，字段 `file`。
- Query 参数按第 5 节设置映射：`authCode`、`uploadChannel`、`channelName`、`uploadFolder`、`uploadNameType`、`expire`、`serverCompress`、`autoRetry`，固定附加 `responseFormat=object&returnFormat=full`。
- 鉴权方式由 `authType` 决定：`authCode`（query 参数）/ `apiToken`（`Authorization: Bearer`）/ `none`。
- 固定值：请求超时 60s、上传并发 3（不做成设置，出问题再暴露）。

### 4.3 回写链接优先级

`customCdn + 文件ID` → 响应 `publicUrl` → `serverUrl + src`。

### 4.4 部分失败语义

批量上传必然存在失败（网络抖动、服务端格式限制 400、远程图下载 403 等）：

- 成功的项立即回写，失败的项**保留原链接不动**，绝不整体回滚（已传成功的文件已在图床上）。
- 结束时汇总报告：成功 n 项、失败 m 项及逐项原因。
- 报告提供「重试失败项」操作。
- 呈现形态：通知栏显示摘要（成功 n / 失败 m）+「重试失败项」按钮；逐项明细输出到 Output Channel（ImgBed Uploader），不逐条弹通知刷屏。

### 4.5 进度与取消

- 多图上传显示 `withProgress` 进度（第 x/y 张），支持取消。
- 取消后已成功的保留回写，未开始的跳过。
- 上传进行中时重复触发上传命令：忽略并提示「上传进行中」，不并发两批任务。

### 4.6 幂等与去重

- 重复执行不重复上传已回写的远程链接；已是远程 URL 的图像跳过（除非命中 FR-5 转存规则）。
- 文档内同一路径的多处引用只上传**一次**，多处回写同一链接。

### 4.7 撤销与文档一致性

- 所有替换通过单次 `WorkspaceEdit` 提交，Ctrl+Z 一次撤销全部；多处替换按文档位置**倒序**应用（或整体一次提交），避免索引偏移。
- 解析基于编辑器当前 buffer（含未保存修改），不是磁盘文件。
- 只替换 URL 部分，alt、title、引用式定义、缩进与行内位置不动。

### 4.8 本地路径解析

- 相对路径基于**文档所在目录**解析，不是工作区根目录；绝对路径直接使用。
- untitled（未保存）文档没有所在目录，相对路径无法解析：该项列入失败报告并提示先保存文档。
- 文件不存在 / 不可读时跳过该项并列入失败报告。

### 4.9 错误处理

- 服务端上传格式限制、文件有效期可选项由服务端决定，插件只透传并处理错误：400（`UPLOAD_FORMAT_NOT_ALLOWED`、非法 `expire` 等）、401/403（认证失败）、超时。
- 本地**不维护**格式限制清单：格式白/黑名单由服务端「上传设置 → 上传格式限制」权威裁决，本地再维护一份会与管理员配置漂移。
- 服务端错误信息优先取响应体的 `error` / `message` 字段展示，取不到再退回 HTTP 状态码描述。
- 错误提示给出可行动作（如认证失败 → 引导重新输入凭据）。

### 4.10 首次使用引导

`serverUrl` 或凭据未配置时，执行任何上传命令直接弹出引导（打开设置 / 输入凭据），不要等上传请求发出后才报错。

## 5. 插件设置

设置项统一使用 `imgbedUploader.` 前缀（`package.json` → `contributes.configuration`）。除凭据外全部为 `scope: resource`（允许工作区覆盖用户配置）。

**凭据不进 settings.json**：认证码 / API Token 通过命令「ImgBed Uploader: 设置认证信息」输入，存入 VS Code `SecretStorage`，避免随仓库提交、随设置同步泄露。

### 5.1 连接与认证

| 设置项 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `imgbedUploader.serverUrl` | string | `""` | 图床站点基础地址，如 `https://img.example.com`，自动去除尾部 `/` |
| `imgbedUploader.authType` | enum：`authCode` / `apiToken` / `none` | `authCode` | 认证码 / API Token（需 `upload` 权限）/ 免认证（服务端未开启用户端认证） |

### 5.2 上传参数（映射 `/upload` Query 参数）

| 设置项 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `imgbedUploader.uploadChannel` | enum：`telegram` / `cfr2` / `s3` / `discord` / `huggingface` / `webdav` | `telegram` | 上传渠道 `uploadChannel` |
| `imgbedUploader.channelName` | string | `""` | 多渠道时指定 `channelName`，留空用服务端默认 |
| `imgbedUploader.uploadFolder` | string | `""` | 上传目录 `uploadFolder`（相对路径，如 `img/test`），留空为根目录 |
| `imgbedUploader.uploadNameType` | enum：`default` / `index` / `origin` / `short` | `default` | 命名方式：前缀_原名 / 仅前缀 / 仅原名 / 短链接 |
| `imgbedUploader.expire` | string | `""` | 文件有效期（如 `12h`、`7d`、`forever`）；仅服务端开启有效期且允许自选时生效，否则被忽略 |
| `imgbedUploader.serverCompress` | boolean | `true` | 服务端压缩（仅 Telegram 渠道图片） |
| `imgbedUploader.autoRetry` | boolean | `true` | 失败时自动切换渠道重试 |

### 5.3 链接与 CDN

| 设置项 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `imgbedUploader.customCdn` | string | `""` | 自定义 CDN / URL 前缀（见 FR-6 回写优先级） |

### 5.4 Markdown 处理

| 设置项 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `imgbedUploader.uploadRemoteImages` | boolean | `false` | 一键上传时是否转存远程图像（FR-5） |
| `imgbedUploader.remoteWhitelist` | array\<string\> | `[]` | 远程图像域名白名单（如 `img.shields.io`），命中则跳过不处理；按 URL 的 hostname 精确匹配 |

### 5.5 剪贴板

| 设置项 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `imgbedUploader.pasteUpload` | boolean | `true` | 粘贴图片时自动上传并插入链接（FR-3） |

### 5.6 已考虑并砍掉的设置

- 请求超时 / 并发数 / 分块大小：固定值（60s / 3），出问题再暴露。
- 本地上传格式限制清单：服务端权威裁决，本地只做扩展名粗筛常量（4.1）。
- 图片本地压缩、转 WebP：浏览器端能力，不做。
- 删除 / 列表 / 随机图 / Token 管理等管理 API 设置：与「上传」定位无关，不做。

## 6. 命令与入口

| 命令 | 入口 | 行为 |
| --- | --- | --- |
| `imgbed-uploader.uploadAll`（上传文档全部本地图像） | 编辑器右键菜单、编辑器标题栏按钮、命令面板 | FR-1 |
| `imgbed-uploader.uploadSelected`（上传选定图片） | 编辑器右键菜单（有选区时）、命令面板 | FR-2 |
| `imgbed-uploader.uploadFile`（上传本地图片） | 命令面板（弹文件选择框）、资源管理器右键图片文件 | FR-4 |
| `imgbed-uploader.setCredentials`（设置认证信息） | 命令面板 | 输入认证码 / Token，存入 SecretStorage |
| `imgbed-uploader.testConnection`（测试连接） | 命令面板 | 验证 `serverUrl` + 凭据连通性，配错早发现 |

- 粘贴上传（FR-3）为编辑器粘贴事件处理，不设命令。
- 菜单 `when` 子句：编辑器右键菜单与标题栏按钮仅在 `editorLangId == markdown || editorLangId == mdx` 时显示；「上传选定图片」仅在非空选区时显示。
- 「测试连接」实现约定：上传一张 1x1 测试 PNG 验证端到端（地址 + 凭据 + 渠道），成功时提示测试文件 URL，由用户自行忽略或删除（插件无删除权限）。

## 7. 验收标准

1. 含 3 张本地图、1 张白名单远程图、1 张非白名单远程图的文档，开启转存后一键上传：4 条链接回写（含 1 条转存），白名单图保持不动。
2. 批量上传中 1 张失败：其余成功回写、失败项原链接保留、汇总报告列出原因，「重试失败项」可再次上传。
3. 全部替换后按一次 Ctrl+Z 完整撤销。
4. 对同一文档连续执行两次一键上传，第二次全部跳过，图床不新增文件。
5. buffer 中未保存的新增图像引用可被识别并上传。
6. 凭据错误时「测试连接」给出明确失败原因；上传前若未配置则弹引导。
7. `pasteUpload` 开启时粘贴截图自动插入远程链接且光标在链接后；关闭时走 VS Code 默认行为。
8. 上传被服务端格式限制拒绝（400）时，错误信息原样呈现给用户。
9. 相对路径 `./img/a.png` 与 `img/a.png` 均按文档所在目录解析；`%20` 编码路径可正常上传。
10. 同一路径在文档中出现 3 次：只上传 1 次，3 处均回写同一链接。
11. 粘贴上传失败（如未配置凭据）时截图不丢失：按 VS Code 默认行为保存到工作区并插入本地链接。
12. 修改 `customCdn` 后对已回写的文档再次一键上传：全部跳过，已有链接不被改写。
13. untitled 文档执行一键上传：相对路径项进入失败报告并提示先保存。

## 8. 后续增强（暂不做）

- Obsidian 式 `![[img.png]]` 语法支持
- 按 glob 的排除规则
- 上传历史 / 回滚日志
- 整个工作区所有 Markdown 的批量上传
- 粘贴图片的文件名模板
- 分块上传与 HuggingFace 大文件直传
- 存量链接 CDN 迁移命令（把文档中指向本图床的旧链接批量改写为 `customCdn` 前缀）

## 9. 变更记录（冻结后勘误）

| 日期 | 位置 | 变更 | 依据 |
| --- | --- | --- | --- |
| 2026-11-19 | FR-4 | 资源管理器入口文案「上传到图床」→「上传本地图片」（VS Code 同一命令在所有菜单只有一个标题） | [`../design/T1-骨架装配.md`](../design/T1-骨架装配.md) §4 |
