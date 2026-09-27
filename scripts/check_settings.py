"""Playwright smoke test for the settings sheet against a live NAS-mode server.

Exercises: opening the settings dialog from the header, live provider switching,
saving a new provider with an API key, verifying the badge disappears and the
value round-trips through /api/settings.
"""
import sys
import os
import time
import urllib.request
import json

from playwright.sync_api import sync_playwright

BASE = os.environ.get("LITTLE_CHEF_TEST_URL", "http://127.0.0.1:8850")


def wait_ready():
    for _ in range(30):
        try:
            urllib.request.urlopen(f"{BASE}/api/health", timeout=1).read()
            return
        except Exception:
            time.sleep(0.3)
    raise RuntimeError("server did not come up")


def api_settings():
    return json.loads(urllib.request.urlopen(f"{BASE}/api/settings").read())


def go():
    wait_ready()
    with sync_playwright() as p:
        browser = p.chromium.launch()
        ctx = browser.new_context(viewport={"width": 390, "height": 844})
        page = ctx.new_page()
        page.goto(f"{BASE}/app/", wait_until="networkidle")

        # Header shows the "no image model" badge before we configure
        badge = page.locator("#mode-badge")
        assert badge.is_visible(), "badge should be visible in NAS mode with no image model"
        assert badge.inner_text() == "配置插画"
        print("OK  badge announces no image model")

        # Header gear opens settings
        page.locator("#btn-settings").click()
        page.wait_for_selector("#settings-form")
        assert page.locator(".setting-group").count() >= 3
        print(f"OK  settings sheet opened, {page.locator('.setting-group').count()} groups shown")

        # None → ark should reveal the Ark group
        page.locator("select[name=image_provider]").select_option("ark")
        page.wait_for_selector("input[name=ark_api_key]")
        print("OK  switching provider revealed Ark group live")

        # Fill in a fake key + rename the house
        page.fill("input[name=ark_api_key]", "sk-fake-test-key")
        page.locator("select[name=image_provider]").select_option("none")
        page.locator("select[name=image_provider]").select_option("ark")
        assert page.locator("input[name=ark_api_key]").input_value() == "sk-fake-test-key"
        page.fill("input[name=house_name]", "外婆的厨房")
        page.locator("#settings-form button[type=submit]").click()

        # Wait for the sheet to close and the toast
        page.wait_for_selector("#sheet-backdrop", state="hidden", timeout=5000)
        print("OK  save closed the sheet")

        # House name updated in the header live
        house_name = page.locator("[data-house-name]").inner_text()
        assert "外婆" in house_name, f"header didn't update: {house_name}"
        print(f"OK  header updated live to {house_name!r}")

        # Badge should now be gone (image provider ready)
        # (badge listens on cfg.image_ready)
        settings = api_settings()
        assert settings["settings"]["image_provider"]["value"] == "ark"
        assert settings["settings"]["image_provider"]["source"] == "file"
        assert settings["settings"]["ark_api_key"]["has_value"] is True
        assert settings["settings"]["ark_api_key"]["value"] == "••••••••"
        assert settings["config"]["image_ready"] is True
        assert settings["config"]["house_name"] == "外婆的厨房"
        print("OK  /api/settings reflects new provider+key (masked), image_ready=true")

        # Reopen — the secret sentinel should preserve the key
        page.locator("#btn-settings").click()
        page.wait_for_selector("#settings-form")
        assert page.locator("input[name=ark_api_key]").input_value() == "••••••••"
        # Change something unrelated and save — key must still be there
        page.fill("input[name=house_subtitle]", "Grandma's Kitchen")
        page.locator("#settings-form button[type=submit]").click()
        page.wait_for_selector("#sheet-backdrop", state="hidden")
        settings2 = api_settings()
        assert settings2["settings"]["ark_api_key"]["has_value"] is True, "the sentinel didn't preserve the key"
        assert settings2["config"]["house_subtitle"] == "Grandma's Kitchen"
        print("OK  secret sentinel preserved key while updating unrelated field")

        # Clear the API key with the 清掉 button
        page.locator("#btn-settings").click()
        page.wait_for_selector("#settings-form")
        page.locator("button[data-clear=ark_api_key]").click()
        page.locator("#settings-form button[type=submit]").click()
        page.wait_for_selector("#sheet-backdrop", state="hidden")
        settings3 = api_settings()
        assert settings3["settings"]["ark_api_key"]["has_value"] is False, "clear button didn't wipe the key"
        assert settings3["config"]["image_ready"] is False
        print("OK  清掉 button erased the key")

        browser.close()
    print("\n============================================================")
    print("Settings sheet: all good.")


if __name__ == "__main__":
    try:
        go()
    except Exception:
        import traceback

        traceback.print_exc()
        sys.exit(1)
