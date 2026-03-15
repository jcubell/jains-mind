#!/usr/bin/env python3
"""Push brain state — writes local state.json and fires background GitHub push.

Architecture:
  1. Write state.json (local server serves it instantly via tunnel)
  2. Background subprocess pushes to GitHub with tunnel URL embedded
     → Dashboard polls tunnel directly (no cache)
     → If tunnel restarts, dashboard falls back to GitHub Pages to get new URL

CLI usage:
  python3 push_brain.py <focus> [thought] [thought_type] [mode] [model] [subagent_json]

  subagent_json: JSON string like:
    '{"name":"Codex","task":"Building feature X","started_at":"2026-03-14T22:00:00Z","eta_seconds":120,"status":"running"}'
  or "clear" to remove active subagent

  model: short model name, e.g. "grok-4", "claude-sonnet-4-6", "gpt-4o"
         pass "" or omit to keep existing model in state
"""
import sys, json, datetime, subprocess, os

STATE_FILE = "/Users/jc_agent/.openclaw/workspace/dashboard/state.json"
PUSH_SCRIPT = "/Users/jc_agent/.openclaw/workspace/dashboard/push_github.py"
URL_FILE    = "/tmp/current-tunnel-url.txt"

def now_et():
    from datetime import timezone, timedelta
    et = timezone(timedelta(hours=-4))
    return datetime.datetime.now(et).strftime("%-I:%M %p ET")

def get_tunnel_url():
    try:
        return open(URL_FILE).read().strip()
    except Exception:
        return None

def push(focus, thought_text=None, thought_type="action", mode="working",
         model=None, subagent=None):
    """
    Push brain state update.

    Args:
        focus: Current focus string (shown large in dashboard)
        thought_text: Optional thought to prepend to stream
        thought_type: "action"|"thought"|"complete"|"observation"
        mode: "working"|"idle"
        model: Model name to display (None = keep existing, "" = keep existing)
        subagent: dict with subagent info, None = keep existing, "clear" = remove
    """
    # Load existing state
    try:
        with open(STATE_FILE) as f:
            state = json.load(f)
    except Exception:
        state = {
            "objective": "",
            "status": "idle",
            "brain": {
                "mode": "idle",
                "focus": "",
                "model": "grok-4",
                "thoughts": [],
                "subagent": None
            },
            "steps": [],
            "updated_at": ""
        }

    if "brain" not in state:
        state["brain"] = {"mode": "idle", "focus": "", "model": "grok-4", "thoughts": [], "subagent": None}

    state["brain"]["focus"] = focus
    state["brain"]["mode"] = mode

    # Update model only if explicitly provided
    if model:
        state["brain"]["model"] = model

    # Handle subagent
    if subagent == "clear":
        state["brain"]["subagent"] = None
    elif subagent is not None:
        state["brain"]["subagent"] = subagent

    if thought_text:
        thoughts = state["brain"].get("thoughts", [])
        thoughts.insert(0, {"time": now_et(), "type": thought_type, "text": thought_text})
        state["brain"]["thoughts"] = thoughts[:12]

    state["updated_at"] = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    # Embed current tunnel URL so GitHub copy enables dashboard self-healing
    tunnel_url = get_tunnel_url()
    if tunnel_url:
        state["_tunnel_url"] = tunnel_url

    # 1. Write local state.json (instant, no network)
    with open(STATE_FILE, "w") as f:
        json.dump(state, f, indent=2, ensure_ascii=True)

    # 2. Fire-and-forget: push to GitHub (background, never blocks response)
    try:
        subprocess.Popen(
            ["/opt/homebrew/bin/python3", PUSH_SCRIPT, STATE_FILE],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            start_new_session=True
        )
    except Exception:
        pass

    print(f"Pushed: {focus}")


def set_subagent(name, task, eta_seconds=None, status="running"):
    """Convenience: mark a subagent as active without changing focus."""
    try:
        with open(STATE_FILE) as f:
            state = json.load(f)
    except Exception:
        return

    state["brain"]["subagent"] = {
        "name": name,
        "task": task,
        "started_at": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "eta_seconds": eta_seconds,
        "status": status
    }
    state["updated_at"] = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    with open(STATE_FILE, "w") as f:
        json.dump(state, f, indent=2, ensure_ascii=True)

    try:
        subprocess.Popen(
            ["/opt/homebrew/bin/python3", PUSH_SCRIPT, STATE_FILE],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            start_new_session=True
        )
    except Exception:
        pass

    print(f"Subagent set: {name} — {task}")


def clear_subagent():
    """Convenience: mark subagent as done/clear."""
    push(focus=None, subagent="clear")


if __name__ == "__main__":
    focus        = sys.argv[1] if len(sys.argv) > 1 else "Idle — awaiting instruction"
    thought      = sys.argv[2] if len(sys.argv) > 2 else None
    thought_type = sys.argv[3] if len(sys.argv) > 3 else "action"
    mode         = sys.argv[4] if len(sys.argv) > 4 else "working"
    model        = sys.argv[5] if len(sys.argv) > 5 else None
    subagent_raw = sys.argv[6] if len(sys.argv) > 6 else None

    subagent = None
    if subagent_raw == "clear":
        subagent = "clear"
    elif subagent_raw:
        try:
            subagent = json.loads(subagent_raw)
        except Exception:
            pass

    push(focus, thought, thought_type, mode, model, subagent)
