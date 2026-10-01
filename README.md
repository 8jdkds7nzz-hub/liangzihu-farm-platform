# 智慧农业平台

梁子湖智慧农业平台的独立开发工程。当前完成A00基础工程及A01账号权限的本地程序与测试；企业微信真实接入待G03配置，下一步为A02对象与设备台账。

## 从这里开始

- [设计与实施计划入口](docs/README.md)
- [A00验收记录](docs/acceptance/1a/A00.md)
- [A01验收与首次登录](docs/acceptance/1a/A01.md)

本项目位于外层“智能体整体方案”的`智慧农业平台/`，拥有独立Git仓库、package.json、pnpm锁文件和数据库。外层保留本项目的设计资料和原有报告网站；本平台目录由外层Git、TypeScript与ESLint排除。

## 本地启动

需要Node.js 22.15以上、pnpm 10.33.0及已启动的Docker Desktop。首次安装：

```sh
pnpm install --frozen-lockfile
pnpm db:setup
pnpm db:migrate
pnpm identity:setup
pnpm dev
```

浏览器打开 **http://127.0.0.1:3100**。应用存活检查位于`/api/v1/health/live`；它只表示应用能响应，不表示设备、告警和数据库业务已经就绪。

登录入口为`/login`。初始管理员凭据仅保存在本机已忽略的`.local/初始管理员凭据.json`，首次登录须由使用者绑定验证器并保存恢复码。重复运行`identity:setup`不会重置已有账号；私有文件和`.env.local`中的加密密钥不得提交。具体步骤见A01验收记录。

`db:setup`启动本项目专属PostGIS容器，在端口55432创建`agri_dev`与`agri_test`，分别使用独立角色。现有主机PostgreSQL和报告网站数据库不在本脚本的修改范围内。凭据由脚本随机生成，保存在已忽略的`.local/`及`.env*.local`，权限为0600；脚本不打印密码，也不重置已有数据库。

当前PostGIS镜像已固定摘要及linux/amd64平台，Apple芯片下使用Docker的架构兼容运行。生产部署资源和性能仍需后续实测。

重复执行`pnpm db:setup`保留已有账号及数据。若环境文件被手动改写，脚本会停止提示，不直接覆盖。不要把`.local`与环境文件当作业务数据库备份，也不要提交到Git。

## 验证

```sh
pnpm test:unit
pnpm test:db
pnpm typecheck
pnpm build
pnpm test:http
pnpm db:status
```

单元测试不需要数据库。集成测试只读取`.env.test.local`中的`TEST_DATABASE_URL`，必须指向`agri_test`；每个测试只创建并清理自己的随机schema，不清空public或整个库。测试角色不能连接开发库。

`test:http`在已构建后启动独立随机端口的应用进程，同样只用随机测试schema；验证账号、MFA、权限撤回等真实HTTP流程后关闭进程并清理。不会绑定本地管理员的验证器。

## 目录职责

| 目录 | 当前内容 |
|---|---|
| `src/app/` | 首页、登录、我的账号及认证/授权/存活接口 |
| `src/modules/identity/` | 密码、会话、二次验证、对象权限、人员配置和企业微信接入边界 |
| `src/platform/` | 公共类型、错误、时钟与连接配置 |
| `src/db/` | 连接池、事务和迁移器 |
| `db/migrations/` | 000平台基线、001身份与授权；业务表按后续工作项增加 |
| `tests/` | 契约、配置、迁移、数据库隔离、身份权限及HTTP流程测试 |
| `ops/compose.yaml` | 项目专属PostGIS服务及持久数据卷 |
| `tools/setup-local-db.mjs` | 本地数据库和凭据初始化 |
| `tools/setup-identity.ts` | 本地管理员与身份加密密钥初始化，无公开注册入口 |
| `docs/baseline/` | 开发所依据的设计和计划快照及来源校验清单 |

迁移只追加新版本。已应用文件被修改、删除或重命名时迁移器拒绝执行；失败迁移在同一事务内回滚。只有迁移过程使用数据库范围的串行锁，普通业务事务没有全局锁。

## 阶段范围

A00交付应用骨架、公共契约、数据库迁移与测试。A01交付本地登录、二次验证及授权基础。企业微信真实登录、专家短信入口、厂家采集、真实通知和设备控制仍按外部依赖及后续验收推进。15分钟恢复点和2小时业务恢复仍是后续验收目标，本次测试不代表已达到这些生产目标。
