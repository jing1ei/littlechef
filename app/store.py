"""File-backed store for the family kitchen notebook.

Everything lives as plain JSON on disk so the whole notebook stays readable,
diff-able and easy to back up (just copy the ``data/`` folder off the NAS).

Layout::

    data/
      taxonomy.json        facets + tag vocabulary
      recipes/<id>.json    one file per recipe
      pantry/<id>.json     one file per ingredient / seasoning
      menus/<id>.json      saved course sets
      images/<file>        illustrations
"""

import json
import os
import re
import shutil
import tempfile
import uuid
import unicodedata
from datetime import datetime, timezone

DATA_DIR = os.environ.get("LITTLE_CHEF_DATA_DIR") or os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data"
)

SEED_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "seed")

COLLECTIONS = {
    "recipes": "recipes",
    "pantry": "pantry",
    "menus": "menus",
}


def now_iso():
    return datetime.now(timezone.utc).astimezone().strftime("%Y-%m-%dT%H:%M:%S%z")


def today():
    return datetime.now().strftime("%Y-%m-%d")


def data_path(*parts):
    return os.path.join(DATA_DIR, *parts)


def ensure_dirs():
    for sub in list(COLLECTIONS.values()) + ["images"]:
        os.makedirs(data_path(sub), exist_ok=True)


# --------------------------------------------------------------------------- #
# ids
# --------------------------------------------------------------------------- #

_PINYIN_SAFE = re.compile(r"[^a-z0-9]+")


def slugify(text, fallback="item"):
    """Latin slug when possible, otherwise a short timestamp-ish id.

    Chinese titles are common here, so we keep a readable ascii part when the
    caller supplied one and fall back to a stable short id.
    """
    text = (text or "").strip()
    ascii_part = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode("ascii").lower()
    slug = _PINYIN_SAFE.sub("-", ascii_part).strip("-")
    if not slug:
        slug = "%s-%s" % (fallback, stamp())
    return slug[:60]


def stamp():
    """Random suffix to avoid collisions between concurrent uploads."""
    return uuid.uuid4().hex[:16]


_ID_OK = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$")


def _safe_id(item_id):
    """URL / import 里进来的 id 只允许字母数字和 -_ .，从源头挡住 `../`。

    做 slug 的时候我们自己发的 id 都符合这一条；防的是 `DELETE /api/recipes/..%2Fpantry%2Fx`
    这种能跨集合甚至跨目录抹东西的形状。
    """
    if not isinstance(item_id, str):
        raise ValueError("bad id")
    trimmed = item_id.strip()
    if not trimmed or not _ID_OK.match(trimmed) or ".." in trimmed:
        raise ValueError("bad id")
    return trimmed


def unique_id(collection, candidate):
    folder = COLLECTIONS[collection]
    base = candidate
    n = 2
    while os.path.exists(data_path(folder, base + ".json")):
        base = "%s-%d" % (candidate, n)
        n += 1
    return base


# --------------------------------------------------------------------------- #
# read / write
# --------------------------------------------------------------------------- #


def read_json(path, default=None):
    try:
        with open(path, "r", encoding="utf-8") as fh:
            return json.load(fh)
    except FileNotFoundError:
        return default
    except (ValueError, OSError) as exc:  # keep one broken file from killing the app
        print("[store] skipping %s: %s" % (path, exc))
        return default


def write_json(path, payload):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=".write-", dir=os.path.dirname(path))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump(payload, fh, ensure_ascii=False, indent=2, sort_keys=False, allow_nan=False)
            fh.write("\n")
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


def list_items(collection):
    folder = data_path(COLLECTIONS[collection])
    if not os.path.isdir(folder):
        return []
    items = []
    for name in sorted(os.listdir(folder)):
        if not name.endswith(".json") or name.startswith("."):
            continue
        if os.path.islink(os.path.join(folder, name)):
            continue
        item = read_json(os.path.join(folder, name))
        if isinstance(item, dict):
            item.setdefault("id", name[:-5])
            items.append(item)
    return items


def get_item(collection, item_id):
    try:
        safe = _safe_id(item_id)
    except ValueError:
        return None
    path = data_path(COLLECTIONS[collection], "%s.json" % safe)
    if os.path.islink(path):
        raise ValueError("记录文件不能是符号链接")
    return read_json(path)


def save_item(collection, item):
    item_id = _safe_id(item.get("id") or "")
    item["id"] = item_id
    existing = get_item(collection, item_id) or {}
    if not isinstance(existing, dict):
        raise ValueError("现有记录格式异常，请先恢复备份")
    if existing.get("id") and existing["id"] != item_id:
        raise ValueError("文件系统上的 id 大小写冲突，请使用不同的 id")
    item.setdefault("created", existing.get("created") or now_iso())
    item["updated"] = now_iso()
    write_json(data_path(COLLECTIONS[collection], "%s.json" % item_id), item)
    return item


def _safe_move(src, dst):
    """Move a file into the trash bucket. Falls back to copy+unlink across devices."""
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    try:
        os.replace(src, dst)                        # same filesystem: atomic
    except OSError:
        shutil.move(src, dst)                       # cross-device: copy + unlink


def _trash_stamp():
    """Sub-second precision so back-to-back delete/import in the same wall-clock
    second don't clobber each other's trash bucket. Microseconds are plenty for
    a family NAS."""
    return datetime.now().strftime("%Y%m%d-%H%M%S-%f")


def retire_image(filename):
    """Move an orphaned illustration/photo into ``.trash/images/`` so replacing
    a recipe photo doesn't leak files under ``data/images/``. Best-effort — a
    missing file is fine (already gone)."""
    if not filename or not isinstance(filename, str) or image_referenced(filename):
        return
    safe = os.path.basename(filename)
    src = data_path("images", safe)
    if not os.path.exists(src):
        return
    dst = data_path(".trash", "images", "%s-%s" % (_trash_stamp(), safe))
    try:
        _safe_move(src, dst)
    except OSError as exc:
        print("[store] could not retire image %s: %s" % (safe, exc))


def _collect_image_files(item):
    """Files under data/images/ that this item is holding onto."""
    files = set()
    for field in ("image", "original_image", "illustration_image"):
        image = (item or {}).get(field)
        if image and isinstance(image, str):
            files.add(os.path.basename(image))
    # 兼容将来给日志加上照片的场景
    for entry in (item or {}).get("log", []) or []:
        for key in ("image", "photo"):
            val = entry.get(key) if isinstance(entry, dict) else None
            if val and isinstance(val, str):
                files.add(os.path.basename(val))
    return files


def image_referenced(filename):
    return any(filename in _collect_image_files(item)
               for collection in COLLECTIONS for item in list_items(collection))


def delete_item(collection, item_id):
    try:
        item_id = _safe_id(item_id)
    except ValueError:
        return False
    path = data_path(COLLECTIONS[collection], "%s.json" % item_id)
    if not os.path.exists(path):
        return False
    stamp_suffix = "%s-%s" % (item_id, _trash_stamp())
    trash_root = data_path(".trash", COLLECTIONS[collection])
    _safe_move(path, os.path.join(trash_root, "%s.json" % stamp_suffix))

    # 删了菜谱/柜里的东西，附带的插画和照片也跟着搬进 .trash：
    # 一是不留孤儿文件挤满 data/images，二是新东西复用了 id 时不会误继承旧图。
    item = read_json(os.path.join(trash_root, "%s.json" % stamp_suffix)) or {}
    trash_images = data_path(".trash", "images", stamp_suffix)
    for name in _collect_image_files(item):
        src = data_path("images", name)
        if os.path.isfile(src) and not image_referenced(name):
            _safe_move(src, os.path.join(trash_images, name))
    return True


def snapshot_bucket(label):
    """Copy the whole data folder into .trash/<label>/ so an import or bulk op is undoable.

    Returns the snapshot root path, or None if there was nothing to snapshot.
    """
    ensure_dirs()
    label = "%s-%s" % (label, _trash_stamp())
    dest = data_path(".trash", label)
    copied_any = False
    for sub in list(COLLECTIONS.values()) + ["taxonomy.json", "images"]:
        src = data_path(sub)
        if not os.path.exists(src):
            continue
        target = os.path.join(dest, sub)
        if os.path.isdir(src):
            shutil.copytree(src, target, dirs_exist_ok=True)
        else:
            os.makedirs(os.path.dirname(target), exist_ok=True)
            shutil.copy2(src, target)
        copied_any = True
    return dest if copied_any else None


# --------------------------------------------------------------------------- #
# taxonomy
# --------------------------------------------------------------------------- #

DEFAULT_TAXONOMY_PATH = data_path("taxonomy.json")


def taxonomy():
    tax = read_json(DEFAULT_TAXONOMY_PATH)
    if tax is None:
        seed = read_json(os.path.join(SEED_DIR, "notebook.json"), {}) or {}
        tax = seed.get("taxonomy")
        if tax:
            write_json(DEFAULT_TAXONOMY_PATH, tax)
    if not tax:
        raise RuntimeError("data/taxonomy.json is missing and seed/notebook.json has no taxonomy")
    return tax


def known_tags():
    """Flat map of facet -> set(values) from the taxonomy file."""
    out = {}
    for facet in taxonomy().get("facets", []):
        out[facet["key"]] = [v["name"] for v in facet.get("values", [])]
    return out


def merge_new_tags(recipe):
    """Any tag the user invents on the fly is appended to the taxonomy.

    Keeps the tag system open ended without losing the curated ordering.
    """
    tax = taxonomy()
    changed = False
    by_key = {f["key"]: f for f in tax.get("facets", [])}
    for key, values in (recipe.get("tags") or {}).items():
        facet = by_key.get(key)
        if not facet:
            continue
        existing = {v["name"] for v in facet.get("values", [])}
        for value in values or []:
            if value and value not in existing:
                facet.setdefault("values", []).append({"name": value})
                existing.add(value)
                changed = True
    if changed:
        write_json(DEFAULT_TAXONOMY_PATH, tax)
    return changed


# --------------------------------------------------------------------------- #
# first boot
# --------------------------------------------------------------------------- #


def seed_if_empty():
    """A brand new NAS volume gets the starter notebook, then never again.

    The initialization marker survives deletion of every recipe.
    """
    ensure_dirs()
    seed_file = os.path.join(SEED_DIR, "notebook.json")
    marker = data_path(".initialized")
    if os.path.exists(marker):
        return False
    # Existing notebooks, including an intentionally emptied one, are never reseeded.
    if (any(os.listdir(data_path(c)) for c in COLLECTIONS)
            or os.path.exists(DEFAULT_TAXONOMY_PATH) or os.path.isdir(data_path(".trash"))):
        write_json(marker, {"initialized": now_iso()})
        return False
    if not os.path.exists(seed_file):
        write_json(DEFAULT_TAXONOMY_PATH, {"facets": [], "course_roles": [], "menu_templates": []})
        write_json(marker, {"initialized": now_iso()})
        return False

    nb = read_json(seed_file) or {}
    if nb.get("taxonomy") and not os.path.exists(DEFAULT_TAXONOMY_PATH):
        write_json(DEFAULT_TAXONOMY_PATH, nb["taxonomy"])
    for collection in COLLECTIONS.keys():
        for item in nb.get(collection) or []:
            if isinstance(item, dict) and item.get("id"):
                save_item(collection, item)

    seed_images = os.path.join(SEED_DIR, "images")
    if os.path.isdir(seed_images):
        for name in os.listdir(seed_images):
            target = data_path("images", name)
            if not os.path.exists(target):
                shutil.copy2(os.path.join(seed_images, name), target)
    write_json(marker, {"initialized": now_iso()})
    print("[store] seeded a fresh notebook into %s" % DATA_DIR)
    return True


# --------------------------------------------------------------------------- #
# bootstrap payload
# --------------------------------------------------------------------------- #


def bootstrap(config=None):
    return {
        "taxonomy": taxonomy(),
        "recipes": list_items("recipes"),
        "pantry": list_items("pantry"),
        "menus": sorted(list_items("menus"), key=lambda m: m.get("date", ""), reverse=True),
        "config": config or {},
        "generated": now_iso(),
    }
