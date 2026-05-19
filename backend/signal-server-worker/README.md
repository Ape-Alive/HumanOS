# HumanOS Signal Server (Cloudflare Workers + Durable Objects)

每个**控制码**对应一个 Durable Object 实例（`env.ROOM.idFromName(code)`）。

## 本地开发

```bash
# 仓库根目录
npm run dev:signal:worker
```

默认：`http://127.0.0.1:8788`（避免与桌面内置信令 `8787` 冲突）

- 健康检查：`http://127.0.0.1:8788/health`
- 被控端 WebSocket：`ws://127.0.0.1:8788/room/842931/agent`
- 控制端 WebSocket：`ws://127.0.0.1:8788/room/842931/controller`

## 桌面端中继模式

信令根地址填：`ws://127.0.0.1:8788/ws`（或部署后的 `wss://你的域名/ws`）  
程序会自动拼成 `/room/{控制码}/agent|controller`。

## P2P 后关闭信令

WebRTC `connected` 后客户端发送 `signaling:complete` 并关闭 WebSocket；  
房间内无连接时 DO **休眠/回收**（Cloudflare 自动管理）。

## 部署

```bash
npm run deploy:signal:worker
wrangler login   # 首次
```

**Workers 免费套餐**已支持 Durable Objects（SQLite 版），`wrangler.toml` 使用 `new_sqlite_classes` 迁移。  
可选绑定自定义域名；不绑定时使用 `*.workers.dev` 的 `wss://` 地址即可。
