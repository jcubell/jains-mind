#!/usr/bin/env python3
"""
push_news.py — Push a news bot brief to state.json and then to GitHub.

Usage: python3 push_news.py <slot_name> <brief_text>

Example:
  python3 push_news.py morning_brief "Good morning! Here are today's top stories..."
"""

import sys
import json
import os
import subprocess
import time
import hashlib
from datetime import datetime, timezone

STATE_PATH = os.path.join(os.path.dirname(__file__), 'state.json')
PUSH_GITHUB = os.path.join(os.path.dirname(__file__), 'push_github.py')
MAX_ITEMS = 20

SLOT_LABELS = {
    "morning_brief": "Morning Brief",
    "markets_open": "Signal Update",
    "mid_morning": "Signal Update",
    "afternoon_pulse": "Signal Update",
    "markets_close": "Signal Update",
    "evening_update": "Daily Recap",
    "daily_recap": "Daily Recap",
    "breaking_now": "Breaking Now",
    "breaking": "Breaking Now",
}

def main():
    if len(sys.argv) < 3:
        print("Usage: python3 push_news.py <slot_name> <brief_text>", file=sys.stderr)
        sys.exit(1)

    slot = sys.argv[1]
    brief_text = sys.argv[2]

    now_utc = datetime.now(timezone.utc)
    ts_iso = now_utc.strftime("%Y-%m-%dT%H:%M:%SZ")
    epoch = int(time.time())
    item_id = f"{slot}_{epoch}"
    label = SLOT_LABELS.get(slot, slot.replace("_", " ").title())

    new_item = {
        "id": item_id,
        "slot": slot,
        "ts": ts_iso,
        "label": label,
        "text": brief_text,
    }

    # Read existing state.json
    try:
        with open(STATE_PATH, "r") as f:
            state = json.load(f)
    except Exception as e:
        print(f"⚠️ Could not read state.json: {e}", file=sys.stderr)
        state = {}

    # Normalize slot using content header (handles '--send' or ad-hoc invocations)
    def detect_slot_from_text(text, fallback_slot):
        t = text[:200].upper()
        if "MORNING BRIEF" in t:
            return "morning_brief"
        if "MARKETS OPEN" in t:
            return "markets_open"
        if "MID MORNING" in t:
            return "mid_morning"
        if "AFTERNOON PULSE" in t:
            return "afternoon_pulse"
        if "MARKETS CLOSE" in t:
            return "markets_close"
        if "EVENING UPDATE" in t or "DAILY RECAP" in t:
            return "evening_update"
        if "BREAKING" in t[:50]:
            return "breaking_now"
        return fallback_slot

    canonical_slot = detect_slot_from_text(brief_text, slot)

    # Content hash for deduplication — uses canonical_slot + first 100 chars of text
    # (100 chars covers header+date which is unique per slot per day, not per run)
    content_sig = hashlib.md5((canonical_slot + brief_text[:100]).encode()).hexdigest()[:12]

    # Dedupe: skip if same canonical_slot+content-header seen within the last 4 hours
    feed = state.get("news_feed", [])
    FOUR_HOURS = 4 * 3600
    for existing in feed:
        existing_canonical = detect_slot_from_text(existing.get("text", ""), existing.get("slot", ""))
        existing_sig = hashlib.md5(
            (existing_canonical + existing.get("text", "")[:100]).encode()
        ).hexdigest()[:12]
        if existing_sig == content_sig:
            try:
                existing_epoch = int(
                    datetime.strptime(existing["ts"], "%Y-%m-%dT%H:%M:%SZ")
                    .replace(tzinfo=timezone.utc).timestamp()
                )
            except Exception:
                existing_epoch = 0
            age_secs = epoch - existing_epoch
            if age_secs < FOUR_HOURS:
                print(f"⏭️  Skipping duplicate {slot} (same content seen {age_secs}s ago, sig={content_sig})")
                sys.exit(0)

    # Prepend new item, trim to MAX_ITEMS
    feed.insert(0, new_item)
    feed = feed[:MAX_ITEMS]
    state["news_feed"] = feed

    # Write back to state.json
    try:
        with open(STATE_PATH, "w") as f:
            json.dump(state, f, indent=2)
        print(f"✅ state.json updated — news_feed has {len(feed)} item(s)")
    except Exception as e:
        print(f"❌ Failed to write state.json: {e}", file=sys.stderr)
        sys.exit(1)

    # Push to GitHub
    try:
        result = subprocess.run(
            [sys.executable, PUSH_GITHUB],
            timeout=60,
            capture_output=True,
            text=True,
        )
        if result.returncode == 0:
            print("✅ Pushed to GitHub")
        else:
            print(f"⚠️ push_github.py exited {result.returncode}: {result.stderr.strip()}", file=sys.stderr)
    except Exception as e:
        print(f"⚠️ push_github.py failed: {e}", file=sys.stderr)


if __name__ == "__main__":
    main()
