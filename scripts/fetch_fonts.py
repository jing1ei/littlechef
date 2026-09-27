#!/usr/bin/env python3
"""把手写体（霞鹜文楷 Lite）下载到本地，让菜谱完全离线可用。

    python3 scripts/fetch_fonts.py            # 常规体
    python3 scripts/fetch_fonts.py --light    # 顺手再来一个 Light

霞鹜文楷 Lite 的 web 版被切成了近百个 woff2 分片，浏览器按需加载，
所以全下来大概 8~9 MB，但实际每页只会取用到的那几片。
字体授权：SIL Open Font License 1.1。
"""

import argparse
import os
import re
import sys
import urllib.request

CDN = "https://cdn.jsdelivr.net/npm/lxgw-wenkai-lite-webfont@1.6.0"
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(HERE, "web", "vendor", "fonts")
CSS_PATH = os.path.join(OUT_DIR, "wenkai.css")

FACES = {
    "regular": "lxgwwenkailite-regular.css",
    "light": "lxgwwenkailite-light.css",
}


def fetch(url):
    with urllib.request.urlopen(url, timeout=60) as res:
        return res.read()


def grab_face(name, css_name):
    print("· %s" % css_name)
    css = fetch("%s/%s" % (CDN, css_name)).decode("utf-8")
    files = sorted(set(re.findall(r"url\(['\"]?\.?/?([^'\")]+\.woff2)", css)))
    print("  %d 个分片" % len(files))
    for i, rel in enumerate(files, 1):
        target = os.path.join(OUT_DIR, os.path.basename(rel))
        if not os.path.exists(target):
            with open(target, "wb") as fh:
                fh.write(fetch("%s/%s" % (CDN, rel)))
        sys.stdout.write("\r  %d/%d" % (i, len(files)))
        sys.stdout.flush()
    print()
    # 把 url() 改成同目录相对路径
    css = re.sub(r"url\(['\"]?\.?/?([^'\")]+/)?([^'\")/]+\.woff2)", r"url(\2", css)
    return css


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--light", action="store_true", help="顺便下载 Light 字重")
    args = ap.parse_args()

    os.makedirs(OUT_DIR, exist_ok=True)
    chunks = ["/* 本地手写体：霞鹜文楷 Lite (SIL OFL 1.1) · scripts/fetch_fonts.py 生成 */"]
    chunks.append(grab_face("regular", FACES["regular"]))
    if args.light:
        chunks.append(grab_face("light", FACES["light"]))

    with open(CSS_PATH, "w", encoding="utf-8") as fh:
        fh.write("\n".join(chunks))
    size = sum(
        os.path.getsize(os.path.join(OUT_DIR, f)) for f in os.listdir(OUT_DIR)
    ) / 1048576.0
    print("写好了 %s（本地字体共 %.1f MB）" % (CSS_PATH, size))
    print("现在可以把 index.html 里那行 jsdelivr 的 <link> 删掉，完全离线。")


if __name__ == "__main__":
    main()
