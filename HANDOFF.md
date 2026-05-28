# memeloop-app 交接文档

## 仓库状态

| 仓库 | GitHub | 分支 | 状态 |
|------|--------|------|------|
| **memeloop-app** | https://github.com/linonetwo/memeloop-app | master | ✅ 已推送 6 commits |
| **memeloop** | https://github.com/linonetwo/memeloop | feature/memeloop-desktop-only | ✅ 已推送 5 commits |

## 目录结构

```
memeloop-app/
├── apps/
│   ├── desktop/    ← Electron 桌面端 (从 memeloop-desktop 迁移)
│   └── mobile/     ← Expo 移动端脚手架
├── pnpm-workspace.yaml
├── package.json
├── .gitignore
└── README.md
```

## 下一步任务

### 1. 移动端完善 (apps/mobile/)

- 连接 memeloop-node WS 服务
- 实现 mDNS 发现
- Agent chat 连接
- Terminal viewer
- Node 管理

### 2. E2E 测试

- `cd apps/desktop && pnpm run test:prepare-e2e`
- `cd apps/desktop && pnpm test:e2e`
- 之前的 `Process failed to launch` 问题已通过修复 `@ai-sdk/openai` 依赖解决

### 3. memeloop-core 预存问题

- `taskAgent.ts(615)`: permission_request 类型不匹配
- `nodeServer.ts(15)`: faye-websocket 类型缺失
- `noiseTransport.ts(7)`: sodium-universal 类型缺失
- 这些是 memeloop 核心库的预存问题，不在此次迁移范围内

## 关键文件

- `apps/desktop/tsconfig.json` - 路径别名指向 memeloop dist
- `apps/desktop/vite.main.config.ts` - Vite alias 配置
- `apps/desktop/vitest.config.ts` - 测试 alias 配置
- `apps/desktop/scripts/afterPack.ts` - Electron 打包脚本
- `apps/mobile/app/_layout.tsx` - Expo Router 根布局
