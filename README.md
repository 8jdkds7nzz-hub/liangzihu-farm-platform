# 智慧农业平台

当前三期：[交付核对](docs/releases/2026-10-03-三期软件交付核对.md)。3A、3B软件完成，3C主体与控制准备完成；真实设备执行适配器仍待G15，未标为全范围完成。二期和三期各段的详细设计、计划、逐项执行、测试及交付统一见[开发文档入口](docs/README.md)。

当前二期状态：[2A/2B/2C软件交付核对](docs/releases/2026-10-03-二期软件交付核对.md)。详细设计、计划、代码和工程验收已完成；真实测绘及终端容量仍待G11/G12。

当前一期软件状态：[1A/1B/1C补齐交付核对](docs/releases/2026-10-02-一期软件补齐交付核对.md)。软件代码与工程验证已完成，真实联调及生产验收仍待完成。

梁子湖智慧农业平台的独立开发工程。A00—A11、B01—B07、C01—C07已推进到本地可验证范围；真实厂家/天气接入、文字模型账户、企业微信/电话、真机和现场试运行及生产恢复仍待G01—G10与实际签认。当前是本地验证版，不能据此接管现场值守。

## 从这里开始

- [B07现场作业与影像总记录](docs/acceptance/1b/B07.md)
- [C07一期综合本地记录](docs/acceptance/1c/C07.md)
- [A11本地验收总记录](docs/acceptance/1a/A11.md)
- [设计、计划与逐项证据](docs/README.md)
- [真实联调交接清单](docs/contracts/真实联调交接清单.md)
- [值班人员操作卡](docs/help/值班人员操作卡.md)、[管理员操作卡](docs/help/管理员操作卡.md)、[技术员操作卡](docs/help/技术员操作卡.md)

本目录拥有独立Git仓库、pnpm锁文件和数据库，外层“智能体整体方案”保留设计资料与原报告网站。外层Git、TypeScript和ESLint排除本目录；不要将两套应用或数据库混用。

## 本机启动

需要Node.js 22.15以上、pnpm 10.33.0和Docker Desktop。首次准备：

```sh
pnpm install --frozen-lockfile
pnpm db:setup
pnpm db:migrate
pnpm identity:setup
pnpm registry:setup
pnpm ops:setup
pnpm dev
```

浏览器打开 **http://127.0.0.1:3100/login**。初始管理员凭据只保存在本机已忽略的`.local/初始管理员凭据.json`。当前本机按用户要求在`.env.local`设置`IDENTITY_MFA_REQUIRED=0`，只需账号密码即可登录；未设置或设为`1`时，按原策略要求验证器与恢复码。修改配置后重启服务生效。重复运行初始化不重置已有账号或密码。原二次验证流程见[A01记录](docs/acceptance/1a/A01.md)，当前调整见[账号密码登录简化](docs/specs/2026-10-02-账号密码登录简化.md)。

另开终端可运行两个本地后台进程：

```sh
pnpm worker:alarms
pnpm worker:notifications
```

通知进程只规划任务，真实发送关闭，不领取`notice.send`任务。厂家采集已有契约配置下的只读HTTP链和文件回放；合成回放只允许agri_test。仁科真实字段、账户和样本仍待G02核实，不能只填令牌就宣告已接入。

## 当前页面

| 入口 | 内容 |
|---|---|
| `/objects` | 对象、生产批次及对象详情 |
| `/devices`、`/points/<ID>` | 设备/测点、当前有效值、质量、三类时间、历史缺口与复测 |
| `/alerts` | 规则告警、认领、核查、处置、专业分类、交班和关闭 |
| `/rules` | 专业规则草稿、审核、启用和停用 |
| `/duty` | 值班顺序、夜班时段及加密联系人配置 |
| `/maintenance` | 维护、更正、人工复测、工单与受控JSON导出 |
| `/operations` | 管理员查看进程、任务、备份恢复及费用状态 |
| `/settings` | 对象/设备/测点/批次、人员账号与对象授权 |
| `/help`、`/feedback` | 操作说明、按对象权限提交问题及处理汇总 |

开发库只初始化场区入口，不填虚构物理设备、批次、阈值或联系人。浏览器验收截图中的合成对象仅存在于临时测试schema，测试结束即清理。

## 数据库与秘密

专属PostGIS容器在127.0.0.1:55432提供agri_dev与agri_test，分别使用独立角色；测试角色不能连接开发库。现有主机PostgreSQL及外层报告网站数据库不在脚本修改范围内。镜像固定摘要，Apple芯片使用Docker架构兼容运行。

`.env.local`、`.env.test.local`、`.env.health.local`及`.local/`均被Git忽略，私有文件权限0600。密码、TOTP密钥、健康令牌、联系人地址不提交；备份数据库时还须单独保管身份加密密钥。生产密钥托管和恢复仍待G06验收。

迁移追加到000—038（三期新增035—038，旧000—034不改写），记录校验值；已应用文件不得改写。008核对历史对象引用，不为缺失对象编造占位实物；009保留字段契约版本，010保留反馈与处理记录。普通事务无全局锁；只对迁移、相关记录或同一请求标识串行。网页默认最多5个连接，采集/告警/通知进程分别默认2个连接，单条查询默认10秒；生产资源及限额须另行实测。

## 验证

```sh
pnpm test:unit
pnpm test:db
pnpm typecheck
pnpm build
pnpm test:http
pnpm test:browser
pnpm test:compat
pnpm test:monitor
pnpm test:health
pnpm ops:restore-drill
pnpm audit --prod
```

数据库与浏览器测试只操作agri_test随机schema。浏览器测试使用Playwright 1.62.1，缺少浏览器时先执行`pnpm exec playwright install chromium`。HTTP和浏览器验收启动独立临时端口，不使用本机管理员账号或绑定其验证器。

`ops:restore-drill`实际备份、删除并恢复自己的随机schema，比对全部表和恢复后业务；不触碰agri_dev/public。私有备份与模拟密钥保存在`.local/恢复演练/`。本地小样本耗时不代表真实生产RPO/RTO，判定器保持`productionReady: false`。

`/api/v1/health/live`只证明网页能响应。受独立凭据保护的`/api/v1/health/ready`还检查核心进程及备份；当前外部依赖未齐时503是明确的未就绪状态。独立监测使用`.env.health.local`，真实对外告警默认关闭。

此工作区曾反复出现带编号的构建缓存副本，现关闭Turbopack文件系统持久缓存，并仅排除生成类型目录中的带空格副本；全部应用源码和规范生成类型仍接受检查。

## 范围与后续

已完成的本地功能和证据按A项登记。G01实物对应、G02真实采集、G03/G04真实通知、G05专业参数、G06生产恢复链，以及专家短信登录、人工账号恢复、外部工程师审阅和现场培训，均没有冒充验收完成。B/C通用模块、实际本地向量和图片推理已实现；专业参数、真实厂商/天气HTTP链、目标终端及模型/识别效果仍待联调。设备控制没有开放。

## 现场作业与智能助手

| 入口 | 当前内容 |
|---|---|
| /map | 二维对象边界和设备坐标；来源/版本，缺坐标不编造 |
| /field.html、/records | PIN加密本机草稿、农事原件/预览、可靠同步、CSV补录与更正 |
| /tasks | 审核日历、任务草稿与人工派单、巡查交班和人工灌排 |
| /imagery | 监控事件、原告警与后补图片、航次文件清单及缺失状态 |
| /analysis | 审核指标、覆盖率、历史版本、分来源天气与有效时段 |
| /knowledge、/assistant | 审核关键词/语义检索、出处、权限内问答和程序降级 |
| /briefings | 日/周/月报告、逐项审阅、辅助解释、任务草稿及受控角色分享 |
| /image-review | 独立YOLOS图片复核，未告警抽查与白天/夜间/雨雾分环节计数 |

本机首次运行向量和图片模型：

```sh
pnpm models:prepare
pnpm worker:media
pnpm worker:knowledge
pnpm worker:intelligence
pnpm worker:image-review
```

每个worker单独终端运行。实时告警和通知继续独立运行。默认私有原件与副本在忽略的本机目录；S3配置与私有凭据见.env.example，真实外发默认关闭。本地第二目录不代表异地恢复。模型准备后推理只使用本地文件，不把用户文字或图片发送到Hugging Face。

`pnpm test:field`、`test:intelligence`、`evaluate`、`ops:field-restore`补充B/C验证。完整导出支持受控JSON及逐文件再鉴权的tar.gz原件包。

## 只读天气接入

天气从人工导入扩展为新版和风日预报HTTP客户端，配置与执行结果位于“分析复盘→只读天气连接与同步”。先在配置管理登记qweather来源，再通过来源核实入口登记接口/只读许可资料及核实依据，最后配置已确认网格。首次默认停用，部署签名凭据和全局开关另行管理。

`pnpm worker:weather`负责按需任务；`pnpm test:weather`验证正式网页。公网请求仍关闭，模拟HTTP测试不等于真实账户联调。发布时间没有来源时保持空值，接收时间单列，不拿接收日期伪造发布时间。

当前实现与证据见[天气接入记录](docs/acceptance/1c/只读天气接入验收.md)。监控、司空的实际账户、接口版本和样本仍按联调清单推进。

## 监控与航次原件下载

“监控与航次→下载链接转入私有原件库”可把已取得只读授权、已解密的下载链接关联到已有事件或航次文件。链接加密保存，不向网页回传；media worker异步下载、校验、保存原件并安排备份。远程下载默认关闭，部署者须核实精确CDN域名后配置`.env.example`中的两个开关/域名项。

小原件入口保留20MiB限制；大文件另走分块及后台处理链，当前默认2GiB，上限按已核配置与实测执行。加密图片、厂家真实账户及现场容量仍待核实，不能因文件上传通过就宣告萤石或司空已验收。操作与证据见[原件接入验收](docs/acceptance/1b/监控与航次原件接入验收.md)。

## 三期业务入口与后台

| 入口 | 当前能力 |
|---|---|
| /inventory | 批次、仓位、采购/施用、库存分录、采收加工、包装与独立收发 |
| /traceability | 样品报告、凭证、独立放行、双向追查、问题处置、客户页 |
| /protection | 计划、专业处方、实际作业、标准JSON离线导入、交付与复查 |
| /agronomy | 私有照片特征、本地候选实验、反射率指数、农情通知、流量依据 |
| /control-records | 三态、规则、申请、五层反馈与人工接管；未实现真实下发 |

单独运行`pnpm worker:agronomy`处理照片/指数及已核只读抓图调度。`pnpm models:crop-prepare`准备固定SigLIP2本地权重；`CROP_MODEL_EVALUATION_ENABLED=0`为默认，未签验农业效果前不作为自动决策能力。实际影像留私有存储，权重和原件不进Git或public。

`pnpm ops:phase3-restore`只在agri_test随机schema做39张新表非空恢复，不能代替生产灾备。操作方法见三期3A/3B/3C操作卡及详细交接；开发库不初始化虚构库存、检测、轨迹或控制反馈。
