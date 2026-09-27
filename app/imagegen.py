"""Illustration generation.

One locked-down art direction (the Ghibli-ish watercolour look) plus a few
interchangeable back ends, so the notebook keeps a single visual voice no
matter which model is available on the NAS:

    LITTLE_CHEF_IMAGE_PROVIDER = ark | openai | sdwebui | none

``none`` still produces something: a locally drawn watercolour-ish SVG plate,
so a brand new recipe is never a grey box.
"""

import base64
import hashlib
import json
import os
import random
import urllib.error
import urllib.request

from . import settings, store

# --------------------------------------------------------------------------- #
# art direction — edit this if you ever want a different house style
# --------------------------------------------------------------------------- #

STYLE_SUFFIX = (
    "Japanese lifestyle magazine food illustration, gentle hand-drawn pencil linework, "
    "watercolour and gouache washes, muted natural palette of cream, sage green, "
    "terracotta and warm grey, cream rice-paper texture, soft afternoon light, "
    "generous negative space, calm minimal composition. "
    "No text, no letters, no labels, no watermark, no people."
)

STYLE_PREFIX = "Studio Ghibli-inspired hand-painted watercolour illustration of"

SEASON_LIGHT = {
    "春": "soft spring morning light, a sprig of green nearby",
    "夏": "bright summer light, a bamboo mat under the dish",
    "秋": "warm low autumn light, long soft shadows",
    "冬": "warm indoor winter light, gentle steam rising",
    "全年": "soft afternoon light",
}

VESSEL_BY_ROLE = {
    "凉菜": "on a shallow blue-rimmed plate",
    "热炒": "in a shallow celadon dish",
    "大菜": "in a generous ceramic bowl on a linen cloth",
    "汤": "in a deep ceramic bowl with a wooden spoon beside it",
    "主食": "in a rice bowl with wooden chopsticks resting on the rim",
    "甜点": "on a small white saucer with a little spoon",
    "小食": "in a tiny dish, a few pieces only",
    "饮": "in a clear glass on a wooden coaster",
}


def build_prompt(entity, kind="recipe"):
    """Turn a recipe / pantry item into a prompt in the house style."""
    if entity.get("image_prompt"):
        subject = entity["image_prompt"].strip()
        return "%s %s %s" % (STYLE_PREFIX, subject.rstrip(". ") + ".", STYLE_SUFFIX)

    name = entity.get("latin") or entity.get("subtitle") or entity.get("title") or entity.get("name") or ""
    zh_name = entity.get("title") or entity.get("name") or ""

    if kind == "pantry":
        bits = ["a single home-kitchen still life of %s (%s)" % (name or zh_name, zh_name)]
        if entity.get("kind") == "seasoning":
            bits.append("one unlabelled bottle or jar on a wooden shelf, a small dish of it poured out beside")
        else:
            bits.append("the raw ingredient on a worn wooden cutting board with a linen cloth")
        return "%s %s. %s" % (STYLE_PREFIX, ", ".join(bits), STYLE_SUFFIX)

    tags = entity.get("tags") or {}
    role = (entity.get("course_role") or ["热炒"])[0]
    season = (tags.get("season") or ["全年"])[0]
    key_items = [i.get("name", "") for i in (entity.get("ingredients") or [])[:3] if i.get("name")]

    detail = "%s (%s)" % (name, zh_name) if name and name != zh_name else zh_name
    parts = [
        "one finished home-cooked dish: %s" % detail,
        VESSEL_BY_ROLE.get(role, "in a simple ceramic dish"),
        ("made with %s" % "、".join(key_items)) if key_items else "",
        SEASON_LIGHT.get(season, "soft afternoon light"),
        "seen slightly from above on a wooden table",
    ]
    subject = ", ".join(p for p in parts if p)
    return "%s %s. %s" % (STYLE_PREFIX, subject, STYLE_SUFFIX)


# --------------------------------------------------------------------------- #
# providers
# --------------------------------------------------------------------------- #


def _post_json(url, payload, headers, timeout=180):
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers=dict({"Content-Type": "application/json"}, **headers),
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _fetch(url, timeout=120):
    with urllib.request.urlopen(url, timeout=timeout) as resp:
        return resp.read()


def _provider_ark(prompt, size):
    """Volcengine Ark / Doubao Seedream — https://www.volcengine.com/docs/82379"""
    key = settings.get("ark_api_key") or ""
    if not key:
        raise RuntimeError("ARK_API_KEY is not set")
    base = (settings.get("ark_base_url") or "").rstrip("/")
    model = settings.get("ark_image_model")
    out = _post_json(
        base + "/images/generations",
        {
            "model": model,
            "prompt": prompt,
            "size": size,
            "response_format": "url",
            "watermark": False,
        },
        {"Authorization": "Bearer " + key},
    )
    return _fetch(out["data"][0]["url"])


def _provider_openai(prompt, size):
    key = settings.get("openai_api_key") or ""
    if not key:
        raise RuntimeError("OPENAI_API_KEY is not set")
    base = (settings.get("openai_base_url") or "").rstrip("/")
    model = settings.get("openai_image_model")
    out = _post_json(
        base + "/images/generations",
        {"model": model, "prompt": prompt, "size": size, "n": 1},
        {"Authorization": "Bearer " + key},
    )
    item = out["data"][0]
    if item.get("b64_json"):
        return base64.b64decode(item["b64_json"])
    return _fetch(item["url"])


def _provider_sdwebui(prompt, size):
    """Any local Stable Diffusion WebUI / Forge on the LAN."""
    base = (settings.get("sd_webui_url") or "").rstrip("/")
    width, height = (int(x) for x in size.split("x"))
    out = _post_json(
        base + "/sdapi/v1/txt2img",
        {
            "prompt": prompt,
            "negative_prompt": settings.get("sd_negative_prompt"),
            "width": min(width, 1024),
            "height": min(height, 1024),
            "steps": int(settings.get("sd_steps") or 28),
            "cfg_scale": float(settings.get("sd_cfg") or 6.5),
            "sampler_name": settings.get("sd_sampler"),
        },
        {},
        timeout=600,
    )
    return base64.b64decode(out["images"][0])


PROVIDERS = {
    "ark": _provider_ark,
    "doubao": _provider_ark,
    "openai": _provider_openai,
    "sdwebui": _provider_sdwebui,
}


def provider_name():
    return (settings.get("image_provider") or "none").strip().lower()


def provider_ready():
    name = provider_name()
    if name in ("ark", "doubao"):
        return bool(settings.get("ark_api_key"))
    if name == "openai":
        return bool(settings.get("openai_api_key"))
    if name == "sdwebui":
        return bool(settings.get("sd_webui_url"))
    return False


# --------------------------------------------------------------------------- #
# offline fallback: a small hand-drawn-feeling SVG plate
# --------------------------------------------------------------------------- #

PALETTES = [
    ("#e2c9a3", "#c1714f", "#7c8f6b"),
    ("#d8d2bd", "#8fa9b8", "#c69a4e"),
    ("#e7d3c1", "#a8563f", "#93a37c"),
    ("#dfd8c4", "#6f8b7b", "#c98f5e"),
]


def _svg_placeholder(entity, kind="recipe"):
    seed = int(hashlib.md5((entity.get("id") or "x").encode("utf-8")).hexdigest()[:8], 16)
    rnd = random.Random(seed)
    warm, accent, leaf = rnd.choice(PALETTES)
    blobs = []
    for i in range(rnd.randint(4, 7)):
        cx = 300 + rnd.randint(-110, 110)
        cy = 240 + rnd.randint(-60, 60)
        r = rnd.randint(34, 72)
        fill = rnd.choice([warm, accent, leaf])
        blobs.append(
            '<ellipse cx="%d" cy="%d" rx="%d" ry="%d" fill="%s" opacity="%.2f" '
            'transform="rotate(%d %d %d)"/>' % (cx, cy, r, int(r * 0.78), fill, rnd.uniform(0.35, 0.6),
                                                rnd.randint(-30, 30), cx, cy)
        )
    return """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 450" width="600" height="450">
  <defs>
    <filter id="grain"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="3"/>
      <feColorMatrix type="saturate" values="0"/><feComponentTransfer><feFuncA type="linear" slope="0.06"/></feComponentTransfer>
      <feComposite operator="in" in2="SourceGraphic"/></filter>
    <filter id="soft"><feGaussianBlur stdDeviation="6"/></filter>
  </defs>
  <rect width="600" height="450" fill="#faf6ec"/>
  <g filter="url(#soft)">%s</g>
  <ellipse cx="300" cy="250" rx="170" ry="120" fill="none" stroke="#3a362f" stroke-opacity="0.35" stroke-width="2"/>
  <ellipse cx="300" cy="250" rx="150" ry="103" fill="none" stroke="#3a362f" stroke-opacity="0.16" stroke-width="1"/>
  <path d="M120 372 C 240 356, 360 356, 480 372" stroke="#3a362f" stroke-opacity="0.2" stroke-width="1.5" fill="none"/>
  <rect width="600" height="450" filter="url(#grain)" fill="#000"/>
</svg>""" % "".join(blobs)


# --------------------------------------------------------------------------- #
# public entry point
# --------------------------------------------------------------------------- #


def generate(entity, kind="recipe", size=None, prompt=None):
    """Draw an illustration for a recipe or pantry item.

    Returns ``(filename, prompt, provider)``. The file lands in ``data/images``.
    """
    store.ensure_dirs()
    prompt = prompt or build_prompt(entity, kind)
    size = size or settings.get("image_size") or "1328x992"
    name = provider_name()
    fn = PROVIDERS.get(name)

    if fn and provider_ready():
        try:
            blob = fn(prompt, size)
            filename = "%s-%s-%s.jpg" % (kind, entity["id"], store.stamp())
            path = store.data_path("images", filename)
            with open(path, "wb") as fh:
                fh.write(blob)
            return filename, prompt, name
        except (urllib.error.URLError, urllib.error.HTTPError, KeyError, RuntimeError, OSError, ValueError) as exc:
            print("[imagegen] %s failed (%s) — falling back to a drawn plate" % (name, exc))

    filename = "%s-%s-%s.svg" % (kind, entity["id"], store.stamp())
    with open(store.data_path("images", filename), "w", encoding="utf-8") as fh:
        fh.write(_svg_placeholder(entity, kind))
    return filename, prompt, "placeholder"
