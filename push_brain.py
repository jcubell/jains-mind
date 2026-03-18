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
        state["brain"]["currentModel"] = model
    elif mode not in ("working", "thinking"):
        # When transitioning to idle without specifying a model,
        # clear whisper model so it doesn't persist as the active theme.
        current = state["brain"].get("model", "")
        if current and "whisper" in current.lower():
            state["brain"]["model"] = "grok-4"
            state["brain"]["currentModel"] = "grok-4"

    # Handle subagent (legacy single) and subagents (array)
    if subagent == "clear":
        state["brain"]["subagent"] = None
        state["brain"]["subagents"] = []
    elif subagent is not None:
        state["brain"]["subagent"] = subagent

    if thought_text:
        thoughts = state["brain"].get("thoughts", [])
        entry = {"time": now_et(), "type": thought_type, "text": thought_text}
        # Store focus as title so dashboard can render step headline + detail
        if focus:
            entry["title"] = focus
        thoughts.insert(0, entry)
        state["brain"]["thoughts"] = thoughts[:12]

    state["updated_at"] = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    # Embed current tunnel URL so GitHub copy enables dashboard self-healing
    tunnel_url = get_tunnel_url()
    if tunnel_url:
        state["_tunnel_url"] = tunnel_url

    # 1. Write local state.json (instant, no network)
    with open(STATE_FILE, "w") as f:
        json.dump(state, f, indent=2, ensure_ascii=True)

    # 1b. Append to rolling model usage log (accurate per-model breakdown for dashboard)
    if model:
        try:
            log_file = os.path.join(os.path.dirname(STATE_FILE), "model_usage_log.json")
            from datetime import timezone, timedelta
            et = timezone(timedelta(hours=-4))
            today_str = datetime.datetime.now(et).strftime("%Y-%m-%d")
            log = {}
            if os.path.exists(log_file):
                try:
                    with open(log_file) as lf:
                        log = json.load(lf)
                except Exception:
                    log = {}
            if today_str not in log:
                log[today_str] = {}
            # Normalize model name to canonical dashboard key
            norm = model.lower().replace("openrouter/", "")
            if "/" in norm:
                norm = norm.split("/")[-1]
            norm_map = {
                "claude-sonnet-4.6":    "claude-sonnet-4-6",
                "claude-sonnet-4-5":    "claude-sonnet-4-6",
                "claude-sonnet-4-6":    "claude-sonnet-4-6",
                "gemini-2.0-flash-001": "gemini-2.0-flash",
                "gemini-2.0-flash":     "gemini-2.0-flash",
                "gemini-2.5-pro":       "gemini-2.5-pro",
                "grok-4":               "grok-4",
                "grok-4-fast":          "grok-4-fast",
                "grok-4.1-fast":        "grok-4-fast",
                "deepseek-chat-v3-0324":"deepseek-chat-v3-0324",
                "deepseek-r1":          "deepseek-r1",
                "gpt-4o":               "gpt-4o",
                "gpt-4o-mini":          "gpt-4o-mini",
            }
            canon = norm_map.get(norm, norm)
            if canon and canon != "whisper":
                log[today_str][canon] = log[today_str].get(canon, 0) + 1
            # Keep only last 7 days
            sorted_days = sorted(log.keys(), reverse=True)
            log = {d: log[d] for d in sorted_days[:7]}
            with open(log_file, "w") as lf:
                json.dump(log, lf, indent=2)
        except Exception:
            pass  # never block push_brain for logging errors

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
    import argparse

    # --reset-baseline: snapshot current OR usage as new session zero-point
    if '--reset-baseline' in sys.argv:
        import urllib.request, datetime
        BASELINE_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'cost_baseline.json')
        OR_KEY_FILE = os.path.expanduser('~/.secrets/openrouter_api_key.txt')
        try:
            or_key = open(OR_KEY_FILE).read().strip()
            req = urllib.request.Request(
                'https://openrouter.ai/api/v1/auth/key',
                headers={'Authorization': f'Bearer {or_key}'}
            )
            with urllib.request.urlopen(req, timeout=10) as r:
                d = json.loads(r.read()).get('data', {})
            baseline = {
                'captured_at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
                'usage_daily':        d.get('usage_daily', 0),
                'usage_weekly':       d.get('usage_weekly', 0),
                'usage_monthly':      d.get('usage_monthly', 0),
                'byok_usage_daily':   d.get('byok_usage_daily', 0),
                'byok_usage_weekly':  d.get('byok_usage_weekly', 0),
                'byok_usage_monthly': d.get('byok_usage_monthly', 0),
                'total_daily':        d.get('usage_daily', 0) + d.get('byok_usage_daily', 0),
                'total_monthly':      d.get('usage_monthly', 0) + d.get('byok_usage_monthly', 0),
            }
            with open(BASELINE_FILE, 'w') as f:
                json.dump(baseline, f, indent=2)
            print(f"Baseline reset — daily was ${baseline['total_daily']:.4f}")
        except Exception as e:
            print(f"Baseline reset ERROR: {e}")
        sys.exit(0)

    # Support both legacy positional args and new --flag style
    # If first arg starts with "--" or no positional args given, use argparse
    use_flags = len(sys.argv) > 1 and (sys.argv[1].startswith('--') or '--current-model' in sys.argv or '--subagents' in sys.argv)

    if use_flags:
        parser = argparse.ArgumentParser(description='Push brain state to dashboard')
        parser.add_argument('focus', nargs='?', default='Idle — awaiting instruction')
        parser.add_argument('thought', nargs='?', default=None)
        parser.add_argument('thought_type', nargs='?', default='action')
        parser.add_argument('mode', nargs='?', default='working')
        parser.add_argument('--model', default=None, help='Current model short name')
        parser.add_argument('--current-model', dest='current_model', default=None,
                            help='Current model to highlight (stored as currentModel in state)')
        parser.add_argument('--subagents', default=None,
                            help='JSON array of active subagents, e.g. \'[{"model":"sonnet","task":"coding"}]\'')
        args = parser.parse_args()
        focus        = args.focus
        thought      = args.thought
        thought_type = args.thought_type
        mode         = args.mode
        model        = args.current_model or args.model

        subagents_raw = args.subagents
        subagents = None
        if subagents_raw == 'clear':
            subagents = 'clear'
        elif subagents_raw:
            try:
                subagents = json.loads(subagents_raw)
            except Exception:
                pass

        # Push with subagents support
        try:
            with open(STATE_FILE) as f:
                state = json.load(f)
        except Exception:
            state = {"objective": "", "status": "idle", "brain": {"mode": "idle", "focus": "", "model": "grok-4", "thoughts": [], "subagent": None}, "steps": [], "updated_at": ""}
        if "brain" not in state:
            state["brain"] = {"mode": "idle", "focus": "", "model": "grok-4", "thoughts": [], "subagent": None}

        state["brain"]["focus"] = focus
        state["brain"]["mode"] = mode
        if model:
            state["brain"]["model"] = model
            state["brain"]["currentModel"] = model
        if subagents == 'clear':
            state["brain"]["subagents"] = []
        elif subagents is not None:
            state["brain"]["subagents"] = subagents

        if thought:
            from datetime import timezone, timedelta
            et = timezone(timedelta(hours=-4))
            t_str = datetime.datetime.now(et).strftime("%-I:%M %p ET")
            thoughts = state["brain"].get("thoughts", [])
            entry = {"time": t_str, "type": thought_type, "text": thought}
            # Store focus as title so dashboard can render step headline + detail
            if focus:
                entry["title"] = focus
            thoughts.insert(0, entry)
            state["brain"]["thoughts"] = thoughts[:12]

        state["updated_at"] = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        try:
            url = open("/tmp/current-tunnel-url.txt").read().strip()
            if url: state["_tunnel_url"] = url
        except Exception:
            pass

        with open(STATE_FILE, "w") as f:
            json.dump(state, f, indent=2, ensure_ascii=True)
        try:
            subprocess.Popen(["/opt/homebrew/bin/python3", PUSH_SCRIPT, STATE_FILE],
                             stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
        except Exception:
            pass
        print(f"Pushed: {focus}")
    else:
        # Legacy positional args
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
