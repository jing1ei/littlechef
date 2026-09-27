#!/usr/bin/env python3
"""littlechef · CLI —— 在聊天里往 NAS 上那本菜谱记东西。

    export LITTLE_CHEF_URL=http://192.168.1.8:8848
    export LITTLE_CHEF_PIN=1234        # 如果设了编辑口令

    littlechef_cli.py ping
    littlechef_cli.py list --role 凉菜 --season 夏 --tag 快手
    littlechef_cli.py show hongshaorou
    littlechef_cli.py tags
    littlechef_cli.py add recipe.json          # 见 --template 输出的骨架
    littlechef_cli.py add - < recipe.json
    littlechef_cli.py template                 # 打印一个空模板（含全部可用标签）
    littlechef_cli.py log hongshaorou --rating 5 --note "糖色停早了，颜色浅但干净"
    littlechef_cli.py stock shaoxingjiu --out   # 标记「用完了」
    littlechef_cli.py illustrate hongshaorou    # 让大模型画一张
"""

import argparse
import json
import os
import sys
import urllib.error
import urllib.request

BASE = (os.environ.get("LITTLE_CHEF_URL") or os.environ.get("KITCHEN_URL") or "http://127.0.0.1:8848").rstrip("/")
PIN = os.environ.get("LITTLE_CHEF_PIN") or os.environ.get("KITCHEN_PIN") or ""


def call(path, payload=None, method=None):
    url = BASE + path
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    headers = {"Content-Type": "application/json"}
    if PIN:
        headers["X-Kitchen-Pin"] = PIN
    req = urllib.request.Request(url, data=data, headers=headers,
                                method=method or ("POST" if data else "GET"))
    try:
        with urllib.request.urlopen(req, timeout=300) as res:
            body = res.read().decode("utf-8")
            return json.loads(body) if body else None
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", "ignore")
        try:
            detail = json.loads(detail).get("detail", detail)
        except ValueError:
            pass
        sys.exit("菜谱那边拒绝了（%s）：%s" % (exc.code, detail))
    except urllib.error.URLError as exc:
        sys.exit("连不上 %s —— NAS 上的菜谱开着吗？（%s）" % (BASE, exc.reason))


# --------------------------------------------------------------------------- #


def cmd_ping(_):
    boot = call("/api/bootstrap")
    cfg = boot["config"]
    print("%s · %s  @ %s" % (cfg.get("house_name"), cfg.get("house_subtitle"), BASE))
    print("菜谱 %d 道 · 食材调味 %d 样 · 存好的菜单 %d 份"
          % (len(boot["recipes"]), len(boot["pantry"]), len(boot["menus"])))
    print("出图模型：%s（%s）· 只读：%s · 需要口令：%s"
          % (cfg.get("image_provider"), "可用" if cfg.get("image_ready") else "会用占位图",
             cfg.get("read_only"), cfg.get("pin_required")))


def cmd_list(args):
    for r in call("/api/recipes"):
        tags = r.get("tags") or {}
        if args.role and args.role not in (r.get("course_role") or []):
            continue
        if args.season and args.season not in (tags.get("season") or []):
            continue
        if args.tag and not any(args.tag in (v or []) for v in tags.values()):
            continue
        if args.q and args.q not in json.dumps(r, ensure_ascii=False):
            continue
        print("%-24s %-14s %-22s %s 分钟%s"
              % (r["id"], "/".join(r.get("course_role") or []), r["title"],
                 (r.get("time") or {}).get("total", "?"),
                 "  ← 还没配图" if not r.get("image") else ""))


def cmd_show(args):
    r = call("/api/recipes/" + args.id)
    print("%s（%s）· %s 人份 · %s 分钟" % (r["title"], r.get("subtitle") or "",
                                     r.get("servings"), (r.get("time") or {}).get("total")))
    print(r.get("summary") or "")
    for k, v in (r.get("tags") or {}).items():
        print("  %-9s %s" % (k, "、".join(v or [])))
    print("\n食材")
    for i in r.get("ingredients") or []:
        print("  · %s %s %s" % (i.get("name"), i.get("qty") or "", i.get("note") or ""))
    print("调味")
    for i in r.get("seasonings") or []:
        print("  · %s %s %s" % (i.get("name"), i.get("qty") or "", i.get("note") or ""))
    print("\n步骤")
    for n, s in enumerate(r.get("steps") or [], 1):
        print("  %d. %s" % (n, s.get("text")))
        if s.get("tip"):
            print("     ↳ %s" % s["tip"])
    if r.get("notes"):
        print("\n笔记：%s" % r["notes"])
    for e in r.get("log") or []:
        print("  [%s] %s 分 %s" % (e.get("date"), e.get("rating"), e.get("note")))


def cmd_tags(_):
    tax = call("/api/bootstrap")["taxonomy"]
    for f in tax["facets"]:
        print("%-10s %s" % (f["key"], "、".join(v["name"] for v in f.get("values", []))))
    print("%-10s %s" % ("上菜角色", "、".join(r["name"] for r in tax["course_roles"])))


TEMPLATE = {
    "title": "菜名",
    "subtitle": "Latin name（配图和排版会用到，可留空）",
    "summary": "一句话说清这道菜的关键",
    "servings": 4,
    "time": {"prep": 15, "cook": 30},
    "difficulty": 2,
    "course_role": ["热炒"],
    "make_ahead": False,
    "hands_off": False,
    "tags": {
        "occasion": ["日常晚饭"], "cuisine": ["江浙"], "main": ["猪肉"],
        "method": ["炒"], "flavor": ["咸鲜"], "season": ["全年"],
        "station": ["灶台"], "traits": ["快手"], "diet": [], "status": ["在试"],
    },
    "ingredients": [{"name": "食材", "qty": "300g", "note": "怎么切", "pantry": None}],
    "seasonings": [{"name": "生抽", "qty": "1 汤匙", "note": "", "pantry": "shengchou"}],
    "steps": [{"text": "这一步做什么", "tip": "为什么这么做 / 容易翻车的地方"}],
    "notes": "下次怎么改",
    "source": "哪儿学的",
}


def cmd_template(_):
    print(json.dumps(TEMPLATE, ensure_ascii=False, indent=2))
    print("\n# 标签必须用菜谱里已有的词，或者随手写新词（会自动并进标签体系）。", file=sys.stderr)
    print("# 先跑 tags 看看现在有哪些。", file=sys.stderr)


def cmd_add(args):
    raw = sys.stdin.read() if args.file == "-" else open(args.file, encoding="utf-8").read()
    payload = json.loads(raw)
    items = payload if isinstance(payload, list) else [payload]
    for item in items:
        t = item.get("time") or {}
        if "total" not in t:
            t["total"] = (t.get("prep") or 0) + (t.get("cook") or 0)
            item["time"] = t
        out = call("/api/recipes", item)
        print("记好了：%s  →  %s/app/#/recipe/%s" % (out["title"], BASE, out["id"]))
        if args.illustrate:
            got = call("/api/images/generate", {"kind": "recipe", "id": out["id"]})
            print("  插画：%s（%s）" % (got["image"], got["provider"]))


def cmd_log(args):
    changed = [c.strip() for c in (args.changed or "").split(",") if c.strip()]
    out = call("/api/recipes/%s/log" % args.id,
               {"rating": args.rating, "note": args.note, "cook": args.cook,
                "date": args.date, "changed": changed})
    print("记下了。%s 一共有 %d 条记录了。" % (out["title"], len(out.get("log") or [])))


def cmd_stock(args):
    out = call("/api/pantry/%s/stock" % args.id, {"in_stock": not args.out})
    print("%s：%s" % (out["name"], "有" if out["in_stock"] else "用完了"))


def cmd_illustrate(args):
    got = call("/api/images/generate", {"kind": args.kind, "id": args.id})
    print("画好了：%s（%s）" % (got["image"], got["provider"]))
    print("提示词：%s" % got["prompt"])


def main():
    ap = argparse.ArgumentParser(description="littlechef CLI")
    sub = ap.add_subparsers(dest="cmd", required=True)

    sub.add_parser("ping").set_defaults(fn=cmd_ping)

    p = sub.add_parser("list")
    p.add_argument("--role"), p.add_argument("--season"), p.add_argument("--tag"), p.add_argument("--q")
    p.set_defaults(fn=cmd_list)

    p = sub.add_parser("show")
    p.add_argument("id")
    p.set_defaults(fn=cmd_show)

    sub.add_parser("tags").set_defaults(fn=cmd_tags)
    sub.add_parser("template").set_defaults(fn=cmd_template)

    p = sub.add_parser("add")
    p.add_argument("file", help="JSON 文件路径，或者 - 从 stdin 读")
    p.add_argument("--illustrate", action="store_true", help="记完顺手让模型画一张")
    p.set_defaults(fn=cmd_add)

    p = sub.add_parser("log")
    p.add_argument("id")
    p.add_argument("--rating", type=int)
    p.add_argument("--note", default="")
    p.add_argument("--cook", default="")
    p.add_argument("--date")
    p.add_argument("--changed", default="",
                   help="这次动了什么，逗号分开：盐多了,火大了,这次成了")
    p.set_defaults(fn=cmd_log)

    p = sub.add_parser("stock")
    p.add_argument("id")
    p.add_argument("--out", action="store_true", help="标记用完了")
    p.set_defaults(fn=cmd_stock)

    p = sub.add_parser("illustrate")
    p.add_argument("id")
    p.add_argument("--kind", default="recipe", choices=["recipe", "pantry"])
    p.set_defaults(fn=cmd_illustrate)

    args = ap.parse_args()
    args.fn(args)


if __name__ == "__main__":
    main()
