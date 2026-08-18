# 项目进度看板

一个**纯前端、无后端**的项目进度追踪 Web 应用（PWA），数据保存在浏览器本地。
主项目 → 子项层级，每个子项固定拥有 **15 个里程碑阶段**，可在看板上逐格勾选推进。

在线地址（GitHub Pages）：<https://lucas-1113.github.io/project-progress-board/>

---

## 功能特性

- **15 阶段密集看板**：立项、样品评审、出样、试产、量产等 15 个里程碑阶段并列展示，子项逐格勾选。
- **项目层级**：主项目 / 子项两级结构，支持项目详情抽屉编辑。
- **节点提醒**：每个项目可填「检查日期」，在到期前自动预警（默认提前 3 天，可在阶段设置中调整），以顶部横幅 + 看板行标记提示。
- **导出追踪表**：一键按「研发部项目进度追踪表模版.xls」生成报表——
  - `Summary` 表：阶段勾选汇总 + 项目进度（方块进度条 + 百分比）；
  - `Detail` 表：统计区（已结案 / 计划内 / 风险 / 总数）+ 项目明细，并嵌入每个项目的第一张真实图片。
- **备份与恢复**（工具栏下拉菜单）：导入旧版 `.xls`、导入 Excel 备份、导出 Excel 备份，方便换机 / 清缓存后恢复数据。
- **离线可用**：PWA（service worker）缓存，断网后仍可打开。
- **数据本地化**：项目、备注、图片全部存于浏览器 IndexedDB，不上传任何服务器。

---

## 技术栈

- React 19 + TypeScript
- Vite（构建配置 `vite.pages.config.ts`，入口 `pages-src/`，产物 `dist-pages/`）
- SheetJS（`xlsx`）—— Excel 备份读写
- ExcelJS（`exceljs`）—— 追踪表（含图片）写入
- 数据存储：浏览器 IndexedDB（见 `app/lib/db.ts`）
- 托管：GitHub Pages（`gh-pages` 分支根目录）

---

## 目录结构

```text
.
├── app/                    # 应用核心源码
│   ├── ProjectBoard.tsx    # 主组件（看板、工具栏、详情抽屉、提醒 UI）
│   ├── page.tsx            # 页面入口
│   ├── layout.tsx          # 布局
│   ├── PwaRegistration.tsx # PWA 注册
│   ├── globals.css         # 全局样式
│   ├── types.ts            # 数据类型定义
│   └── lib/
│       ├── db.ts           # IndexedDB 读写
│       ├── excel.ts        # 导出追踪表 / Excel 备份
│       ├── legacy-xls.ts   # 旧版 .xls 导入
│       └── reminder.ts     # 检查日期解析与提醒逻辑
├── pages-src/              # Vite Pages 入口（index.html + main.tsx）
├── public/                 # 静态资源（图标、manifest 等）
├── vite.pages.config.ts    # Pages 构建配置
├── publish.sh              # 一键发布脚本（构建 → 提交 main → 发布 gh-pages）
├── dist-pages/             # 构建产物（即 GitHub Pages 发布目录）
└── package.json
```

> 说明：仓库中另有一些早期模板遗留目录（`.next/`、`build/`、`db/`、`drizzle/`、`worker/` 等），本项目实际发布仅使用上面的 Pages 相关文件，`npm run build:pages` 与 `gh-pages` 分支。

---

## 本地开发与部署

### 环境要求

- Node.js ≥ 22.13.0
- 已登录 GitHub CLI（`gh auth login`）并执行 `gh auth setup-git` 以便发布

### 常用命令

```bash
npm install            # 安装依赖

npm run dev            # 本地开发（vinext 框架，可选）
npm run preview:pages  # 本地预览 Pages 构建产物
npm run build:pages    # 构建 Pages 产物到 dist-pages/
npm run test           # 运行构建与渲染测试
npm run lint           # 代码检查
```

### 一键发布到 GitHub Pages

```bash
./publish.sh "本次发布说明（可选）"
```

脚本会依次：① 执行 `npm run build:pages`；② 把源码提交到 `main`；③ 将 `dist-pages/` 内容发布到 `gh-pages` 分支。**幂等**——若无改动则跳过相应步骤。

注意：线上站点更新后，浏览器有 CDN 缓存，访问者需 **硬刷新**（`Cmd + Shift + R` / `Ctrl + Shift + R`）才能拿到新版本。

---

## 使用指南

### 检查日期格式

「检查日期」字段支持多种写法，系统自动识别：

- `2026.08.12`、`2026/08/12`
- `8/11`（省略年份按今年推断）
- `8月11日`

合法但不在预警窗口内的日期会显示「正常」，不会触发提醒；无法识别的写法会在详情抽屉中给出红色提示。

### 数据迁移与共享

- **共享框架**：把网址发给别人即可，对方打开后是空白看板（数据在其本地浏览器）。
- **共享数据**：用「备份与恢复 → 导出 Excel 备份」生成 `.xlsx` 发给对方，对方「导入 Excel 备份」即可恢复项目和图片。
- **汇报导出**：「导出追踪表」生成与研发部模板一致的汇报表（含图片），用于发给同事 / 领导查看。

### 备份与恢复菜单

工具栏的「备份与恢复 ▾」下拉包含：

| 菜单项 | 说明 |
|--------|------|
| 导入旧版 .xls | 导入最早版本的研发部 `.xls` 初始数据（一次性迁移） |
| 导入 Excel 备份 | 恢复此前「导出 Excel 备份」生成的文件 |
| 导出 Excel 备份 | 备份全部项目、子项、图片与阶段设置 |

> 「导出追踪表」为独立按钮，其生成的报表**不能**重新导入看板，仅用于汇报。

---

## 已知问题与排错

- **下载的追踪表打不开**：旧版本存在 `URL.revokeObjectURL` 过早调用导致文件未写完的问题，已在 v0.1.x 修复；如仍遇到，请硬刷新后重新导出。
- **修改检查日期后白屏**：旧版本对提醒对象做了非空断言，当日期合法但不在预警窗口内时会崩溃，已修复；当前版本会正常显示「正常」。
- **图片导出**：追踪表 `Detail` 表 `Picture` 列目前嵌入每个项目的**第一张**图片（PNG，最大 160×120 等比缩放）；一个项目多张图时仅导出首图。

---

## 许可证

内部工具，未标注开源许可证。
