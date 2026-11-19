# ImgBed Uploader

自动上传 Markdown 文件中的本地图片到 CloudFlare ImgBed 图床的 VS Code 插件。

> 当前处于开发中，功能需求与验收标准见 [docs/requirements/Requirement.md](docs/requirements/Requirement.md)。

## 开发

```bash
pnpm install          # 安装依赖
pnpm run watch        # 监听编译（esbuild + tsc）
pnpm run compile      # 类型检查 + lint + 构建
pnpm run test         # 运行测试（首次需下载 VS Code 测试实例）
pnpm run format       # Prettier 格式化
pnpm run package      # 生产构建并打包 .vsix
```

## 文档

需求、设计与实施计划见 [docs/README.md](docs/README.md)。

## License

MIT
