"""Runtime settings, editable from the web UI.

Every value follows the same lookup chain::

    data/settings.json overlay  →  process env var  →  hard-coded default

The overlay is a small JSON file the app writes to when a human clicks "save"
in the settings sheet, so the container never needs a restart to pick up a
new API key or a new house name. Env vars still work for people who prefer to
bake configuration into docker-compose / systemd; the overlay simply wins
when both are present. Set an overlay value to ``null`` to fall back to the
env default (that's how the UI's "clear" button works).

Nothing here writes to ``os.environ``: readers call ``get(...)`` directly so
a change is visible on the very next request, and secrets never linger in
subprocess env after the settings file is rewritten.
"""

import json
import math
import os
import threading
from typing import Any

from . import store

_SETTINGS_PATH = os.path.join(store.DATA_DIR, "settings.json")
_lock = threading.RLock()
_overlay: dict[str, Any] = {}
_loaded = False


# Every editable setting: (key, env var, default, kind).
# kind ∈ {"text", "int", "float", "bool", "secret", "enum"} — used by the API
# to coerce input from the frontend and to redact secrets on read.
SCHEMA: list[dict[str, Any]] = [
    # 门牌
    {"key": "house_name", "env": "LITTLE_CHEF_HOUSE_NAME", "default": "littlechef", "kind": "text"},
    {"key": "house_subtitle", "env": "LITTLE_CHEF_HOUSE_SUBTITLE", "default": "家庭菜谱", "kind": "text"},
    # 权限
    {"key": "edit_pin", "env": "LITTLE_CHEF_EDIT_PIN", "default": "", "kind": "secret"},
    {"key": "read_only", "env": "LITTLE_CHEF_READ_ONLY", "default": False, "kind": "bool"},
    # 出图
    {"key": "image_provider", "env": "LITTLE_CHEF_IMAGE_PROVIDER", "default": "none",
     "kind": "enum", "options": ["none", "ark", "openai", "sdwebui"]},
    {"key": "image_size", "env": "LITTLE_CHEF_IMAGE_SIZE", "default": "1328x992", "kind": "text"},
    # 火山 / 豆包
    {"key": "ark_api_key", "env": "ARK_API_KEY", "default": "", "kind": "secret"},
    {"key": "ark_image_model", "env": "ARK_IMAGE_MODEL",
     "default": "doubao-seedream-3-0-t2i-250415", "kind": "text"},
    {"key": "ark_base_url", "env": "ARK_BASE_URL",
     "default": "https://ark.cn-beijing.volces.com/api/v3", "kind": "text"},
    # OpenAI / 兼容
    {"key": "openai_api_key", "env": "OPENAI_API_KEY", "default": "", "kind": "secret"},
    {"key": "openai_image_model", "env": "OPENAI_IMAGE_MODEL", "default": "gpt-image-1", "kind": "text"},
    {"key": "openai_base_url", "env": "OPENAI_BASE_URL", "default": "https://api.openai.com/v1", "kind": "text"},
    # Photo understanding and reference-image edits use independently configured models.
    {"key": "vision_base_url", "env": "LITTLE_CHEF_VISION_BASE_URL", "default": "https://api.openai.com/v1", "kind": "text"},
    {"key": "vision_api_key", "env": "LITTLE_CHEF_VISION_API_KEY", "default": "", "kind": "secret"},
    {"key": "vision_model", "env": "LITTLE_CHEF_VISION_MODEL", "default": "", "kind": "text"},
    {"key": "photo_edit_base_url", "env": "LITTLE_CHEF_PHOTO_EDIT_BASE_URL", "default": "https://api.openai.com/v1", "kind": "text"},
    {"key": "photo_edit_api_key", "env": "LITTLE_CHEF_PHOTO_EDIT_API_KEY", "default": "", "kind": "secret"},
    {"key": "photo_edit_model", "env": "LITTLE_CHEF_PHOTO_EDIT_MODEL", "default": "gpt-image-1", "kind": "text"},
    # 本地 SD
    {"key": "sd_webui_url", "env": "SD_WEBUI_URL", "default": "http://127.0.0.1:7860", "kind": "text"},
    {"key": "sd_steps", "env": "SD_STEPS", "default": 28, "kind": "int"},
    {"key": "sd_cfg", "env": "SD_CFG", "default": 6.5, "kind": "float"},
    {"key": "sd_sampler", "env": "SD_SAMPLER", "default": "DPM++ 2M", "kind": "text"},
    {"key": "sd_negative_prompt", "env": "SD_NEGATIVE_PROMPT",
     "default": "text, watermark, signature, people, photo, 3d render, oversaturated", "kind": "text"},
]

_BY_KEY = {s["key"]: s for s in SCHEMA}


def _coerce(kind: str, value: Any) -> Any:
    if value is None:
        return None
    if kind == "bool":
        if isinstance(value, bool):
            return value
        return str(value).strip().lower() in ("1", "true", "yes", "on")
    if kind == "int":
        try:
            return int(str(value).strip())
        except (TypeError, ValueError):
            return None
    if kind == "float":
        try:
            return float(str(value).strip())
        except (TypeError, ValueError):
            return None
    return str(value)


def _load():
    """Read the overlay file once. Called lazily so tests can point DATA_DIR wherever they like."""
    global _loaded, _overlay, _SETTINGS_PATH
    _SETTINGS_PATH = os.path.join(store.DATA_DIR, "settings.json")
    if not os.path.exists(_SETTINGS_PATH):
        _overlay = {}
        _loaded = True
        return
    try:
        with open(_SETTINGS_PATH, "r", encoding="utf-8") as fh:
            data = json.load(fh) or {}
    except (OSError, ValueError) as exc:
        print("[settings] could not read %s (%s), starting empty" % (_SETTINGS_PATH, exc))
        data = {}
    # Ignore keys we don't know about — schema owns the vocabulary.
    _overlay = {k: v for k, v in data.items() if k in _BY_KEY} if isinstance(data, dict) else {}
    _loaded = True


def _ensure_loaded():
    if not _loaded:
        with _lock:
            if not _loaded:
                _load()


def get(key: str) -> Any:
    """Overlay > env > default. Returns coerced to the declared kind."""
    _ensure_loaded()
    spec = _BY_KEY.get(key)
    if not spec:
        return None
    with _lock:
        if key in _overlay and _overlay[key] is not None:
            return _coerce(spec["kind"], _overlay[key])
    env_val = os.environ.get(spec["env"])
    if env_val is not None and env_val != "":
        return _coerce(spec["kind"], env_val)
    return spec["default"]


def source(key: str) -> str:
    """Where the current value is coming from — helps the UI say 'this comes from the env, not the file'."""
    _ensure_loaded()
    spec = _BY_KEY.get(key)
    if not spec:
        return "unknown"
    with _lock:
        if key in _overlay and _overlay[key] is not None:
            return "file"
    env_val = os.environ.get(spec["env"])
    if env_val is not None and env_val != "":
        return "env"
    return "default"


def _write_overlay(data: dict[str, Any]):
    store.ensure_dirs()
    path = _SETTINGS_PATH
    store.write_json(path, data)  # atomic replacement; temporary file starts with mode 0600


def update(patch: dict[str, Any]) -> dict[str, Any]:
    """Merge a partial update into the overlay and persist it.

    - Missing keys are ignored (schema owns the vocabulary).
    - Explicit ``None`` clears the overlay for that key (falls back to env/default).
    - An empty string keeps the key in the overlay as an explicit empty value —
      this is how the UI turns off an ``edit_pin`` or a ``read_only`` flag that
      was originally set via env, since an env var only wins when the overlay
      has no key at all.
    - Secret fields: the sentinel value ``"__unchanged__"`` means "leave alone",
      so the UI can echo back the redacted mask without wiping the key.
    """
    _ensure_loaded()
    changed = []
    with _lock:
        new = dict(_overlay)
        for key, raw in (patch or {}).items():
            spec = _BY_KEY.get(key)
            if not spec:
                continue
            if spec["kind"] == "secret" and raw == "__unchanged__":
                continue
            if raw is None:
                # Explicit reset: fall back to env / default.
                if key in new:
                    del new[key]
                    changed.append(key)
                continue
            if spec["kind"] == "bool" and not isinstance(raw, bool) and str(raw).lower() not in ("0", "1", "true", "false", "yes", "no", "on", "off"):
                raise ValueError(key + " 必须是布尔值")
            if spec["kind"] in ("text", "secret", "enum") and not isinstance(raw, str):
                raise ValueError(key + " 必须是文字")
            coerced = _coerce(spec["kind"], raw)
            if coerced is None or (isinstance(coerced, float) and not math.isfinite(coerced)):
                raise ValueError(key + " 数值无效")
            if spec["kind"] == "enum" and coerced not in spec["options"]:
                raise ValueError(key + " 选项无效")
            if key == "sd_steps" and not 1 <= coerced <= 150:
                raise ValueError("sd_steps 必须在 1 到 150 之间")
            if key == "sd_cfg" and not 0 <= coerced <= 30:
                raise ValueError("sd_cfg 必须在 0 到 30 之间")
            # Empty string / False / 0 are all valid *overrides* — they stay in
            # the overlay so env-var defaults don't leak back in.
            if new.get(key) != coerced or key not in new:
                new[key] = coerced
                if coerced != _overlay.get(key):
                    changed.append(key)
        _write_overlay(new)
        _overlay.clear()
        _overlay.update(new)
    return {"changed": changed, "settings": snapshot()}


def snapshot(redact: bool = True) -> dict[str, Any]:
    """A UI-friendly view: current values (with secrets masked), plus provenance."""
    _ensure_loaded()
    out = {}
    for spec in SCHEMA:
        key = spec["key"]
        raw = get(key)
        src = source(key)
        if spec["kind"] == "secret" and redact and raw:
            display = "•" * min(8, len(str(raw)))
            has_value = True
        else:
            display = raw
            has_value = bool(raw) if spec["kind"] == "secret" else None
        entry = {
            "key": key,
            "kind": spec["kind"],
            "source": src,
            "value": display,
            "default": spec["default"],
        }
        if "options" in spec:
            entry["options"] = spec["options"]
        if spec["kind"] == "secret":
            entry["has_value"] = has_value
        out[key] = entry
    return out


def clear_overlay():
    """Test-only: reset the in-memory cache so a fresh DATA_DIR is picked up."""
    global _loaded
    with _lock:
        _overlay.clear()
        _loaded = False
