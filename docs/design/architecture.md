# xstack 设计规划

> 状态：草案 v0.1（2026-10-17）
> 基线：fork 自 [xstack](https://github.com/ziyu/xstack)（下称 XSTACK）

## 1. 定位

|          | XSTACK                     | 商业SaaS 模板                              | xstack                                |
| -------- | -------------------------- | ------------------------------------------ | ------------------------------------- |
| 组合单位 | 技术栈（框架/ORM/DB/Auth） | 无，一整套                                 | 技术栈 + 功能模块 + 服务商 + 部署目标 |
| 产出     | 能跑的空项目               | 产品级完整项目                             | 产品级、只含所选功能的项目            |
| 锁死问题 | 无功能                     | 栈锁死、功能锁死（删功能靠手工）、发布锁死 | 三者都可选、可替换                    |

一句话：**把大模板拆成边界清晰的模块，用 XSTACK 的生成器把用户选中的模块组装成一个产品级项目，生成后的代码不依赖本工具，也不绑定任何服务商。**

### 1.1 目标

1. **功能可组合**：认证、支付订阅、积分、邮件/短信、存储、AI、后台、i18n/SEO/博客、分销，按需勾选，未选的功能不留任何残余代码、依赖、环境变量和数据表。
2. **服务商可替换（no vendor lock-in）**：每个功能对外是一个稳定接口，服务商是接口的一个实现。生成时可多选，生成后可通过配置切换，新增服务商只需实现接口。
3. **发布可选**：Vercel / Docker / Cloudflare Workers / 传统 Node 主机，生成对应配置、CI 和上线清单。
4. **生成即产品级**：类型检查、构建、迁移、种子数据、测试、文档、AGENTS.md 齐全，`install → env → dev` 三步跑起来。
5. **生成后可演进**：项目里记录所选配置，支持之后 `add` 新模块或新服务商。

### 1.2 非目标（MVP 阶段）

- 不支持 Next.js 以外的前端（Nuxt / TanStack Start 留到后续阶段，但模块协议从第一天就为多框架设计）。
- 不支持 Convex、独立后端（Hono/Express 等）与功能模块组合；功能模块只在"Next.js 全栈"模式下可用。
- 不支持 Prisma / Mongoose；功能模块的数据层只用 Drizzle。
- 不做"生成后自动升级模块代码"（生成的代码归用户所有，升级靠文档和 `diff`）。

## 2. 从 XSTACK 继承什么、改什么

XSTACK 现有结构：

```
apps/cli                     # CLI 交互、校验、安装、git
apps/web                     # 网页版 stack builder
packages/types               # zod schema、兼容规则
packages/template-generator  # 虚拟文件系统 + handlebars 模板 + 各类 processor
```

它的生成流程是一条**按类别写死的流水线**：`generator.ts` 依次调用 `processFrontendTemplates`、`processAuthTemplates`、`processPaymentsTemplates`……每个类别一个 handler，模板目录按 `类别/选项/目标框架` 组织，兼容规则写在 `compatibility.ts` 的常量和 if 里。这对十几个技术选项够用，但功能模块 × 服务商 × 框架 × 部署目标的组合数会让它失控。

| 保留                                               | 改造                                                    | 新增                           |
| -------------------------------------------------- | ------------------------------------------------------- | ------------------------------ |
| 虚拟文件系统（VFS）、浏览器可运行的生成器          | 写死的 handler 流水线 → **模块清单驱动**的通用流水线    | 功能模块（Feature Module）协议 |
| handlebars 模板、`templates.generated.ts` 打包方式 | 兼容规则常量 → **由模块清单声明、统一求解**             | 服务商（Provider）协议         |
| 依赖/脚本/catalog/README 后处理                    | `xstack.jsonc` → `cbt.jsonc`，记录模块与服务商          | 挂载点（Slot）聚合机制         |
| CLI 交互、包管理器、git、安装流程                  | 现有 `payments: polar`、`examples: ai` 等迁移为功能模块 | 预设（Preset）、`add` 命令     |
| 网页版 builder                                     | builder 增加"功能"与"服务商"两栏                        | 组合矩阵测试                   |

**原则（已由第 17 节取代）：~~XSTACK 现有技术栈选项保持可用，功能模块是新增的一层；选了功能模块时技术栈收敛到"产品模式"。~~ 现行原则：与上游分家，技术栈只描述基础设施，业务领域（auth、支付、示例）一律是模块，见第 17 节。**

## 3. 核心概念

```
Project
├── Stack       技术栈层（XSTACK 原有）：框架、DB、ORM、包管理器、工具链插件
├── Features    功能模块：auth、payment、credits、email、sms、storage、ai、admin、i18n、seo、blog、affiliate …
│   └── Providers   每个功能下的服务商实现：stripe、wechat-pay、resend、aliyun-sms、s3、oss …
├── Integrations   两个模块同时存在时才生成的连接代码：payment×credits、affiliate×payment …
└── Targets     部署目标：vercel、docker、cloudflare、node
```

- **功能模块（Feature）**：一个领域能力。有领域逻辑、数据表、页面/API、配置、i18n 文案、测试、文档。
- **服务商（Provider）**：功能接口的一个实现。只包含 SDK 调用和对应环境变量，**不包含业务逻辑**。
- **集成（Integration）**：模块间的可选协作。例：选了支付和积分，才生成"购买积分包"的履约逻辑。
- **挂载点（Slot）**：共享文件中的扩展位置，例如导航菜单、后台菜单、数据库 schema 索引、配置索引、权限表、i18n 词条。模块往挂载点**贡献条目**，由生成器聚合，而不是在共享文件里写一堆 `{{#if}}`。

## 4. 生成产物的结构（用户拿到什么）

这是整个设计的落脚点，模块化和去锁死都体现在产物上。以"全选"为例：

```
my-app/
├── apps/web/                         # Next.js App Router，只放薄适配层
│   ├── app/[lang]/(auth)/...         # ← auth 模块贡献
│   ├── app/[lang]/(root)/pricing/    # ← payment 模块贡献
│   ├── app/[lang]/admin/...          # ← admin 外壳 + 各模块贡献的后台页
│   ├── app/api/payment/webhook/[provider]/route.ts   # 单一动态路由，按 provider 分发
│   └── middleware.ts                 # 由 middleware 挂载点聚合生成
├── packages/
│   ├── config/                       # 单一配置入口，按模块拆文件，env 读取集中在这里
│   ├── db/                           # Drizzle client、驱动（pg/sqlite/d1）、schema 聚合
│   ├── events/                       # 进程内领域事件总线（见 §6.3）
│   ├── ui/                           # shadcn 组件、主题
│   ├── i18n/
│   ├── auth/
│   ├── payment/
│   │   ├── src/core/                 # 接口 + 订单/订阅领域逻辑（与服务商无关）
│   │   ├── src/providers/stripe.ts   # 只生成用户勾选的服务商
│   │   ├── src/providers/wechat.ts
│   │   ├── src/registry.ts           # 生成：已启用 provider 的注册表
│   │   └── src/schema/{pg,sqlite}.ts
│   ├── credits/ email/ sms/ storage/ ai/ affiliate/ blog/ seo/
├── env.example                       # 只含已选模块/服务商的变量，带注释和申请链接
├── deploy/                           # 只含所选部署目标
├── docs/                             # 只含所选模块的使用文档
├── AGENTS.md                         # 按所选模块生成的 AI 协作说明
└── cbt.jsonc                         # 生成配置，可复现、可 add
```

### 4.1 产物层面的去锁死约定

1. **功能包之间只通过公开接口和领域事件交互**，不直接 import 对方内部文件。删掉一个功能包 + 它在挂载点里的条目，项目仍能编译。
2. **服务商只在 `providers/` 下出现**。业务代码依赖 `PaymentProvider` / `StorageProvider` / `EmailProvider` 等接口，从 `registry` 取实例。
3. **服务商选择是运行时配置**：多个已生成的服务商通过 `config` 或环境变量切换，不需要改代码。
4. **数据库方言可切**：每个模块同时提供 pg 和 sqlite schema，`DB_DIALECT` 切换；D1 走 sqlite schema。
5. **部署无关**：业务代码不 import 任何平台 SDK（`@vercel/*`、`cloudflare:*`），平台差异收敛在 `packages/db/drivers`、`packages/storage/providers/r2-binding` 这类适配器里。
6. **生成的项目不依赖 xstack 任何运行时包**。

## 5. 模块清单协议（Module Manifest）

每个模块在本仓库里是一个目录，带一份 TypeScript 清单。生成器、CLI、网页 builder、兼容求解、文档都从清单读取信息。

### 5.1 模块源码目录

```
packages/modules/payment/
├── module.ts                 # 清单
├── templates/
│   ├── package/              # → packages/payment/（框架无关的领域逻辑）
│   ├── providers/
│   │   ├── stripe/           # → packages/payment/src/providers/stripe.ts 等
│   │   ├── wechat/
│   │   └── ...
│   ├── frameworks/
│   │   └── next/             # → apps/web/ 下的页面、API 路由、组件
│   ├── schema/{pg,sqlite}/
│   ├── i18n/{en,zh-CN}.ts    # 词条片段
│   ├── docs/
│   └── tests/{unit,e2e}/
└── integrations/
    └── credits/              # payment × credits 时才生成
```

`frameworks/next` 之后可以平行加 `frameworks/nuxt`、`frameworks/tanstack-start`，领域包和服务商代码不需要改。

### 5.2 清单示意

```ts
export default defineModule({
  id: "payment",
  name: { en: "Payments & Subscriptions", "zh-CN": "支付与订阅" },
  category: "monetization",

  requires: ["auth", "db"],              // 硬依赖，求解时自动加入
  enhances: ["credits", "affiliate"],    // 软依赖，同时存在时启用 integrations
  conflicts: [],

  supports: {
    frameworks: ["next"],
    dialects: ["pg", "sqlite", "d1"],
    targets: ["vercel", "docker", "node", "cloudflare"],
  },

  providers: {
    min: 1,
    multiple: true,
    options: {
      stripe:  { market: "global", env: ["STRIPE_SECRET_KEY", "STRIPE_PUBLIC_KEY", "STRIPE_WEBHOOK_SECRET"], deps: { stripe: "^18" } },
      creem:   { market: "global", ... },
      paypal:  { market: "global", ... },
      dodo:    { market: "global", ... },
      wechat:  { market: "cn", requires: { capabilities: ["public-webhook-url"] }, ... },
      alipay:  { market: "cn", ... },
    },
  },

  options: {
    pricingMode: { type: "enum", values: ["static", "dynamic"], default: "static" },
  },

  slots: {
    "nav.main":        [{ href: "/pricing", label: "nav.pricing" }],
    "nav.dashboard":   [{ href: "/dashboard/billing", label: "nav.billing" }],
    "admin.pages":     ["orders", "subscriptions", "pricing-plans"],
    "db.schema":       ["order", "subscription", "pricing-plan"],
    "permissions":     ["order:read", "subscription:manage"],
    "middleware":      [{ id: "subscription", order: 30 }],
    "events.emits":    ["order.paid", "subscription.changed", "order.refunded"],
  },

  env: [
    { key: "PRICING_MODE", default: "static", comment: "static | dynamic" },
  ],
});
```

### 5.3 挂载点（Slots）清单

| 挂载点                       | 聚合产物                                       | 贡献者示例                              |
| ---------------------------- | ---------------------------------------------- | --------------------------------------- |
| `config`                     | `packages/config/src/index.ts`                 | 每个模块                                |
| `db.schema`                  | `packages/db/src/schema/{pg,sqlite}/index.ts`  | auth、payment、credits、blog、affiliate |
| `nav.main` / `nav.dashboard` | `apps/web/config/navigation.ts`                | payment、ai、blog                       |
| `admin.pages`                | 后台侧边栏 + 路由                              | 各模块                                  |
| `dashboard.widgets`          | 用户仪表盘卡片                                 | credits、affiliate、payment             |
| `middleware`                 | `apps/web/middleware.ts`（按 order 串联）      | i18n、auth、payment                     |
| `permissions`                | `packages/auth/src/permissions.ts`（CASL）     | 各模块                                  |
| `i18n`                       | `packages/i18n/locales/*.ts`（按命名空间合并） | 各模块                                  |
| `events`                     | `packages/events/src/handlers.ts`              | integrations                            |
| `env`                        | `env.example`                                  | 各模块、各服务商                        |
| `seed`                       | `packages/db/src/seed.ts`                      | auth（管理员）、payment（套餐）         |
| `sitemap`                    | `app/sitemap.ts`                               | seo、blog                               |
| `docs` / `agents`            | `docs/`、`AGENTS.md`                           | 各模块                                  |

**规则：共享文件一律由挂载点生成，模块模板里禁止出现"判断别的模块是否存在"的 handlebars 条件。** 需要跨模块的代码放到 `integrations/`。这是避免模板变成条件迷宫的关键约束。

## 6. 组合机制

### 6.1 求解流程

```
用户输入（CLI 参数 / 交互 / 预设 / 网页 builder / cbt.jsonc）
  → 解析为 Selection { stack, features, providers, targets, options }
  → Resolver
      1. 加入 requires 的传递闭包（如选 affiliate 自动加入 payment、credits、auth、db）
      2. 收敛技术栈：有功能模块 ⇒ 产品模式约束
      3. 校验 supports（框架、方言、部署目标）、conflicts、provider.min
      4. 校验服务商能力约束（如 wechat 需要公网回调地址 → 提示 Cloudflare/Vercel 预览域名或内网穿透）
      5. 计算启用的 integrations（enhances 双方都在）
      6. 输出 ResolvedPlan + 人类可读的变更说明（"已自动加入 credits，因为 affiliate 依赖它"）
  → Generator（通用流水线）
      1. Stack 层：沿用 XSTACK handler 生成基础项目
      2. 按拓扑序渲染每个模块：package → providers(仅选中) → frameworks/<fw> → schema → tests → docs
      3. 渲染 integrations
      4. 聚合所有 slots → 生成共享文件
      5. 后处理：依赖合并、env.example、scripts、catalog、README、AGENTS.md、cbt.jsonc
  → VFS → 写盘 / 浏览器预览 / zip 下载
```

Resolver 是纯函数，CLI、网页 builder、测试共用一份实现，替代 XSTACK 里 CLI 与 web 各一份的兼容判断。

### 6.2 依赖图（MVP）

根据 原有模板项目中现有 import 关系整理，`→` 表示硬依赖，`⇢` 表示软依赖（触发集成）：

```
db
auth        → db, i18n           ⇢ email（邮箱验证/重置）, sms（手机号登录）
email       → i18n
sms
storage
i18n
seo         ⇢ blog
blog        → db, auth(admin)
credits     → db, auth
payment     → db, auth           ⇢ credits（积分包/订阅送积分）, affiliate
affiliate   → payment, credits, auth
ai          → auth               ⇢ credits（按次扣费/失败退款）, storage（图像/视频结果存储）
admin       → auth               （外壳；各模块经 admin.pages 挂入）
```

其中 `auth` 直接 import `sms`、`email`，`payment` 直接 import `credits`。拆分时要把这些硬连接改成"软依赖 + 集成"，否则用户无法只选认证不选短信。

### 6.3 领域事件：解开模块间的硬连接

生成的项目里有一个极简的进程内事件总线 `packages/events`（无外部依赖，类型安全）：

```ts
// 发出方：payment 的 webhook 处理
await events.emit("order.paid", { orderId, userId, plan });

// 集成：integrations/payment-credits 生成的处理器
events.on("order.paid", async ({ userId, plan }) => {
  if (plan.credits) await credits.grant(userId, plan.credits, "PURCHASE");
});
```

- 事件名、载荷类型由各模块清单的 `events.emits` 声明，类型自动生成。
- 同步执行、在同一个数据库事务上下文里（`withTransaction` 传入），保证履约一致性；需要异步时，用户可自行替换为队列，接口不变。
- 好处：删掉 credits，只是少了一个 handler，payment 代码一行不改。

### 6.4 服务商接口

每个功能定义最小接口，扩展能力用可选方法 + capability 声明，不搞"Stripe 专属字段"污染公共类型（ 原`PaymentPlan` 的 `stripePriceId`/`creemProductId` 等改为 `providerRefs: Record<ProviderId, string>`）。

```ts
interface PaymentProvider {
  id: string;
  capabilities: { subscription: boolean; refund: boolean; portal: boolean; qrcode: boolean };
  createPayment(p: PaymentParams): Promise<PaymentResult>;
  verifyWebhook(req: Request): Promise<WebhookEvent>; // 统一成领域事件
  refund?(orderId: string, amount?: number): Promise<RefundResult>;
  createPortalSession?(customerId: string, returnUrl: string): Promise<{ url: string }>;
  closeOrder?(orderId: string): Promise<boolean>;
}
```

UI 根据 `capabilities` 决定是否展示"管理订阅"、"扫码支付"等入口，而不是判断 provider 名字。

MVP 服务商

| 功能          | 海外                               | 国内                                  |
| ------------- | ---------------------------------- | ------------------------------------- |
| auth 登录方式 | 邮箱密码、Google、GitHub           | 手机号验证码、微信扫码                |
| payment       | Stripe、Creem、PayPal、Dodo        | 微信支付、支付宝                      |
| email         | Resend、SMTP                       | 阿里云邮件推送（后续）                |
| sms           | Twilio                             | 阿里云、腾讯云                        |
| storage       | S3、R2（S3 API / Workers binding） | 阿里云 OSS、腾讯云 COS                |
| ai            | OpenAI、Google、OpenAI 兼容端点    | DeepSeek、通义/豆包（经 OpenAI 兼容） |
| captcha       | Turnstile                          | 阿里云验证码（后续）                  |

## 7. 数据库

- 只用 Drizzle；方言 `pg`、`sqlite`（本地/Turso）、`d1`（Cloudflare）。
- 每个模块提供 pg 与 sqlite 两份 schema，字段语义一致；生成器聚合到 `schema/{pg,sqlite}/index.ts`。
- **不预生成迁移文件**（组合不同则迁移不同），生成后由 `db:generate` 产生；`postinstall` 提示或 CLI 可选自动执行。
- 每个模块可贡献 seed（管理员账号、默认套餐）。
- 模块间外键只允许指向 `auth` 的 `user` 表和自身模块的表；跨功能关联（如分销佣金关联订单）放在集成层的表里或用非外键 id 字段，保证删模块不破坏 schema。

## 8. 部署目标

| 目标       | 生成内容                                                     | 约束                                                                                            |
| ---------- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| Vercel     | `vercel.json`、环境变量清单、Cron（关闭超时订单）            | 不支持 sqlite 文件库，需 pg/Turso                                                               |
| Docker     | 多阶段 `Dockerfile`、`docker-compose.yml`（含 pg）、健康检查 | —                                                                                               |
| Cloudflare | OpenNext 配置、`wrangler.jsonc`、D1/R2 binding               | DB 用 d1；部分 Node SDK（如 `ali-oss`、`alipay-sdk`）不兼容 Workers，需在 Resolver 里声明并拦截 |
| Node 主机  | `ecosystem.config.js`（pm2）、Nginx 示例                     | —                                                                                               |

每个目标附带 GitHub Actions 工作流和"上线清单"文档（域名、回调地址、webhook 配置、各服务商后台需要填的 URL），解决"发布锁死"。服务商与部署目标的兼容性在清单的 `supports.targets` 声明，由 Resolver 统一拦截。

## 9. CLI 与配置

### 9.1 命令

```bash
# 交互式
npx xstack my-app

# 预设
npx xstack my-app --preset saas-global
npx xstack my-app --preset saas-cn

# 精确指定
npx xstack my-app \
  --features auth,payment,credits,ai,admin,i18n \
  --providers payment=stripe,wechat email=resend sms=aliyun storage=r2 ai=openai,deepseek \
  --db pg --deploy vercel

# 生成后追加
npx xstack add affiliate
npx xstack add payment.provider=alipay
```

交互流程：项目名 → 预设或自定义 → 功能多选 → 每个功能选服务商（按市场分组） → 数据库 → 部署目标 → 确认变更说明 → 生成。

### 9.2 预设

| 预设          | 内容                                                                                                                        |
| ------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `starter`     | auth(邮箱) + i18n + seo                                                                                                     |
| `saas-global` | auth(邮箱+Google+GitHub) + payment(Stripe) + credits + email(Resend) + storage(R2) + admin + i18n + seo + blog，部署 Vercel |
| `saas-cn`     | auth(手机号+微信) + payment(微信+支付宝) + credits + sms(阿里云) + storage(OSS) + admin + i18n(zh-CN 默认)，部署 Docker     |
| `ai-saas`     | `saas-global` + ai(OpenAI 兼容) + credits 扣费集成                                                                          |
| `full`        | 全部模块                                                                                                                    |

### 9.3 `cbt.jsonc`

在 XSTACK 的 `xstack.jsonc` 基础上增加 `features`、`providers`、`targets`、`moduleVersions`。`add` 命令读取它，跑同一个 Resolver，**只渲染增量模块并重新聚合挂载点文件**；用户改过的挂载点文件用三方合并（生成基线保存在 `.cbt/baseline/`），冲突时输出补丁让用户手工处理。

## 10. 本仓库结构（fork 后）

```
apps/
  cli/                          # XSTACK CLI + 功能/服务商交互 + add 命令
  web/                          # XSTACK builder + 功能/服务商面板 + 产物预览
packages/
  types/                        # XSTACK schema + Feature/Provider/Target schema
  template-generator/           # XSTACK 生成器 + 通用模块流水线 + slot 聚合
  module-sdk/                   # defineModule、slot 类型、resolver（纯函数）
  modules/
    db/ auth/ i18n/ email/ sms/ storage/ payment/ credits/
    ai/ admin/ seo/ blog/ affiliate/ captcha/
  presets/
tools/
  matrix/                       # 组合矩阵测试
  extract/
docs/
```

## 11. 从原模板项目抽取模块的方法

原模板项目已经做到"领域逻辑在 `libs/*`，app 路由是薄适配"，这是能拆的前提。每个模块的抽取步骤：

1. **领域包**：`libs/<x>` → `modules/<x>/templates/package`。
2. **去掉全局配置耦合**： 所有 lib 都 `import { config } from '@config'`，改为各模块自己的 `packages/config/src/<x>.ts`，经 config 挂载点聚合。
3. **切断跨模块 import**：`payment → credits`、`auth → sms/email`、`affiliate → credits` 改为领域事件 + 集成。
4. **服务商拆文件**：`providers/*.ts` 一一对应清单里的 provider；`switch` 工厂改为生成的 `registry.ts`。
5. **公共类型去服务商化**：如 `PaymentPlan.stripePriceId` 等 → `providerRefs`。
6. **Next 适配层**：`apps/next-app/app/**` 中该功能的页面和 API → `frameworks/next`；7 个 webhook 路由合并为 `api/payment/webhook/[provider]`。
7. **schema、i18n、测试、文档** 按模块切开。
8. 为模块写"单独生成能编译"的测试，再写与其他模块组合的测试。

## 12. 质量保障

组合数是这个项目的最大风险，测试策略分层：

1. **模块单测**：领域逻辑、服务商（mock SDK）——生成到产物里，也在本仓库跑。
2. **Resolver 单测**：依赖闭包、冲突、兼容拦截、集成激活，全部纯函数。
3. **快照测试**：每个预设的产物文件树与关键文件快照。
4. **组合矩阵**（CI）：
   - 每个模块"单独 + 最小依赖"生成，跑 `typecheck + build`；
   - 两两组合（pairwise）覆盖所有 integrations；
   - 所有预设 × 两种方言；
   - 每次 PR 跑抽样，nightly 跑全量。
5. **E2E**：每个预设用 Playwright 跑核心路径（注册登录、支付走 Stripe test mode / mock、积分扣减、上传、后台）。
6. **"删除测试"**：对全量产物逐个删除模块目录 + 重新聚合挂载点，验证仍可编译——直接检验去锁死约定。

## 13. 路线图

| 阶段                  | 内容                                                                                                                                                                   | 验收                             |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| **P0 基础**（2–3 周） | fork XSTACK、改名；`module-sdk`（清单、slot、resolver）；生成器接入模块流水线；`db`、`i18n`、`config`、`events`、`ui` 基础模块；`cbt.jsonc`                            | 空功能的产品模式项目可生成、构建 |
| **P1 核心**           | `auth`（邮箱+OAuth）、`email`（Resend/SMTP）、`admin` 外壳、`payment`（Stripe）、`credits` 及 payment×credits 集成；Vercel、Docker 目标；`starter`、`saas-global` 预设 | 预设 E2E 通过；删除测试通过      |
| **P2 国内**           | 手机号/微信登录、`sms`（阿里云/腾讯云/Twilio）、微信支付/支付宝、OSS/COS、`saas-cn` 预设；Node 主机目标                                                                | `saas-cn` E2E 通过               |
| **P3 扩展**           | `storage`（S3/R2）、`ai`（对话/图像/视频）+ ai×credits、`seo`、`blog`、`affiliate`、`captcha`；Cloudflare 目标（D1/R2）；`full` 预设                                   | `full` 预设功能                  |
| **P4 体验**           | `add` 命令与三方合并；网页 builder 功能面板与产物预览；生成 AGENTS.md / skills                                                                                         | 生成后追加模块可用               |
| **P5 多框架**         | 模块的 `frameworks/tanstack-start`、`frameworks/nuxt`；React 共享 UI 抽取                                                                                              | 同一组合可生成三种框架           |

## 14. 决策记录

1.  **代码许可证**：已购买许可证。搬运代码前仍需确认许可是否允许在本仓库（MIT 开源）中再分发；若不允许，只参考设计、自行重写。
2.  **与 XSTACK 上游的同步策略**：最小改动面 + 挑选性合并。改动集中在 `packages/template-generator/src/modules`、`templates/modules` 与少量挂钩点。
3.  **API 层**：MVP 功能模块只用 Route Handlers + Server Actions，不依赖 oRPC。
4.  **UI 组件来源**：shadcn 风格，组件落在 `packages/ui`，用户可继续 `shadcn add`。
5.  **后台权限模型**：沿用 CASL。
6.  **多租户/组织**、**`cbt diff`**：推迟到 P4 之后。

## 15. P0 实现现状（与上文设计的偏差）

已实现：产品模式可通过 CLI 生成空功能项目，`install + check-types + next build` 通过（sqlite / postgres，Vercel / Docker / none）。

| 设计                                                    | 实际实现                                                                                                                                     | 原因                                                               |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| 独立 `module-sdk`、`packages/modules`                   | 清单协议、resolver、流水线在 `packages/template-generator/src/modules/`；模块模板在 `packages/template-generator/templates/modules/<id>/`    | 复用 XSTACK 模板打包（`generate-templates`）与 VFS，减少上游冲突面 |
| `config` 挂载点 / app-config 包                         | 无独立配置包；站点配置在 `apps/web/src/config/site.ts`，模块服务在 `apps/web/src/services.ts`（组合根）组装                                  | 沿用 XSTACK 的工厂 + DI 约定，配置跟随服务注入                     |
| 产物可同时支持两种方言                                  | 每次生成只选一种方言（`dialects/<database>/`）                                                                                               | 与 XSTACK `database` 选项一致，避免双 schema 维护                  |
| i18n 为可选模块                                         | i18n 为产品模式的隐藏基础模块，路由固定为 `app/[lang]/`；`--module-options i18n.locales=zh-CN,en`（第一个为默认语言）                        | 各模块文案都按 locale 组织，可选会让每个模块分叉                   |
| `cbt.jsonc`                                             | 仍为 `xstack.jsonc`，新增 `product: { features, providers, options }`                                                                        | 复用 XSTACK 的 `add`/检测逻辑，P4 再考虑改名                       |
| `--providers payment=stripe,wechat`、`--db`、`--deploy` | `--features a,b`、`--providers payment:stripe`、`--module-options module.key=value`；数据库与部署仍用 XSTACK 的 `--database`、`--web-deploy` | 与 XSTACK 参数体系保持一致                                         |
| 预设 `starter` = auth + i18n + seo                      | `starter` = auth（+ 基础模块）；seo 随 P3 加入                                                                                               | seo 模块尚未实现                                                   |

产品模式固定的技术栈：`frontend next`、`backend self`、`runtime none`、`orm drizzle`、`api none`、`server-deploy none`；`database` 限 sqlite / postgres，`web-deploy` 限 vercel / docker / none。用户显式传入不兼容的值会报错，未显式传入的值自动收敛并提示。

测试：`apps/cli/test/product-mode.test.ts`（生成结构、栈收敛、冲突拦截）；`generated-builds.test.ts` 中的 `product-starter-postgres` 样例在 `XSTACK_BUILD_SAMPLES=1` 时跑安装与构建。

## 16. P1 实现现状

模块：`auth`、`email`、`admin`、`payment`、`credits`；预设 `starter`（auth）与 `saas-global`（auth[google, github] + email[resend] + admin + payment[stripe] + credits）。`saas-global` 在 sqlite/Docker 与 postgres/Vercel 下 `install + check-types + next build` 通过，并做过运行时冒烟测试（注册、注册赠送积分、mock 支付、webhook 重放、订阅、后台调账）。

| 约定         | 实现                                                                                                                                                                           |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 集成         | `apps/web/src/integrations/<name>.ts` 默认导出 `register(services)`，由 `services.ts` 自动导入并调用；模块间只通过领域事件通信（`auth.user_created`、`payment.order_paid` 等） |
| 事件投递语义 | 至少一次：处理器抛错会让 webhook 失败并由服务商重试，重试时重新发出事件；处理器须幂等（积分用 `referenceId` 去重，如 `order:<id>`、`signup:<userId>`）                         |
| 权限         | `packages/permissions`（CASL），`SubjectMap` 可扩充；better-auth `admin` 插件提供 `role`/封禁/冒充；`ADMIN_EMAILS` 中的邮箱注册即为管理员                                      |
| 支付服务商   | `PaymentProvider` 接口 + 归一化 webhook 事件；结账默认使用第一个 `configured` 的服务商，开发环境下未配置 Stripe 时自动回落到 `mock`                                            |
| 导航         | 清单 `nav` 支持 `role`（仅该角色可见）与 `when`（仅当另一模块存在时生成，如 `/admin/orders`）                                                                                  |
| 模块选项     | `OptionSpec` 支持 `number`（如 `--module-options credits.signupBonus=100`）                                                                                                    |
| 依赖版本     | 生成项目使用发布至少约两周的版本，避免新版本尚未同步到镜像/缓存导致安装失败                                                                                                    |

## 17. 栈与模块融合迁移方案

### 17.1 现状问题

P1 的产品模式是"先跑完整的 XSTACK 栈生成，再用模块覆盖或删除"。同一栈配置（next、self、drizzle、sqlite）下，saas-global 相对纯栈输出：8 个 XSTACK 文件被删、13 个被改写、57 个原样复用、105 个新增。由此产生：

- **auth 两处维护**：XSTACK 的 better-auth 模板生成 `packages/auth`、schema、登录表单，auth 模块再整份覆盖或删除。依赖来自 XSTACK，代码来自模块；上游改名时 `removes` 静默失效。
- **支付两套概念**：栈维度 `payments: polar` 与 `payment` 模块并存，产品模式只能强制 `payments: none`。
- **隐式接缝**：模块靠解析 `services.ts` 文本、正则改写 `.env.schema`、按 XSTACK 文件名删除来接入，没有任何测试兜底。
- **模式割裂**：CLI 有"栈模式 / 产品模式"两个入口，产品模式把技术栈硬编码为 `PRODUCT_STACK`。

### 17.2 决定

与上游分家，不再保留独立的栈模式；用户始终选择技术栈。业务领域（auth、支付、示例）只以模块形式存在，不再是技术栈维度。

### 17.3 目标模型

```
ProjectConfig
├── Stack（基础设施）  frontend、backend、runtime、database、orm、api、dbSetup、webDeploy、serverDeploy、addons、packageManager
└── Product（领域）    features、providers、options
```

- **一个入口**：先选技术栈，再选功能模块（可为空）。默认技术栈为 next + self + drizzle + sqlite + api none，即原生模块的完整支持范围。
- **推导字段**：`ProjectConfig`、`CreateInput`、`xstack.jsonc` 中没有 `auth`、`payments`。生成器用 `toRenderConfig` 从模块计划推导出 `RenderConfig`（`ProjectConfig` + `auth` + `payments`），只供 `stack` 模板、处理器和生成后的 CLI 步骤读取；模板条件沿用这两个上下文名。
- **两种实现（variant）**，求解器按所选技术栈为每个模块选一种，同一栈组合只有一个实现：

  | variant  | 模板来源                                           | 范围                                   |
  | -------- | -------------------------------------------------- | -------------------------------------- |
  | `native` | `templates/modules/<id>/`                          | 完整功能，受清单 `supports` 约束       |
  | `stack`  | `templates/modules/<id>/stack/`（XSTACK 原有模板） | 基础功能，覆盖 XSTACK 原先支持的技术栈 |

  两者都不支持时报错，并列出各自的支持范围。`native` 时对应的 XSTACK 模板不再渲染，不存在"生成后覆盖"。

- **auth**：`engine` 选项（`better-auth` | `clerk`）决定认证引擎；`providers` 仍表示第三方登录（google、github…）。clerk 只有 `stack` 实现。
- **payment**：服务商 `stripe`、`polar`、`mock`，都实现原生 `PaymentProvider`；payment 没有 `domain`，也没有 `stack` 实现，只在原生栈上可用。
- **不混用**：只要有模块走 `stack` 实现，就不加外壳，只有原生实现的模块（email、admin、credits…）报错。`stack` 实现依赖的模块会被一并切到 `stack`。
- **外壳**：next + self 时 `core`、`i18n` 是隐藏基础模块；其他技术栈沿用 XSTACK 前端模板做外壳。`core` 不依赖 auth：会话、用户菜单、控制台归 auth 模块。
- **CLI**：只有 `--features`、`--preset`、`--providers`、`--module-options` 选择业务能力；`--auth`、`--payments`、`--examples` 已删除。技术栈参数与模块冲突时报错而不是静默改写。

### 17.4 迁移步骤

| 步骤            | 内容                                                                                                                                                                                                                                                                                                                                                                                                                                                     | 验收                                                                      |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| **M1 领域推导** | 清单增加 `domain`（推导字段与 `stack` 实现）和更细的 `supports`（backend、orm、api）；求解器选择 variant，计划始终存在（无功能时为空）；生成器入口推导 `auth`/`payments`，`native` 时跳过对应 XSTACK 模板；auth 原生实现接管 `packages/auth`、`api/auth` 路由、会话、用户菜单、控制台；core 去掉 auth 依赖；删除 `PRODUCT_STACK` 收敛逻辑，默认技术栈改为原生栈；CLI 合并入口、去掉 auth/payments 提问、旧参数映射                                       | saas-global、starter 产物不回退；旧参数生成的非 next 项目与原 XSTACK 一致 |
| **M1 状态**     | 已完成。50 个 XSTACK 构建样例经 `--auth`/`--payments` 别名生成，产物与迁移前逐字节一致（`xstack.jsonc` 改记录 `product` 除外）；产品样例 starter、saas-global、仅外壳均通过安装、类型检查与构建                                                                                                                                                                                                                                                          | —                                                                         |
| **M2 接缝契约** | 剩余 `removes`（XSTACK next 前端的 layout、首页、header）改为 `replaces`，目标不存在即报错；模块对栈产物的修改集中到 `seams`（`services.ts`、`.env.schema`、`package.json`、`turbo.json`、README）；为 next 外壳依赖的 XSTACK 产物加快照测试                                                                                                                                                                                                             | 删除或改名 XSTACK 文件时测试失败                                          |
| **M2 状态**     | 已完成。`src/modules/seams.ts` 是模块修改栈产物的唯一入口（`package.json` 依赖、`.env`、`.env.schema`、`services.ts`、db schema 索引），缺少依赖的栈文件即报错；模块模板覆盖未在 `replaces` 中声明的栈文件也报错；`packages/template-generator/test/modules.test.ts` 覆盖求解器 variant 选择、接缝守卫与外壳/starter/saas-global 文件清单快照。README 仍由 readme 生成器追加模块章节，无 turbo.json 接缝                                                 | —                                                                         |
| **M3 模板迁移** | `templates/auth`、`templates/payments`、`templates/examples` 迁入对应模块的 `stack/`；`processAuthTemplates` 等由模块 variant 调用；模板条件改读模块上下文，删除推导字段                                                                                                                                                                                                                                                                                 | `templates/` 下不再有领域目录                                             |
| **M3 状态**     | 已完成。auth、payment 的 XSTACK 模板与处理器迁入 `templates/modules/<id>/stack/` 与 `src/modules/stack/`，由 `domain.stack.render` 调用；`auth`、`payments` 从 `ProjectConfig`、CLI 参数、`xstack.jsonc` schema 删除，只存在于 `RenderConfig`；`examples`（todo、ai）整体删除，不再迁成模块；网页版 builder 的 auth/payments/examples 三栏合并为"功能"一栏，可用性由模块求解器判断。55 个构建样例产物与迁移前逐字节一致（`xstack.jsonc` 与随机密钥除外） | —                                                                         |
| **M4 收尾**     | polar 原生 `PaymentProvider`；需要 AI 能力时以 ai 模块重新加入                                                                                                                                                                                                                                                                                                                                                                                           | —                                                                         |
| **M4 状态**     | polar 已完成。`providers/polar.ts` 基于 `@polar-sh/sdk` 1.0（API `2026-10`）：checkout 使用 `providerRefs.polar` 指定的 product，webhook 将 `order.paid`、`subscription.created/updated` 映射为标准事件，客户门户使用 customer session；payment 的 `domain`、XSTACK polar 模板、`payments-deps`、`PaymentsSchema` 和 `RenderConfig.payments` 全部删除，非 Next 栈不再能选支付。生成项目已通过安装、类型检查、构建以及本地签名 webhook 测试               | —                                                                         |

## 18. P2.1 短信与手机号登录

范围经确认限定为 P2 的第一批：短信模块（阿里云、腾讯云、Twilio）和手机号验证码注册/登录；不包含微信登录、国内支付、OSS/COS、`saas-cn` 或 Node 部署目标。

实现采用现有模块清单与集成机制：`sms` 单独生成服务，`auth + sms` 激活手机号登录。服务商单选；默认 `aliyun`。三家 SDK 仅在所选产物中安装。CLI、Builder 和预览读取同一清单，已有预设保持不变。

验证码由认证模块生成；HMAC 保存手机号索引与验证码，数据库原子更新控制 60 秒重发间隔、5 分钟过期、3 次尝试和单次消费。短信模块通过领域事件投递；只有显式 `SMS_DELIVERY_MODE=console` 且开发模式才输出本地验证码。生产模式不允许控制台投递，未配置服务商时失败。合成手机号账户不能通过 `ADMIN_EMAILS` 自动提权。

本地验证（2026-10-20）：三家服务商产物通过安装、类型检查和生产构建；SQLite、PostgreSQL 迁移与手机号验证码并发消费通过。浏览器完成中文手机号注册/登录、刷新会话和 25 积分注册赠送；重复登录未重复赠送。接口检查包括重发冷却、过期、尝试次数、并发发送、重放、封禁用户、未验证手机号占用与生产控制台拒绝。Builder 可选择 SMS 服务商并生成相应参数。

外部验收未完成：没有调用真实短信发送接口或验证手机送达。正式接入需要提供所选服务商凭据、已审核签名/模板及合法测试号码；SDK 接受请求不等于运营商送达。完整 P2 仍未完成。

## 19. P2.2 微信网站登录

在现有 `auth` 模块中新增 `wechat` 服务商，仅支持原生 Next.js/Better Auth 模板，沿用固定版本 Better Auth 的微信网站授权码实现。CLI 使用 `--providers auth:wechat`；Builder 从清单展示相同选项。配置 `WECHAT_CLIENT_ID`、`WECHAT_CLIENT_SECRET` 后启用登录按钮，回调为 `/api/auth/callback/wechat`，授权范围为 `snsapi_login`。未修改既有预设，也未加入公众号/小程序登录。

微信不提供可信邮箱：映射为 AppID 与 UnionID/OpenID 派生的不可投递 `@wechat.invalid` 邮箱，保持未验证状态，并禁止此类身份经 `ADMIN_EMAILS` 自动提权。保留 Better Auth 的 state/cookie、可信回调源和未验证邮箱关联限制；禁用客户端 ID Token 登录。

本地验证：SQLite 原生认证项目及 PostgreSQL + SMS + Email 组合均通过安装、类型检查和生产构建。生产页面验证了凭据缺失时隐藏按钮及配置后显示按钮。`apps/cli/live-tests/wechat.ts` 使用受控服务商响应，执行真实生成认证处理器与 SQLite，覆盖授权 URL、state/cookie、过期、重放、错误 code、恶意跳转、伪造 ID Token、首次/重复登录及邮箱/管理员隔离。此测试不联系微信，不代表真实扫码成功。

真实开放平台验收仍需已审核网站应用、AppID/AppSecret、可达且已登记的回调域名和微信测试账号。跨应用身份迁移、UnionID/OpenID 变更迁移和账号合并不在本模板中自动处理。P2 的微信/支付宝支付、OSS/COS、`saas-cn` 和 Node 主机配置仍待实施。

主站构建阻塞已修复：Geist 字体改为随仓库发布的本地字体；`domain.stack.render` 的函数引用改为 `domain.stack.renderer` 标识，渲染器只由生成流水线导入，浏览器模块清单不再引入模板处理器和 Node 依赖。增加浏览器入口打包回归。默认 Turbopack 开发、webpack 开发和生产构建/启动均通过，浏览器验证 Builder 配置与文件预览正常。

## 20. P2.3 国内一次性支付

`payment:wechat,alipay` 接入微信 Native 扫码与支付宝电脑网站支付，生成人民币一次性套餐和积分包，不冒充自动续费订阅。微信使用 APIv3 请求签名、固定支付公钥验签和 AES-256-GCM 回调解密；支付宝使用官方 SDK 的 RSA2/PKCS8 公钥模式，回调只解码一次并拒绝重复字段。配置入口与 Builder 共享模块清单，二维码依赖只随微信选项进入 Web 包。

服务层核对订单所属服务商、金额、币种和已入账交易号，支付状态由验证后的异步通知更新。二维码页仅允许订单所属用户访问；浏览器回跳只提示等待订单历史确认。微信成功回调返回 204，支付宝成功返回纯文本 `success`，失败返回 `failure`。重复通知可重试事件投递，积分仍以订单 ID 幂等发放。

本地验证：生成 SQLite 项目安装、类型检查、生产构建和浏览器二维码待支付→已支付→账单记录通过；生产 HTTP 回调的响应协议与两订单各发放 500 积分通过。`apps/cli/live-tests/payments.ts` 使用临时 RSA 密钥和受控微信响应，覆盖签名、时间戳、公钥 ID、商户/应用、金额/币种、跨服务商订单、二维码所有权和重复通知。该验证不联系真实支付平台，也不代表发生真实收款。

SQLite/PostgreSQL 两个国内支付生成样本均通过安装、所有工作区类型检查和生产构建；PostgreSQL 此次只做生成/构建验证，未运行真实数据库结算。模块测试 14 项、Builder 测试 11 项通过，主站类型检查、CLI 构建及显式国内支付参数 dry-run 通过。

真实验收仍需已开通 Native/电脑网站支付的商户、匹配密钥、公开 HTTPS 回调、实际付款账号及账单核对。H5、自动扣款、退款、OSS/COS、`saas-cn` 和 Node 主机配置不属于本次交付。

## 21. P2.4 OSS/COS 私有文件

新增 `storage` 模块：`storage:oss`（默认）或 `storage:cos`，自动依赖认证，只支持原生 Next.js/self/Drizzle SQLite/PostgreSQL。生成私有文件控制台、上传/下载/删除 Route Handlers 和文件元数据表。使用官方 `ali-oss` / `cos-nodejs-sdk-v5`；SDK 服务端上传显式 private ACL，内容固定为二进制附件，下载签名有效期 60 秒，文件键使用用户 ID 哈希与随机 UUID。

HTTP 层在解析 multipart 前按实际流量限制请求体，文件最大 4 MiB；写请求核对配置的可信 Origin，下载/删除先校验数据库所有权。远端删除失败保留元数据；上传成功但元数据写入失败时补偿删除对象，补偿失败保留安全诊断，错误不携带 SDK 凭据。列表显示所有本人文件，未加入分页、公开分享或管理员文件访问。

SDK/真实 SQLite 验证使用限定测试桶域名的 HTTP 夹具，不接触真实云资源：两家 SDK 的私有签名上传/删除、60 秒附件链接、所有权、大小限制和失败补偿通过。两套生产 HTTP 应用的登录、CSRF、跨用户、上传/下载重定向/删除通过；浏览器验证 OSS 开发与生产页面上传、列表，以及开发页面删除。SQLite/PostgreSQL × OSS/COS 四种生成组合均通过安装、类型检查和生产构建。

修复集成问题：增加模块 Next 配置接缝，将 OSS Node SDK 外置，避免 Turbopack 静态解析 urllib 可选代理依赖；保留已有外置包配置。Varlock 环境代理不可枚举，provider 显式读取环境字段后再做 schema 校验，不能直接解析整个代理。未修改应用认证流程；验证夹具的 Fetch 拦截曾干扰 SSR，会话问题通过改用仅 HTTP 的 SDK 拦截解决。

真实 OSS/COS 权限、云端字节下载、签名过期与删除验收仍需专用私有桶和最小权限凭据；本地夹具不代表云端验收。S3/R2、`saas-cn` 和 Node 主机目标不在本次交付。

## 22. P3 扩展模块与 Cloudflare

P3 功能代码已实现，`full` 预设通过共享清单接入 CLI、Builder、oRPC 预览和配置复现；原 `starter`/`saas-global` 功能集合不变。`full` 包含 auth/email/sms/admin/payment/credits/storage/ai/seo/blog/affiliate/captcha，基础 i18n/core 自动加入。

| 项目 | 实现边界 |
| --- | --- |
| S3/R2 | 官方 S3 SDK、私有桶、60 秒签名附件 URL；R2 Workers binding 使用真实绑定，下载经过登录和所有权检查后流式返回，不是公开链接 |
| AI | OpenAI 对话/图片、Google 对话/图片/异步视频、OpenAI-compatible/DeepSeek 对话；能力决定 UI；模型/API 依据当前官方文档，不调用已停用 Sora/Veo |
| AI × credits/storage | 持久化任务、费用快照、请求幂等、确定失败/取消只退款一次；租约与写入 fencing；结果先持久化再存储；不确定供应商结果不自动重提/退款；AI 媒体限制 8 MiB，读取 JSON 流先限制 12 MiB |
| SEO/blog | canonical/hreflang、OG/Twitter、robots、动态公开 sitemap；数据库多语言文章、草稿/发布、管理员编辑/删除、版本冲突、安全 Markdown/JSON-LD，私有页面 noindex |
| affiliate | 签名 first-touch 邀请、注册绑定、已验证支付订单产生唯一积分佣金、重放/并发安全、个人与管理员报表；奖励是应用积分，不是现金，退款/争议需人工审计调整 |
| captcha | Turnstile 服务端 before-hook 强制保护邮箱注册/登录/重置/发验证邮件/短信发码；校验成功、域名、action、时间和重放；缺配置 fail closed，无生产绕过 |
| Cloudflare | OpenNext、D1、R2、Alchemy、手动触发部署 workflow 和上线清单；按目标选择缺省 provider，显式不兼容选择报错；Twilio HTTP、Stripe fetch/WebCrypto；D1/SQLite 积分用原子 batch，PostgreSQL 用行锁事务 |

验证记录（本地，不代表真实服务商验收）：

- 九种生成组合安装、全部工作区类型检查、生产构建通过：full SQLite/PostgreSQL、独立 AI/SEO/blog/affiliate/captcha、S3/R2 API。
- full Node 生产 HTTP：真实验证码钩子+本地签名 Siteverify 协议、真实邮件事件+本地邮件传输、确认链接、管理员/普通用户会话；博客 CRUD、草稿隔离、分页、翻译、CSRF、并发版本、sitemap 通过。
- AI 协议脚本执行真实生成服务和 SQLite：并发重放、冲突/跨用户、余额不足、失败/异步失败/取消退款、媒体字节、不确定结果不重提、兼容对话通过。full HTTP 对话/图片/视频与真实 S3 SDK 存储/读取通过，外部 HTTP 用限定域名夹具。
- 分销脚本执行真实 auth、Stripe 签名验证和积分账本：客户端私有字段拒绝、签名/过期/自邀请、并发付款重放、发奖后恢复、归因延迟恢复、归属和续费排除通过。
- full Cloudflare：真实 D1 迁移 35 条 SQL、OpenNext 构建和 Wrangler dry-run 通过；原生 workerd preview 公共/私有路由通过；限定外连夹具下完整 workerd+D1+R2 注册/邮件确认、AI 三模态、媒体字节、并发幂等/余额保护、博客/SEO、R2 上传/下载/删除、CSRF/越权及伪造支付拒绝通过。
- 浏览器执行验证码表单令牌交接、登录、AI 生成、博客创建/发布和邀请报表；截图保存在验证环境。验证码控件/模型结果是协议夹具，不是 Cloudflare 真人判断或真实模型输出。
- 模块/求解器测试 17 项、Builder 测试 12 项通过；主站类型检查、CLI `full` + D1/R2 dry-run 通过。

验收修复：Handlebars/JSX 结束边界、独立模块 unused context、Cloudflare 环境/导出类型、lazy proxy 的 `has` 行为、workerd 不支持 `redirect:error`（改 manual 且检查非成功状态）、SQLite 并发交互事务锁冲突（改原子 batch）。PostgreSQL 本轮做生成/类型/构建验证，未跑真实 PG 并发账本；云 IAM、真实付费模型、邮件/SMS 送达、支付收款和远端 Cloudflare 部署仍需专用账号验收。AI 供应商结果不确定时须人工核对；上传成功但链接写入前进程崩溃可能产生可追踪的孤立文件。

## 23. P4 生成后演进与代理协作

P3 已提交为 `2c510f1`。P4 在原 addon/package add 入口之外新增 `--features`、`--providers`、`--module-options` 和 `--initialize-baseline`；程序化 `add()`、JSON 与现有 MCP add/plan 工具共用 `AddInput.product`，返回文件计划和结构化冲突。

CLI 新项目在确定性格式化后保存 `.xstack/baseline/manifest.json`，内容来自生成树而非用户目录，带配置、版本与内容校验；排除 `.env`/`.dev.vars`，环境 schema 正常跟踪。追加时重新生成完整目标配置，逐文件三方合并；JSON 按对象字段合并，文本按行合并，二进制/删除/重叠修改冲突保守拒绝。没有冲突才提交文件、配置和新基线；日志、锁、独占文件创建与回滚支持中断恢复，符号链接路径拒绝。Dry-run 不创建基线、锁或恢复状态。

旧项目不能伪造祖先：显式采用基线仅接受与当前生成器干净重现匹配的文件；有修改时先保存定制并恢复原始 scaffold，再采用与重新应用修改。既有 addon/deploy 操作造成基线配置差异时明确要求协调，不静默改写祖先；模块追加与这些操作分开执行。不自动运行数据库迁移或云部署。

Builder 预览按当前配置键和请求轮次绑定，取消过时请求，重生成保留仍存在的文件选择；新增 guidance/module docs 入口、复制/下载状态及失败反馈，树展示点文件和真实模块产物。根 AGENTS 与项目 skill 根据实际模块、providers、命令、环境和部署生成，保留框架子目录说明，并用稳定的末尾用户备注区避免新增文档与用户追加规则冲突。

验收：实际新建 auth 项目，自定义首页/AGENTS/本地密钥后，经 API 连续追加 credits/payment，再经真实 CLI 追加 seo；dry-run 零写入、重复 no-op、定制和秘密保留，通过安装、全部工作区类型检查、生产构建、公开页面/定价/robots/sitemap HTTP 200 和积分页未登录跳转。真实冲突未改文件/配置，恢复后重试通过；符号链接拒绝、缺基线拒绝、干净采用基线、替换中断恢复通过。MCP 测试 19 项、Builder 测试 12 项通过。最小/full/Cloudflare guidance 命令和文档链接验证通过；浏览器选择 AGENTS、更改配置保持选择、快速改名只显示最新产物、下载文件内容与当前配置一致。
