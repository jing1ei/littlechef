#!/usr/bin/env python3
"""把手机上写的东西并回家里这本菜谱。

用法：

    python3 scripts/merge_export.py ~/Downloads/littlechef-2026-09-14.json
    python3 scripts/merge_export.py bundle.json --dry-run     # 先看看会动什么

来路：分享出去的静态链接（dist/）是能写的 —— 在地铁上、在超市里想起一道菜就
记下来，改动先存在那台设备的浏览器里。点角标「本机草稿 → 导出成文件」会拿到
一个 JSON，把它扔给这个脚本，就并进 data/ 里，成为家里这本的一部分。

规矩：
  * 只处理 only_local_changes，也就是那台设备上真正动过的东西。没动过的不碰，
    免得把 NAS 上后来改的内容盖回旧版本。
  * 同一个 id 两边都改过的时候，默认停下来问；--prefer 可以指定谁说了算。
  * 照片按原名写进 data/images/，重名不覆盖，另存一份。
  * 删除要 --allow-delete 才执行 —— 误删一道菜比多留一道难受得多。
"""

import argparse
import base64
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, HERE)

from app import store, validation  # noqa: E402

COLLECTIONS = ("recipes", "pantry", "menus")


def load_bundle(path):
    with open(path, "r", encoding="utf-8") as fh:
        payload = json.load(fh)
    if not isinstance(payload, dict) or not (payload.get("little_chef") or payload.get("kitchen_notes")):
        raise SystemExit("这个文件不像是菜谱导出的（缺 kitchen_notes 标记）")
    return payload


def write_image(name, data_url, dry_run):
    """data: URL 落成 data/images 里的文件。重名不覆盖，另起一个名字。"""
    # 名字只保留 basename 并挡住 ..，导入包里带 `../etc/passwd.jpg` 也不能穿出去
    safe = os.path.basename(name or "").lstrip(".")
    if not safe or safe != name:
        # 名字被改写（比如带路径分隔符）就当新照片处理，别对不上原来的引用
        if not safe:
            return None
    name = safe
    m = re.match(r"^data:([^;,]+)?(;base64)?,(.*)$", data_url or "", re.S)
    if not m:
        return None
    raw = base64.b64decode(m.group(3)) if m.group(2) else m.group(3).encode("utf-8")

    target = store.data_path("images", name)
    if os.path.exists(target):
        with open(target, "rb") as fh:
            if fh.read() == raw:
                return name          # 一模一样，不用再写
        stem, ext = os.path.splitext(name)
        name = "%s-%s%s" % (stem, store.stamp(), ext)
        target = store.data_path("images", name)

    if not dry_run:
        os.makedirs(os.path.dirname(target), exist_ok=True)
        with open(target, "wb") as fh:
            fh.write(raw)
    return name


def merge(path, prefer="ask", allow_delete=False, dry_run=False):
    payload = load_bundle(path)
    changes = payload.get("only_local_changes")
    if changes is None:
        raise SystemExit("请使用本机草稿导出包；完整快照应通过 /api/import 导入")
    if not isinstance(changes, dict):
        raise SystemExit("only_local_changes 必须是对象")
    removed = changes.get("removed") or {}
    if not isinstance(removed, dict) or any(k not in COLLECTIONS or not isinstance(v, list) for k, v in removed.items()):
        raise SystemExit("删除清单包含未知集合或格式不正确")
    for collection in COLLECTIONS:
        if not isinstance(changes.get(collection, []), list) or any(not isinstance(x, dict) for x in changes.get(collection, [])):
            raise SystemExit(collection + " 必须是对象列表")
    images = payload.get("images") or {}
    if not isinstance(images, dict): raise SystemExit("images 必须是对象")
    for collection in COLLECTIONS:
        for item in changes.get(collection, []):
            try: validation.item(collection, item)
            except ValueError as exc: raise SystemExit(str(exc)) from exc
    # Validate every image before writing any record or image.
    for name, value in images.items():
        if not isinstance(name, str) or name != os.path.basename(name) or name.startswith('.') or '\\' in name:
            raise SystemExit("图片名不合法")
        if not isinstance(value, str) or not re.fullmatch(r'data:[^,]*;base64,[A-Za-z0-9+/=\s]*', value):
            raise SystemExit("图片数据无效")
        try: base64.b64decode(value.split(',', 1)[1], validate=True)
        except ValueError as exc: raise SystemExit("图片编码无效") from exc
    if not dry_run:
        store.ensure_dirs()
        store.snapshot_bucket("merge")

    # 先安顿照片：菜谱里的 image 字段可能要跟着改名
    renamed = {}
    for name, data_url in (payload.get("images") or {}).items():
        final = write_image(name, data_url, dry_run)
        if final and final != name:
            renamed[name] = final
        if final:
            print("  图  %s%s" % (final, "（原名 %s）" % name if final != name else ""))

    tally = {"新增": 0, "更新": 0, "跳过": 0, "删除": 0}

    for collection in COLLECTIONS:
        for item in changes.get(collection) or []:
            item_id = item.get("id")
            if not item_id:
                continue
            # id 也要过一遍安全检查，坏 id 直接跳过
            try:
                store._safe_id(item_id)
            except ValueError:
                print("  跳过 %s/%s：id 不合法" % (collection, item_id))
                tally["跳过"] += 1
                continue
            for field in ("image", "original_image", "illustration_image"):
                if item.get(field) in renamed:
                    item[field] = renamed[item[field]]

            existing = store.get_item(collection, item_id)
            if existing is None:
                print("  新增 %s/%s：%s" % (collection, item_id, item.get("title") or item.get("name") or ""))
                tally["新增"] += 1
                if not dry_run:
                    store.save_item(collection, item)
                    if collection == "recipes": store.merge_new_tags(item)
                continue

            if existing == item:
                tally["跳过"] += 1
                continue

            keep = prefer
            if prefer == "ask":
                label = item.get("title") or item.get("name") or item_id
                print("\n  两边都改过：%s/%s（%s）" % (collection, item_id, label))
                print("    这台 NAS 上次改的：%s" % (existing.get("updated") or "不知道"))
                print("    带回来的这份：    %s" % (item.get("updated") or "不知道"))
                answer = input("    用哪份？[b]带回来的 / [n]NAS 上的 / [s]跳过 > ").strip().lower()
                keep = {"b": "bundle", "n": "nas", "s": "skip"}.get(answer, "skip")

            if keep == "bundle":
                print("  更新 %s/%s" % (collection, item_id))
                tally["更新"] += 1
                if not dry_run:
                    store.save_item(collection, item)
                    if collection == "recipes": store.merge_new_tags(item)
            else:
                print("  留着 NAS 上的 %s/%s" % (collection, item_id))
                tally["跳过"] += 1

    for collection, ids in (changes.get("removed") or {}).items():
        for item_id in ids or []:
            if not allow_delete:
                print("  这份文件里删掉了 %s/%s（要真删加 --allow-delete）" % (collection, item_id))
                continue
            print("  删除 %s/%s" % (collection, item_id))
            tally["删除"] += 1
            if not dry_run:
                store.delete_item(collection, item_id)

    print("\n%s：新增 %d · 更新 %d · 跳过 %d · 删除 %d"
          % ("看一眼（没有真写）" if dry_run else "并好了",
             tally["新增"], tally["更新"], tally["跳过"], tally["删除"]))
    if dry_run:
        print("确认没问题就去掉 --dry-run 再跑一次。")
    else:
        print("data/ 就是全部内容，顺手拷一份走当备份。")


def main():
    ap = argparse.ArgumentParser(description="把浏览器里导出的菜谱并回 data/")
    ap.add_argument("bundle", help="导出的 JSON 文件")
    ap.add_argument("--prefer", choices=["ask", "bundle", "nas"], default="ask",
                    help="两边都改过时谁说了算，默认停下来问")
    ap.add_argument("--allow-delete", action="store_true", help="真的执行删除")
    ap.add_argument("--dry-run", action="store_true", help="只看会动什么，不写")
    args = ap.parse_args()

    if not os.path.exists(args.bundle):
        raise SystemExit("找不到这个文件：" + args.bundle)
    merge(args.bundle, prefer=args.prefer, allow_delete=args.allow_delete, dry_run=args.dry_run)


if __name__ == "__main__":
    main()
