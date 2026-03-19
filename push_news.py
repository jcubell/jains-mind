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

    # Prepend new item, trim to MAX_ITEMS
    feed = state.get("news_feed", [])
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
