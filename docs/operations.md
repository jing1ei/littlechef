# 维护与开发指南

[返回使用说明](../README.md)

## 配置与部署

设置优先级：`data/settings.json` > 环境变量 > 默认值。新变量使用 `LITTLE_CHEF_*`；Python 服务仍接受旧 `KITCHEN_*`，同时设置时新变量优先。页面设置立即生效，环境变量修改后需要重启。完整变量示例见 [`.env.example`](../.env.example)。不要将含密钥的 `.env` 或 `data/settings.json` 提交到仓库。

| 变量 | 默认 | 作用 |
| --- | --- | --- |
| `LITTLE_CHEF_DATA_DIR` | 项目下 `data/` | 本地数据路径；容器内固定为 `/data` |
| `LITTLE_CHEF_PORT` | `8848` | 服务端口与 Compose 映射端口 |
| `LITTLE_CHEF_HOST` | `0.0.0.0` | 本地运行时监听地址 |
| `LITTLE_CHEF_EDIT_PIN` | 空 | 写操作口令 |
| `LITTLE_CHEF_READ_ONLY` | `0` | 只读模式 |
| `LITTLE_CHEF_IMAGE_PROVIDER` | `none` | 按菜名生成插画的服务 |
| `LITTLE_CHEF_VISION_*` | 见示例 | 照片识别地址、模型、密钥 |
| `LITTLE_CHEF_PHOTO_EDIT_*` | 见示例 | 照片编辑地址、模型、密钥 |

NAS 上更改存储位置时，修改 `docker-compose.yml` 的卷映射，例如 `/volume1/docker/littlechef/data:/data`。使用一个应用进程写入同一数据目录；运行文件合并脚本前先停止应用，避免并发覆盖。

## 备份与恢复

停止服务后复制 `data/`；恢复时将目录放回原位置再启动。设置包含密钥，请保护备份。删除的菜谱和未被引用的图片会进入 `data/.trash`；导入或草稿合并之前也会保存恢复副本。回收内容不会自动清空。

不含设置的 JSON 快照：

```bash
curl --fail http://localhost:8848/api/export -o kitchen-backup.json
curl --fail -X POST http://localhost:8848/api/import \
  -H 'Content-Type: application/json' \
  -H 'X-Kitchen-Pin: 你的编辑口令' \
  --data-binary @kitchen-backup.json
```

未设 PIN 可省略该请求头。导入按 ID 新增或覆盖记录，**不会删除快照里没有的已有记录**；导入前的数据副本在 `data/.trash/import-*`。完整恢复应使用停止服务后的目录备份。

## 导出静态版

```bash
python3 scripts/export_static.py
python3 -m http.server 8899 --directory dist --bind 127.0.0.1
```

打开 [localhost:8899](http://localhost:8899)，或把 `dist/` 上传到静态托管。不要直接双击 HTML 文件。`--out /目标目录` 可更改导出位置；仅接受空目录或脚本自己生成过的目录。

静态版支持本机记录、拍照、计时、菜单和 JSON 导入导出；没有后端，不能调用 AI。数据保存在该网站来源的浏览器存储中，域名或端口变化可能意味着另一份本机草稿。网络字体不等于离线资源，见下节。

把本机草稿并回 NAS（先停止服务，在项目目录执行）：

```bash
python3 scripts/merge_export.py ~/Downloads/littlechef.json --dry-run
python3 scripts/merge_export.py ~/Downloads/littlechef.json
```

只合并 `only_local_changes`；同 ID 内容不一致时询问使用哪份。`--prefer bundle` 采用带回的内容，`--prefer nas` 保留 NAS 内容。删除仅在 `--allow-delete` 时执行。此工具不是 `/api/export` 完整快照的导入器。

## 本地字体

```bash
python3 scripts/fetch_fonts.py
```

下载成功后移除 `web/index.html` 中 jsDelivr 的外部字体 `<link>`，保留 `vendor/fonts/wenkai.css`，再重新导出静态版或重建容器。字体需要遵守 SIL OFL 1.1；未下载时仍可使用系统字体。

## 开发与验证

安装 Python 3.11+ 和 Node.js。使用独立环境：

```bash
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt httpx playwright
python -m playwright install chromium

python scripts/smoke_server.py
python scripts/check_regressions.py
python scripts/check_photo.py
python scripts/check_release.py
TZ=Asia/Shanghai node scripts/check_logic.js
```

以上后端检查使用临时数据目录，照片测试模拟外部服务。浏览器检查需先导出静态包：

```bash
LITTLE_CHEF_DATA_DIR="$(mktemp -d)" python scripts/export_static.py
python scripts/check_web.py
```

设置页检查会修改测试服务的配置，**不要对生产服务运行**。先在另一终端启动临时服务：

```bash
LITTLE_CHEF_DATA_DIR="$(mktemp -d)" python -m uvicorn app.main:app --host 127.0.0.1 --port 8850
```

然后运行 `python scripts/check_settings.py`；可用 `LITTLE_CHEF_TEST_URL` 指定其他测试地址。

README 截图可复现生成：

```bash
python scripts/capture_screenshots.py
```

脚本自行启动临时服务，使用内置示例内容，不读取生产数据、不调用 AI。输出到 `docs/screenshots/`；拍照截图上传的是已有示例插画，用于展示操作界面。

真实 AI 服务、Docker/NAS 部署、真机相机及系统权限仍需在相应环境验收。

## 代码入口

| 目录 / 文件 | 负责 |
| --- | --- |
| `app/main.py` | API、权限与静态托管 |
| `app/store.py` | JSON 数据、首次初始化、回收副本 |
| `app/settings.py` | 页面与环境变量配置 |
| `app/photoai.py` / `app/imagegen.py` | 照片识别、照片编辑、插画生成 |
| `web/js/photo-entry.js` / `editor.js` | 拍照草稿和编辑表单 |
| `web/js/localdb.js` / `data.js` | 浏览器草稿与服务端数据 |
| `web/js/coursegen.js` / `cookmode.js` | 菜单与下厨模式 |
| `seed/` | 初始示例数据及插画 |
| `skill/` | 聊天录入技能与 CLI |

API 交互文档在运行服务的 `/api/docs`。主要接口：`/api/recipes`、`/api/pantry`、`/api/menus`、`/api/settings`、`/api/photos/analyze`、`/api/photos/stylize`、`/api/export`、`/api/import`。写操作受编辑 PIN 和只读设置控制。
