# 部署说明 / Deployment

agentNews 与 **agentVoice** 共用一台 VPS(`47.79.84.15`),两者都通过 **Cloudflare** 代理(边缘终止 TLS),源站只跑明文 HTTP。

## 架构 / Topology

```
            Cloudflare edge (TLS, WAF, cache)
                       │  http→origin :80
                       ▼
   47.79.84.15:80  ──  edge-proxy (nginx, 容器)         ← 唯一对外端口
                       │  按 Host 路由 (docker edge 网络)
        ┌──────────────┴───────────────┐
        ▼                              ▼
  agentvoice.linkyun.co          agentnews.linkyun.co
   → agentvoice:8787              → agentnews:3000
   (容器, 仅 edge 网络)            (容器, 仅 edge 网络, 数据卷 /opt/agentNews/data)
```

- **Docker 网络** `edge`:三个容器(`edge-proxy`/`agentvoice`/`agentnews`)互通;只有 `edge-proxy` 发布了主机端口 `:80`。
- **nginx**(`deploy/nginx.conf` → `/opt/edge/nginx.conf`):按 `Host` 路由,使用 Docker 内嵌 DNS(`127.0.0.11`)运行时解析上游,后端重启/换 IP 无需 reload;为 agentVoice 开启 WebSocket 升级与长超时。
- **源站防火墙**(`deploy/edge-cf-firewall.*`):`edge-cf-firewall.service` 调 `cf-origin-firewall.sh`,在 Docker `DOCKER-USER` 链上把 `:80` 限制为 **仅 Cloudflare + 私网** 可达,阻止有人直连源站 IP 绕过 CF。与 agentVoice 自带的 `agentvoice-cf-firewall`(tag `agentvoice-cf`)用不同 tag(`edge-cf`),互不干扰。

> 前提:`agentnews.linkyun.co` 在 Cloudflare 为 **代理(橙云)** 状态,否则会被源站防火墙拦截。

## 数据 / Data

- 事实源 + 索引在主机 `/opt/agentNews/data`(挂载到容器 `/data`):`content/`(Markdown)+ `index.db`(SQLite)。
- 容器以 `node`(uid 1000)运行,故该目录属主为 `1000:1000`。
- 索引损坏可重建:`docker exec agentnews node dist/scripts/reindex.js`。

## 日常更新(只更新 app)/ Routine app update

```bash
./deploy/deploy.sh        # git pull → docker build → 重建 agentnews 容器 + 健康检查
```

不会动 agentvoice / nginx / 防火墙。

## 一次性基础设施(已完成,留档)/ One-time infra (already done)

```bash
# 1. docker 网络
docker network create edge

# 2. agentnews 容器(首启用 BOOTSTRAP 生成 admin key,之后去掉该 env 重建)
docker run -d --name agentnews --restart unless-stopped --network edge \
  -e AGENTNEWS_BASE_URL=https://agentnews.linkyun.co \
  -e AGENTNEWS_BOOTSTRAP_ADMIN="an_admin_xxx" \
  -v /opt/agentNews/data:/data agentnews:latest
docker logs agentnews | grep -i admin           # 记下 admin key
docker rm -f agentnews && docker run -d ... (不带 BOOTSTRAP) ...   # 安全起见去掉引导变量

# 3. agentvoice 改为仅 edge 网络(释放主机 :80)
docker rm -f agentvoice && docker run -d --name agentvoice --restart unless-stopped \
  --network edge -v /opt/agentVoice/.env:/app/.env:ro agentvoice:latest

# 4. nginx 边缘代理(唯一对外 :80)
install -D deploy/nginx.conf /opt/edge/nginx.conf
docker run -d --name edge-proxy --restart unless-stopped --network edge -p 80:80 \
  -v /opt/edge/nginx.conf:/etc/nginx/conf.d/default.conf:ro nginx:alpine

# 5. 源站防火墙(仅 CF 可达 :80)
install -D deploy/edge-cf-firewall.sh /opt/edge/cf-origin-firewall.sh
install -D deploy/edge-cf-firewall.service /etc/systemd/system/edge-cf-firewall.service
systemctl daemon-reload && systemctl enable --now edge-cf-firewall.service
```

## 运维便签 / Runbook

| 需求 | 命令 |
|------|------|
| 查看容器 | `docker ps` |
| agentnews 日志 | `docker logs -f agentnews` |
| 改 nginx 路由 | 编辑 `/opt/edge/nginx.conf` → `docker exec edge-proxy nginx -s reload` |
| 刷新 CF IP 段 | `systemctl restart edge-cf-firewall` |
| 重建索引 | `docker exec agentnews node dist/scripts/reindex.js` |
| 新增 editor key | `POST /api/v1/keys`(带 admin Bearer) |
| 轮换 admin key | 用现有 admin 签发新 admin key → 用新 key 吊销旧 key(`DELETE /api/v1/keys/{id}`) |

> ⚠️ 若重跑 agentVoice 的 `deploy.sh`:它只会刷新 `agentvoice-cf`(8787)规则,不影响 `edge-cf`(:80)。但它会把 agentvoice 重新以 `-p 80:8787` 启动,**抢占 :80** 与 nginx 冲突。届时需把 agentvoice 改回仅 `edge` 网络(见上 step 3)。建议给 agentVoice 也改用 edge 网络的部署方式。
