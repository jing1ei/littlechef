#!/usr/bin/env python3
"""导出一份「能带着走的静态菜谱」，可以直接扔到任何静态托管上分享。

    python3 scripts/export_static.py            # 输出到 dist/
    python3 scripts/export_static.py --out /tmp/kitchen

做的事：把 data/ 里的菜谱、食材、菜单、插画打包成 web/ 的同构目录：
dist/bootstrap.json + dist/img/*，前端发现 /api 不通就会自动读它们。

注意它不是只读的：这种链接上照样能记菜、记一笔、排菜单，改动落在打开它的
那台设备的浏览器里（IndexedDB），随时能导出成一个 JSON 带回家，再从 NAS 上
那本菜谱里导入。站在灶台边的人不该因为「这是预览版」就写不了字。
"""

import argparse
import json
import os
import shutil
import sys
from pathlib import Path

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, HERE)

from app import store, settings  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join(HERE, "dist"))
    args = ap.parse_args()

    out = os.path.abspath(args.out)
    web = os.path.join(HERE, "web")

    sources = [HERE, web, os.path.realpath(store.DATA_DIR)]
    resolved = os.path.realpath(out)
    if any(resolved == src or os.path.commonpath([resolved, src]) == resolved for src in sources):
        ap.error("输出目录不能是项目、数据目录或它们的上级目录")
    if os.path.commonpath([resolved, os.path.realpath(store.DATA_DIR)]) == os.path.realpath(store.DATA_DIR):
        ap.error("输出目录不能放在 data 内")
    if os.path.commonpath([resolved, web]) == web:
        ap.error("输出目录不能放在 web 内")
    if os.path.islink(out):
        ap.error("输出目录不能是符号链接")
    marker = os.path.join(out, ".kitchen-static-export")
    if os.path.exists(out) and (not os.path.isdir(out) or
            (os.listdir(out) and not os.path.isfile(marker))):
        ap.error("输出目录已有其他文件，请指定空目录或先前由此脚本生成的目录")
    store.seed_if_empty()
    if os.path.isdir(out):
        shutil.rmtree(out)
    shutil.copytree(web, out)
    Path(marker).write_text("littlechef static export\n", encoding="utf-8")

    payload = store.bootstrap({
        "house_name": settings.get("house_name"),
        "house_subtitle": settings.get("house_subtitle"),
        "read_only": False,
        "pin_required": False,
        "image_provider": "static",
        "image_ready": False,
        "mode": "local",
    })
    with open(os.path.join(out, "bootstrap.json"), "w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, indent=2)

    img_out = os.path.join(out, "img")
    os.makedirs(img_out, exist_ok=True)
    src_img = store.data_path("images")
    copied = 0
    if os.path.isdir(src_img):
        for name in sorted(os.listdir(src_img)):
            if name.startswith(".") or not os.path.isfile(os.path.join(src_img, name)):
                continue
            shutil.copy2(os.path.join(src_img, name), os.path.join(img_out, name))
            copied += 1

    size = sum(
        os.path.getsize(os.path.join(dp, f))
        for dp, _, fs in os.walk(out) for f in fs
    ) / 1048576.0
    print("导出好了：%s" % out)
    print("  菜谱 %d 道 · 食材调味 %d 样 · 菜单 %d 份 · 插画 %d 张 · 共 %.1f MB"
          % (len(payload["recipes"]), len(payload["pantry"]), len(payload["menus"]), copied, size))


if __name__ == "__main__":
    main()
