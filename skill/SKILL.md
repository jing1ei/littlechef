---
name: littlechef
description: 往家里 NAS 上那本菜谱（littlechef）记菜、记食材、记「这次做得怎么样」。当用户说"把这道菜记进菜谱"、"我今天做了 X，记一笔"、"XX 用完了"、"菜谱里有什么凉菜"、"给这道菜画张插画"，或者贴来一段别处的菜谱要求整理进家里的本子时使用。需要能访问littlechef 服务（LITTLE_CHEF_URL）。不负责排菜单——排一桌菜在网页上点「排一桌」，那里能看到时间表和采购清单。
---

# littlechef

这本菜谱跑在家里的 NAS 上，网页地址通常是 `http://<NAS的IP>:8848`。
本技能是它的命令行入口：把聊天里说的菜，变成菜谱本里一条结构完整、标签齐全的记录。

## 先确认能连上

```bash
export LITTLE_CHEF_URL=http://192.168.1.8:8848     # 换成自己家的
export LITTLE_CHEF_PIN=1234                        # 只有设了编辑口令才需要
python3 scripts/littlechef_cli.py ping
```

连不上就直接告诉用户「NAS 上的菜谱没开 / 地址不对」，不要自己造一份本地菜谱糊过去。

## 记一道菜（最常见的任务）

**顺序很重要**：先看现有标签，再写 JSON，最后提交。

```bash
python3 scripts/littlechef_cli.py tags          # 1. 看现在有哪些标签和上菜角色
python3 scripts/littlechef_cli.py template      # 2. 拿一个空骨架
# 3. 写成 /tmp/x.json
python3 scripts/littlechef_cli.py add /tmp/x.json --illustrate
```

写 JSON 的时候守住这几条，否则记进去的菜在排菜单时是「哑」的：

- `course_role` 必填，从 小食 / 凉菜 / 热炒 / 大菜 / 汤 / 主食 / 甜点 / 饮 里选。一道菜可以有多个角色。
- `tags` 十个维度尽量都填：occasion / cuisine / main / method / flavor / season / station / traits / diet / status。
  **station（灶台/烤箱/蒸锅/免火）和 make_ahead 直接决定排菜单时会不会撞车**，别省。
- `time.prep` 和 `time.cook` 填实数，耗时标签是自动算的。
- **步骤里把火候、时间、温度写进正文**：「中火煎 3 分钟」「转小火焖 40 分钟」「烤箱 180℃ 25 分钟」。
  网页的下厨模式会从这句话里认出来，直接变成一个能点的计时器；写成「煎一会儿」就什么都没有。
- 用量按 `名字 | 用量 | 备注` 写最稳（`900g`、`2 汤匙`、`3 根`、`适量` 都认）。
  用量写成能算的数，排菜单折算人数和合并采购清单才准；「一点点」这种只能原样带过去。
- `steps[].tip` 是这本菜谱最值钱的地方：写「为什么这么做」和「容易翻车在哪」，不要复述步骤。
- `seasonings[].pantry` 填调味料的 id（`shengchou`、`shaoxingjiu` 之类），填了之后采购清单才知道家里有没有。
  不确定就先 `list` 或看网页上的「食材与调味」。
- `status`：用户没做过就是 `想试`，做过还在调是 `在试`，稳定了是 `成了`。别默认写 `成了`。

从别处（截图、链接、聊天记录）整理菜谱时：原文里没有的量和火候**不要编**，
写进 `notes` 说明「原方没写，第一次做按 X 试」，或者干脆留空。

## 做完了记一笔

```bash
python3 scripts/littlechef_cli.py log hongshaorou --rating 4 \
  --changed "糖多了,这次成了" \
  --note "冰糖一次全下了，最后有点过甜，下次分两次" --cook 我
```

`--changed` 是几个短标签（盐多了 / 盐少了 / 火大了 / 火小了 / 时间长了 / 时间短了 / 换了材料 / 改了比例 / 这次成了），
网页上是点一下就有的小按钮，这里逗号分开写。只想记「今天做了」的话，`log <id>` 什么都不带也行。

这条记录会更新「上次做的时间」，排菜单时最近做过的菜会自动往后排。

## 把用户拍的照片换上去

用户给了实拍照片、想替掉 AI 插画：

```bash
curl -s -X POST "$LITTLE_CHEF_URL/api/images/upload" \
  -H "X-Kitchen-Pin: $LITTLE_CHEF_PIN" \
  -F kind=recipe -F id=hongshaorou -F file=@/tmp/hongshaorou.jpg
```

实拍照永远优先于插画。已经有实拍照的菜，别再顺手 `--illustrate` 盖回去。

## 其他

```bash
python3 scripts/littlechef_cli.py list --role 凉菜 --season 夏     # 查
python3 scripts/littlechef_cli.py show hongshaorou                # 看全文
python3 scripts/littlechef_cli.py stock shaoxingjiu --out         # 黄酒用完了
python3 scripts/littlechef_cli.py illustrate hongshaorou          # 让模型画一张
```

插画的画风在服务端锁死了（Ghibli 感的水彩），这里不用也不要另写风格提示词，
除非用户明确要求某道菜画成别的样子——那时在菜谱的 `image_prompt` 字段里写主体描述即可，画风依旧统一。

## 边界

- 排一桌菜（course set）、时间表、采购清单在网页的「排一桌」页面，不在这个 CLI 里。要给用户网页链接。
- 下厨模式、计时器、拍照都是网页上的事（手机打开菜谱页最上面那条按钮），CLI 只管往本子里写。
- 有人拿着导出的静态版在外面记菜，那些改动存在他自己的浏览器里，要靠 `scripts/merge_export.py` 并回 NAS，
  CLI 看不到它们。
- 删菜谱要先问一遍，删掉的东西进 `data/.trash`，能捞回来但要人上 NAS 找。
