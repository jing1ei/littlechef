"""littlechef — a small self-hosted family recipe notebook.

Runs as one container on a NAS: FastAPI serves the JSON API, the static
front end and the illustrations. All state is plain files under ``data/``.
"""

import os
import base64
import binascii
import threading
import urllib.error

from fastapi import Body, FastAPI, File, Form, Header, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles

from . import imagegen, settings, store, photoai, validation

APP_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT_DIR = os.path.dirname(APP_DIR)
WEB_DIR = os.path.join(ROOT_DIR, "web")

# 门牌 / 权限 都走 settings，随 UI 一改立刻生效，不用重启容器
def _edit_pin() -> str:
    return (settings.get("edit_pin") or "").strip()


def _read_only() -> bool:
    return bool(settings.get("read_only"))


def _house_name() -> str:
    return settings.get("house_name") or "littlechef"


def _house_subtitle() -> str:
    return settings.get("house_subtitle") or "家庭菜谱"


# 后端认识的三种资源：任何一处漏了改一处都会静默失败，所以只在这里写一次
WRITABLE_COLLECTIONS = ("recipes", "pantry", "menus")

app = FastAPI(title=_house_name(), docs_url="/api/docs", redoc_url=None)


@app.exception_handler(ValueError)
def invalid_data(_request, exc):
    return JSONResponse(status_code=400, content={"detail": "数据格式或文件状态不合法，请检查输入并保留原文件备份"})

_image_lock = threading.Semaphore(2)  # a NAS should not fire ten generations at once
# Fixed lock stripes cannot be evicted while a caller is waiting to acquire one.
_item_locks = [threading.RLock() for _ in range(256)]


def _item_lock(collection: str, item_id: str):
    return _item_locks[hash((collection, item_id)) % len(_item_locks)]


# --------------------------------------------------------------------------- #
# helpers
# --------------------------------------------------------------------------- #


def config_payload():
    return {
        "house_name": _house_name(),
        "house_subtitle": _house_subtitle(),
        "read_only": _read_only(),
        "pin_required": bool(_edit_pin()),
        "image_provider": imagegen.provider_name(),
        "image_ready": imagegen.provider_ready(),
        "photo_analysis_ready": photoai.ready("vision"),
        "photo_edit_ready": photoai.ready("photo_edit"),
        "mode": "server",
    }


def guard_write(pin):
    if _read_only():
        raise HTTPException(status_code=403, detail="这本菜谱现在是只读的（设置里能改回来）")
    edit_pin = _edit_pin()
    if edit_pin and (pin or "") != edit_pin:
        raise HTTPException(status_code=401, detail="需要正确的编辑密码")


def clean_id(collection, item, fallback):
    item_id = item.get("id")
    if item_id:
        try:
            return store._safe_id(item_id)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="id 不合法") from exc
    seed = item.get("slug") or item.get("latin") or item.get("subtitle") or item.get("title") or item.get("name")
    return store.slugify(seed, fallback) + "-" + store.stamp()


def validate_item(collection, item):
    try:
        validation.item(collection, item)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


def save_photo_assets(payload):
    assets = payload.pop("photo_assets", None)
    if assets is None:
        return
    if not isinstance(assets, dict) or assets.get("selected", "original") not in ("original", "illustration"):
        raise HTTPException(status_code=400, detail="照片选择不合法")
    try:
        original = photoai.decode_photo(assets.get("original"))
        illustration = photoai.decode_photo(assets["illustration"]) if assets.get("illustration") else None
        if assets.get("selected") == "illustration" and illustration is None:
            raise ValueError("请先生成手绘图")
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    written = []
    try:
        for field, raw in (("original_image", original), ("illustration_image", illustration)):
            if raw is not None:
                filename = "photo-" + store.stamp() + ".jpg"
                path = store.data_path("images", filename)
                written.append(path)
                with open(path, "wb") as fh:
                    fh.write(raw)
                payload[field] = filename
            else:
                payload.pop(field, None)
    except OSError:
        for path in written:
            if os.path.exists(path): os.unlink(path)
        raise
    use_drawing = assets.get("selected") == "illustration"
    payload["image"] = payload["illustration_image" if use_drawing else "original_image"]
    payload["image_provider"] = "photo-handdrawn" if use_drawing else "photo"


def save_with_photos(collection, payload, existing):
    replacing = bool(payload.get("photo_assets"))
    save_photo_assets(payload)
    try:
        saved = store.save_item(collection, payload)
    except OSError:
        if replacing:
            for field in ("original_image", "illustration_image"):
                store.retire_image(payload.get(field))
        raise
    if replacing:
        for filename in store._collect_image_files(existing):
            store.retire_image(filename)
    return saved


@app.post("/api/photos/{action}")
def photo_assist(action: str, file: UploadFile = File(...), kind: str = Form("recipe"),
                 x_kitchen_pin: str = Header(default="")):
    guard_write(x_kitchen_pin)
    if action not in ("analyze", "stylize") or kind not in ("recipe", "pantry"):
        raise HTTPException(status_code=400, detail="不支持的照片操作")
    try:
        raw = photoai.normalize_photo(file.file.read(photoai.MAX_PHOTO + 1))
        if not _image_lock.acquire(blocking=False):
            raise HTTPException(status_code=429, detail="照片服务正在忙，请稍后重试")
        try:
            return photoai.analyze(raw, kind) if action == "analyze" else {"image": photoai.stylize(raw)}
        finally:
            _image_lock.release()
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except (urllib.error.URLError, TimeoutError, KeyError, IndexError, TypeError, OSError) as exc:
        # Never return provider response bodies or credentials to the browser.
        raise HTTPException(status_code=502, detail="照片服务暂时不可用，请检查模型配置后重试；原图仍可保存") from exc


# --------------------------------------------------------------------------- #
# api
# --------------------------------------------------------------------------- #


@app.get("/api/health")
def health():
    return {"ok": True, "data_dir": store.DATA_DIR}


@app.get("/api/bootstrap")
def bootstrap():
    store.ensure_dirs()
    return store.bootstrap(config_payload())


@app.get("/api/recipes")
def recipes():
    return store.list_items("recipes")


@app.get("/api/recipes/{recipe_id}")
def recipe(recipe_id: str):
    item = store.get_item("recipes", recipe_id)
    if not item:
        raise HTTPException(status_code=404, detail="没有这道菜")
    return item


@app.post("/api/recipes")
def save_recipe(payload: dict = Body(...), x_kitchen_pin: str = Header(default="")):
    guard_write(x_kitchen_pin)
    validate_item("recipes", payload)
    payload = dict(payload or {})
    payload["id"] = clean_id("recipes", payload, "recipe")
    payload.setdefault("tags", {})
    payload.setdefault("course_role", [])
    payload.setdefault("ingredients", [])
    payload.setdefault("seasonings", [])
    payload.setdefault("steps", [])
    payload.setdefault("log", [])
    # Serialize edits to the same recipe so image-generation / logging /
    # rename can't overwrite each other's changes. Full-object writes still
    # win over partial merges — same behaviour as before, just consistent.
    with _item_lock("recipes", payload["id"]):
        existing = store.get_item("recipes", payload["id"])
        if existing and not payload.get("log"):
            payload["log"] = existing.get("log", [])
        # Preserve image state if the client didn't send it back (some forms don't)
        if existing:
            for k in ("image", "original_image", "illustration_image", "image_prompt_used", "image_provider"):
                if k not in payload and k in existing:
                    payload[k] = existing[k]
        item = save_with_photos("recipes", payload, existing)
    with _item_lock("_meta", "taxonomy"):
        store.merge_new_tags(item)
    return item


@app.delete("/api/recipes/{recipe_id}")
def drop_recipe(recipe_id: str, x_kitchen_pin: str = Header(default="")):
    guard_write(x_kitchen_pin)
    with _item_lock("recipes", recipe_id):
        if not store.delete_item("recipes", recipe_id):
            raise HTTPException(status_code=404, detail="没有这道菜")
    return {"ok": True}


@app.post("/api/recipes/{recipe_id}/log")
def add_log(recipe_id: str, payload: dict = Body(...), x_kitchen_pin: str = Header(default="")):
    """记一笔：今天做了、改了什么、下次怎么办。"""
    guard_write(x_kitchen_pin)
    try:
        validation.log(payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    with _item_lock("recipes", recipe_id):
        item = store.get_item("recipes", recipe_id)
        if not item:
            raise HTTPException(status_code=404, detail="没有这道菜")
        entry = {
            "date": (payload.get("date") or store.today()),
            "rating": payload.get("rating"),
            "note": (payload.get("note") or "").strip(),
            "cook": payload.get("cook") or "",
            # 这次动了什么（盐多了/火大了/换了材料…）。一句话没时间写的时候，点这个也算记录。
            "changed": [str(x) for x in (payload.get("changed") or [])],
        }
        item.setdefault("log", []).insert(0, entry)
        item["last_cooked"] = max([e.get("date", "") for e in item["log"]] or [""])
        return store.save_item("recipes", item)


@app.get("/api/pantry")
def pantry():
    return store.list_items("pantry")


@app.post("/api/pantry")
def save_pantry(payload: dict = Body(...), x_kitchen_pin: str = Header(default="")):
    guard_write(x_kitchen_pin)
    validate_item("pantry", payload)
    payload = dict(payload or {})
    payload["id"] = clean_id("pantry", payload, "pantry")
    payload.setdefault("kind", "ingredient")
    payload.setdefault("tags", [])
    payload.setdefault("log", [])
    with _item_lock("pantry", payload["id"]):
        existing = store.get_item("pantry", payload["id"])
        if existing:
            for k in ("image", "original_image", "illustration_image", "image_prompt_used", "image_provider"):
                if k not in payload and k in existing:
                    payload[k] = existing[k]
        return save_with_photos("pantry", payload, existing)


@app.delete("/api/pantry/{item_id}")
def drop_pantry(item_id: str, x_kitchen_pin: str = Header(default="")):
    guard_write(x_kitchen_pin)
    with _item_lock("pantry", item_id):
        if not store.delete_item("pantry", item_id):
            raise HTTPException(status_code=404, detail="柜子里没有这个")
    return {"ok": True}


@app.post("/api/pantry/{item_id}/stock")
def set_stock(item_id: str, payload: dict = Body(...), x_kitchen_pin: str = Header(default="")):
    guard_write(x_kitchen_pin)
    if not isinstance(payload.get("in_stock"), bool):
        raise HTTPException(status_code=400, detail="in_stock 必须是布尔值")
    with _item_lock("pantry", item_id):
        item = store.get_item("pantry", item_id)
        if not item:
            raise HTTPException(status_code=404, detail="柜子里没有这个")
        item["in_stock"] = bool(payload.get("in_stock"))
        item["stock_checked"] = store.today()
        return store.save_item("pantry", item)


@app.get("/api/menus")
def menus():
    return sorted(store.list_items("menus"), key=lambda m: m.get("date", ""), reverse=True)


@app.post("/api/menus")
def save_menu(payload: dict = Body(...), x_kitchen_pin: str = Header(default="")):
    guard_write(x_kitchen_pin)
    validate_item("menus", payload)
    payload = dict(payload or {})
    payload["id"] = clean_id("menus", payload, "menu")
    payload.setdefault("date", store.today())
    with _item_lock("menus", payload["id"]):
        return store.save_item("menus", payload)


@app.delete("/api/menus/{menu_id}")
def drop_menu(menu_id: str, x_kitchen_pin: str = Header(default="")):
    guard_write(x_kitchen_pin)
    with _item_lock("menus", menu_id):
        if not store.delete_item("menus", menu_id):
            raise HTTPException(status_code=404, detail="没有这份菜单")
    return {"ok": True}


@app.post("/api/taxonomy")
def save_taxonomy(payload: dict = Body(...), x_kitchen_pin: str = Header(default="")):
    guard_write(x_kitchen_pin)
    try:
        validation.taxonomy(payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not payload.get("facets"):
        raise HTTPException(status_code=400, detail="facets 不能为空")
    with _item_lock("_meta", "taxonomy"):
        store.write_json(store.DEFAULT_TAXONOMY_PATH, payload)
    return payload


@app.post("/api/images/generate")
def make_image(payload: dict = Body(...), x_kitchen_pin: str = Header(default="")):
    """给一道菜或一样食材画张插画，风格由 imagegen.STYLE_SUFFIX 统一锁定。"""
    guard_write(x_kitchen_pin)
    kind = payload.get("kind") or "recipe"
    collection = "recipes" if kind == "recipe" else "pantry"
    item_id = payload.get("id")
    item = store.get_item(collection, item_id) if item_id else None
    if not item:
        raise HTTPException(status_code=404, detail="找不到要配图的对象")
    if payload.get("image_prompt"):
        item["image_prompt"] = payload["image_prompt"]

    # Per-item lock keeps a concurrent title edit / log entry from clobbering the
    # image field. Semaphore separately caps parallelism across all items so a
    # NAS with a tiny CPU doesn't try to render five at once.
    lock = _item_lock(collection, item["id"])
    if not lock.acquire(blocking=False):
        raise HTTPException(status_code=429, detail="这道菜正在生成，请稍等再试")
    try:
        with _image_lock:
            filename, prompt, provider = imagegen.generate(item, kind, prompt=payload.get("prompt"))
        # Re-read to avoid overwriting concurrent edits to other fields.
        fresh = store.get_item(collection, item["id"]) or item
        old_image = fresh.get("image")
        fresh["image"] = filename
        fresh["image_prompt_used"] = prompt
        fresh["image_provider"] = provider
        if payload.get("image_prompt"):
            fresh["image_prompt"] = payload["image_prompt"]
        store.save_item(collection, fresh)
        # Filenames sometimes change (svg placeholder → jpg from a real model,
        # or user-uploaded photo replaced by a regenerated illustration) —
        # sweep the old file into .trash so images/ doesn't accumulate orphans.
        if old_image and old_image != filename:
            store.retire_image(old_image)
        return {"image": filename, "prompt": prompt, "provider": provider, "item": fresh}
    finally:
        lock.release()


@app.post("/api/images/upload")
def upload_image(
    file: UploadFile = File(...),
    id: str = Form(...),
    kind: str = Form("recipe"),
    x_kitchen_pin: str = Header(default=""),
):
    """拍一张真的。手机上按住相机就完事，比让模型画更像自家的菜。"""
    guard_write(x_kitchen_pin)
    collection = "recipes" if kind == "recipe" else "pantry"
    ext = ".jpg"
    blob = file.file.read(12 * 1024 * 1024 + 1)
    if not blob:
        raise HTTPException(status_code=400, detail="照片是空的")
    if len(blob) > 12 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="照片太大了，先压一下")

    try:
        blob = photoai.normalize_photo(blob)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    with _item_lock(collection, id):
        item = store.get_item(collection, id)
        if not item:
            raise HTTPException(status_code=404, detail="找不到要配图的对象")
        filename = f"{store.slugify(id, 'photo')}-{store.stamp()}{ext}"
        with open(store.data_path("images", filename), "wb") as fh:
            fh.write(blob)
        old_image = item.get("image")
        item["image"] = filename
        item["original_image"] = filename
        item["image_provider"] = "photo"
        item.pop("image_prompt_used", None)
        store.save_item(collection, item)
        if old_image and old_image != filename:
            store.retire_image(old_image)
    return {"image": filename, "item": item}


@app.get("/api/images/preview-prompt")
def preview_prompt(id: str = Query(...), kind: str = Query("recipe")):
    collection = "recipes" if kind == "recipe" else "pantry"
    item = store.get_item(collection, id)
    if not item:
        raise HTTPException(status_code=404, detail="找不到对象")
    return {"prompt": imagegen.build_prompt(item, kind)}


@app.get("/api/export")
def export_all():
    """一份完整快照，方便备份或搬家。"""
    payload = store.bootstrap(config_payload())
    payload["little_chef"] = 1
    payload["kitchen_notes"] = 1  # Legacy bundle reader compatibility.
    payload["images"] = {}
    for name in os.listdir(store.data_path("images")):
        path = store.data_path("images", name)
        if os.path.isfile(path) and not name.startswith("."):
            with open(path, "rb") as fh:
                payload["images"][name] = "data:application/octet-stream;base64," + base64.b64encode(fh.read()).decode("ascii")
    return JSONResponse(payload)


@app.post("/api/import")
def import_all(payload: dict = Body(...), x_kitchen_pin: str = Header(default="")):
    guard_write(x_kitchen_pin)
    # 覆盖前先给 data/ 拍一份完整快照，扔到 .trash/import-YYYYMMDD-HHMMSS/。
    # 导错了包、id 撞车、结构不对，都能从这里手工捞回来 —— 从来没有第二种备份。
    # Validate the complete request before changing any notebook files.
    for collection in WRITABLE_COLLECTIONS:
        if not isinstance(payload.get(collection, []), list):
            raise HTTPException(status_code=400, detail=collection + " 必须是列表")
        for item in payload.get(collection, []):
            if isinstance(item, dict):
                validate_item(collection, item)
    tax = payload.get("taxonomy")
    if tax is not None:
        try:
            validation.taxonomy(tax)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
    images = payload.get("images", {})
    if not isinstance(images, dict):
        raise HTTPException(status_code=400, detail="images 必须是对象")
    decoded = {}
    for name, data in images.items():
        if (not isinstance(name, str) or name != os.path.basename(name)
                or name.startswith(".") or "/" in name or "\\" in name):
            raise HTTPException(status_code=400, detail="图片文件名不合法")
        try:
            if not isinstance(data, str) or not data.startswith("data:") or ";base64," not in data:
                raise ValueError("invalid image")
            decoded[name] = base64.b64decode(data.split(",", 1)[1], validate=True)
        except (ValueError, binascii.Error) as exc:
            raise HTTPException(status_code=400, detail="图片编码不合法") from exc
    snapshot = store.snapshot_bucket("import")
    for name, raw in decoded.items():
        with open(store.data_path("images", name), "wb") as fh:
            fh.write(raw)
    counts = {}
    skipped = 0
    for collection in WRITABLE_COLLECTIONS:
        got = 0
        for item in (payload.get(collection) or []):
            if not (isinstance(item, dict) and item.get("id")):
                skipped += 1
                continue
            try:
                store.save_item(collection, item)
                got += 1
            except ValueError:
                # 导入包里带了 ../ 之类的怪 id：跳过，别把坏东西写进 data/
                skipped += 1
        counts[collection] = got
    if tax and tax.get("facets"):
        store.write_json(store.DEFAULT_TAXONOMY_PATH, payload["taxonomy"])
    return {
        "ok": True,
        "imported": counts,
        "skipped": skipped,
        "snapshot": os.path.relpath(snapshot, store.DATA_DIR) if snapshot else None,
    }


# --------------------------------------------------------------------------- #
# settings — editable from the web UI, persisted to data/settings.json
# --------------------------------------------------------------------------- #


@app.get("/api/settings")
def get_settings():
    """Return the full editable schema. Secrets come back masked."""
    return {"settings": settings.snapshot(redact=True), "config": config_payload()}


@app.post("/api/settings")
def update_settings(payload: dict = Body(...), x_kitchen_pin: str = Header(default="")):
    """Write new settings. Requires the current edit PIN if one is set.

    On success the config takes effect immediately (all reads go through the
    settings module), and we return the fresh redacted snapshot + config so
    the UI can refresh the header/badge without a reload.
    """
    # Read-only mode should still let the household turn read-only *off*,
    # otherwise the checkbox becomes a one-way door. So we don't call
    # guard_write here; instead we check the PIN directly.
    edit_pin = _edit_pin()
    if edit_pin and (x_kitchen_pin or "") != edit_pin:
        raise HTTPException(status_code=401, detail="需要正确的编辑密码")

    patch = payload.get("patch") if isinstance(payload, dict) and "patch" in payload else payload
    if not isinstance(patch, dict):
        raise HTTPException(status_code=400, detail="patch 必须是对象")

    try:
        result = settings.update(patch)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {
        "ok": True,
        "changed": result["changed"],
        "settings": result["settings"],
        "config": config_payload(),
    }


# --------------------------------------------------------------------------- #
# static: illustrations + front end
# --------------------------------------------------------------------------- #


@app.get("/img/{filename}")
def image(filename: str):
    safe = os.path.basename(filename)
    path = store.data_path("images", safe)
    if os.path.islink(path) or not os.path.isfile(path):
        raise HTTPException(status_code=404, detail="没有这张图")
    # 短缓存也允许手动替换图片后及时刷新。
    return FileResponse(path, headers={"Cache-Control": "public, max-age=120"})


@app.get("/")
def index():
    return RedirectResponse("/app/")


store.seed_if_empty()
app.mount("/app", StaticFiles(directory=WEB_DIR, html=True), name="web")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "app.main:app",
        host=os.environ.get("LITTLE_CHEF_HOST", "0.0.0.0"),
        port=int(os.environ.get("LITTLE_CHEF_PORT", "8848")),
        reload=False,
    )
