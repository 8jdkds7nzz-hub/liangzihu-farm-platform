# 智慧农业平台

梁子湖智慧农业平台的独立开发工程。当前完成A00基础工程，后续按1a计划推进账号权限、对象与设备台账、采集和告警。

## 从这里开始

- [设计与实施计划入口](docs/README.md)
- [A00验收记录](docs/acceptance/1a/A00.md)

本项目位于外层“智能体整体方案”的`智慧农业平台/`，拥有独立Git仓库、package.json、pnpm锁文件和数据库。外层保留本项目的设计资料和原有报告网站；本平台目录由外层Git、TypeScript与ESLint排除。

## 本地启动

需要Node.js 22.15以上、pnpm 10.33.0及已启动的Docker Desktop。首次安装：

```sh
pnpm install --frozen-lockfile
pnpm db:setup
pnpm db:migrate
pnpm dev
```

浏览器打开 **http://127.0.0.1:3100**。应用存活检查位于`/api/v1/health/live`；它只表示应用能响应，不表示设备、告警和数据库业务已经就绪。

`db:setup`启动本项目专属PostGIS容器，在端口55432创建`agri_dev`与`agri_test`，分别使用独立角色。现有主机PostgreSQL和报告网站数据库不在本脚本的修改范围内。凭据由脚本随机生成，保存在已忽略的`.local/`及`.env*.local`，权限为0600；脚本不打印密码，也不重置已有数据库。

当前PostGIS镜像已固定摘要及linux/amd64平台，Apple芯片下使用Docker的架构兼容运行。生产部署资源和性能仍需后续实测。

重复执行`pnpm db:setup`保留已有账号及数据。若环境文件被手动改写，脚本会停止提示，不直接覆盖。不要把`.local`与环境文件当作业务数据库备份，也不要提交到Git。

## 验证

```sh
pnpm test:unit
pnpm test:db
pnpm typecheck
pnpm build
pnpm db:status
```

单元测试不需要数据库。集成测试只读取`.env.test.local`中的`TEST_DATABASE_URL`，必须指向`agri_test`；每个测试只创建并清理自己的随机schema，不清空public或整个库。测试角色不能连接开发库。

## 目录职责

| 目录 | 当前内容 |
|---|---|
| `src/app/` | 初始页面与不含敏感信息的存活接口 |
| `src/platform/` | 公共类型、错误、时钟与连接配置 |
| `src/db/` | 连接池、事务和迁移器 |
| `db/migrations/` | A00平台基线迁移；身份与业务表在后续工作项增加 |
| `tests/` | 契约、配置、迁移、事务与数据库隔离测试 |
| `ops/compose.yaml` | 项目专属PostGIS服务及持久数据卷 |
| `tools/setup-local-db.mjs` | 本地数据库和凭据初始化 |
| `docs/baseline/` | 开发所依据的设计和计划快照及来源校验清单 |

迁移只追加新版本。已应用文件被修改、删除或重命名时迁移器拒绝执行；失败迁移在同一事务内回滚。只有迁移过程使用数据库范围的串行锁，普通业务事务没有全局锁。

## 阶段范围

A00交付应用骨架、公共契约、数据库迁移与测试。当前没有用户登录、厂家采集、真实通知或设备控制；这些功能分别按后续工作项及外部依赖实现。15分钟恢复点和2小时业务恢复仍是后续验收目标，本次基础测试不代表已达到这些生产目标。
