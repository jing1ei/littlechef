"""服务端那一侧的冒烟测试：记一笔带标记、拍照上传、图片能取回来。

在一份临时数据上跑（从 seed/ 长出来的），绝不碰你家 data/ 里的真菜谱 ——
测试把某道菜的插画换成一张 1x1 的测试图，这种事只能发生在临时目录里。

    python3 scripts/smoke_server.py
"""

import io
from PIL import Image
import os
import sys
import tempfile

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, HERE)

# 必须在 import app.* 之前定下数据目录
TMP = tempfile.mkdtemp(prefix="kitchen-smoke-")
os.environ["LITTLE_CHEF_DATA_DIR"] = TMP

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402

c = TestClient(app)
print("临时数据目录：", TMP)

r = c.get("/api/bootstrap")
cfg = r.json()["config"]
print("bootstrap", r.status_code, cfg["mode"], "read_only=%s" % cfg["read_only"],
      len(r.json()["recipes"]), "道")

rid = r.json()["recipes"][0]["id"]

r2 = c.post("/api/recipes/%s/log" % rid,
            json={"date": "2026-09-14", "rating": 4, "note": "", "cook": "我",
                  "changed": ["火大了", "这次成了"]})
entry = r2.json()["log"][0]
print("记一笔", r2.status_code, entry)
assert entry["changed"] == ["火大了", "这次成了"], "「这次动了什么」没存下来"

# 一张最小的 png，当作手机拍的
buffer = io.BytesIO()
Image.new('RGB', (2, 2), 'white').save(buffer, format='PNG')
png = buffer.getvalue()
r3 = c.post("/api/images/upload",
            files={"file": ("dish.png", png, "image/png")},
            data={"id": rid, "kind": "recipe"})
print("拍一张", r3.status_code, r3.json().get("image") if r3.status_code == 200 else r3.text[:300])
assert r3.status_code == 200, "照片没传上去"

name = r3.json()["image"]
assert c.get("/img/" + name).status_code == 200, "传上去的照片取不回来"
again = c.get("/api/recipes/%s" % rid).json()
assert again.get("image") == name and again.get("image_provider") == "photo"
print("图能取回来，菜谱上也记住了，来源标成 photo")

print("\n都过了。临时数据在 %s，看完可以删。" % TMP)
