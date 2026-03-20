#!/usr/bin/env python3
"""Background worker: push brain_state.json AND patch index.html tunnel URL.

Called by push_brain.py in a detached subprocess.

On every brain push:
1. Updates brain_state.json with current state + _tunnel_url
2. Patches index.html to hardcode current tunnel URL (so page loads instantly with no bootstrap lag)

This means tunnel URL in GitHub Pages stays current. If tunnel restarts,
the next push_brain call automatically fixes the dashboard.
"""
import sys, json, base64, urllib.request, re, time, os, datetime

REPO = "jcubell/jains-mind"
STATE_BRANCH = "master"   # state.json lives on master — GitHub Pages serves from here
INDEX_BRANCH = "main"     # index.html edits land on main first, then synced to master
BRANCH = STATE_BRANCH     # legacy compat
STATE_FILE_PATH = "state.json"
INDEX_FILE_PATH = "index.html"
URL_FILE = "/tmp/current-tunnel-url.txt"

def get_tunnel_url(arg_url=None):
    if arg_url:
        return arg_url
    try:
        return open(URL_FILE).read().strip()
    except Exception:
        return None

def github_get(token, path, branch=None):
    """Fetch a file from GitHub, return (content_str, sha)."""
    ref = branch or STATE_BRANCH
    req = urllib.request.Request(
        f"https://api.github.com/repos/{REPO}/contents/{path}?ref={ref}",
        headers={"Authorization": f"token {token}", "Accept": "application/vnd.github.v3+json"}
    )
    with urllib.request.urlopen(req) as r:
        d = json.loads(r.read())
        return base64.b64decode(d['content']).decode('utf-8'), d['sha']

def github_put(token, path, sha, content_str, message):
    """Push a file to GitHub. Retries once on 409 conflict."""
    def _put(sha_to_use):
        payload = {
            "message": message,
            "branch": BRANCH,
            "content": base64.b64encode(content_str.encode("utf-8")).decode("ascii"),
            "sha": sha_to_use
        }
        req = urllib.request.Request(
            f"https://api.github.com/repos/{REPO}/contents/{path}",
            data=json.dumps(payload).encode(),
            headers={"Authorization": f"token {token}", "Content-Type": "application/json"},
            method="PUT"
        )
        with urllib.request.urlopen(req) as r:
            return json.loads(r.read())

    try:
        return _put(sha)
    except urllib.error.HTTPError as he:
        if he.code == 409:
            time.sleep(1)
            _, fresh_sha = github_get(token, path)
            return _put(fresh_sha)
        raise

def push_to_github(state_file, tunnel_url=None):
    try:
        TOKEN = open("/Users/jc_agent/.secrets/github_token.txt").read().strip()
        tunnel = get_tunnel_url(tunnel_url)

        # ── 1. Push brain_state.json ─────────────────────────────────────────
        with open(state_file) as f:
            state = json.load(f)
        if tunnel:
            state["_tunnel_url"] = tunnel

        # Merge news_feed from remote so push_brain calls don't wipe it
        merged_news_feed = False
        try:
            remote_raw, state_sha = github_get(TOKEN, STATE_FILE_PATH, branch=STATE_BRANCH)
            remote_state = json.loads(remote_raw)
            if remote_state.get("news_feed") and not state.get("news_feed"):
                state["news_feed"] = remote_state["news_feed"]
                merged_news_feed = True
        except Exception:
            state_sha = None

        state_content = json.dumps(state, indent=2, ensure_ascii=True)

        # Write merged state back to local disk so tunnel serves correct news_feed data
        # (push_github.py is the only place where remote news_feed is merged into local state)
        if merged_news_feed:
            try:
                with open(state_file, "w") as f:
                    f.write(state_content)
            except Exception:
                pass

        # Push state.json to master (no Vercel build triggered)
        def github_put_branch(token, path, sha, content_str, message, branch):
            def _put(sha_to_use):
                payload = {
                    "message": message,
                    "branch": branch,
                    "content": base64.b64encode(content_str.encode("utf-8")).decode("ascii"),
                    "sha": sha_to_use
                }
                req = urllib.request.Request(
                    f"https://api.github.com/repos/{REPO}/contents/{path}",
                    data=json.dumps(payload).encode(),
                    headers={"Authorization": f"token {token}", "Content-Type": "application/json"},
                    method="PUT"
                )
                with urllib.request.urlopen(req) as r:
                    return json.loads(r.read())
            try:
                return _put(sha)
            except urllib.error.HTTPError as he:
                if he.code == 409:
                    time.sleep(1)
                    req2 = urllib.request.Request(
                        f"https://api.github.com/repos/{REPO}/contents/{path}?ref={branch}",
                        headers={"Authorization": f"token {token}", "Accept": "application/vnd.github.v3+json"}
                    )
                    with urllib.request.urlopen(req2) as r2:
                        d2 = json.loads(r2.read())
                        fresh_sha = d2['sha']
                    return _put(fresh_sha)
                raise

        github_put_branch(TOKEN, STATE_FILE_PATH, state_sha, state_content, "brain: state update", STATE_BRANCH)

        # ── 1b. Bump sw.js cache version ────────────────────────────────────
        # Read local sw.js, replace __BUILDTIME__ placeholder, push to GitHub,
        # then restore the placeholder so the next push can bump it again.
        sw_versioned = None
        buildtime = None
        DASHBOARD_DIR = os.path.dirname(os.path.abspath(__file__))
        sw_template_path = os.path.join(DASHBOARD_DIR, 'sw.js')
        if os.path.exists(sw_template_path):
            try:
                with open(sw_template_path, 'r') as f:
                    sw_content = f.read()
                if '__BUILDTIME__' in sw_content:
                    buildtime = datetime.datetime.utcnow().strftime('%Y%m%d%H%M%S')
                    sw_versioned = sw_content.replace('__BUILDTIME__', buildtime)
                    # Write versioned sw.js locally (will be pushed below)
                    with open(sw_template_path, 'w') as f:
                        f.write(sw_versioned)
                    # Push sw.js to master
                    try:
                        _, sw_sha = github_get(TOKEN, 'sw.js', branch=STATE_BRANCH)
                    except Exception:
                        sw_sha = None
                    github_put_branch(TOKEN, 'sw.js', sw_sha, sw_versioned,
                                      f"chore: bump SW cache version {buildtime}", STATE_BRANCH)
                    # Restore placeholder in local file so next push can bump again
                    sw_restored = sw_versioned.replace(buildtime, '__BUILDTIME__')
                    with open(sw_template_path, 'w') as f:
                        f.write(sw_restored)
            except Exception as e:
                try:
                    with open("/tmp/push_github_error.log", "a") as f:
                        f.write(f"sw.js bump failed: {e}\n")
                except Exception:
                    pass

        # ── 2. Patch index.html tunnel URL on main (Vercel production branch) ─
        if tunnel:
            try:
                req_idx = urllib.request.Request(
                    f"https://api.github.com/repos/{REPO}/contents/{INDEX_FILE_PATH}?ref={INDEX_BRANCH}",
                    headers={"Authorization": f"token {TOKEN}", "Accept": "application/vnd.github.v3+json"}
                )
                with urllib.request.urlopen(req_idx) as r:
                    d = json.loads(r.read())
                    index_content = base64.b64decode(d['content']).decode('utf-8')
                    index_sha = d['sha']
                # Replace hardcoded tunnel URL seed in JS
                new_index = re.sub(
                    r"tunnelUrl = 'https://[^']*';",
                    f"tunnelUrl = '{tunnel}';",
                    index_content
                )
                if new_index != index_content:
                    github_put_branch(TOKEN, INDEX_FILE_PATH, index_sha, new_index,
                               f"fix: update tunnel URL -> {tunnel}", INDEX_BRANCH)
            except Exception as e:
                # index.html patch failure is non-fatal
                with open("/tmp/push_github_error.log", "a") as f:
                    f.write(f"index patch failed: {e}\n")

    except Exception as e:
        try:
            with open("/tmp/push_github_error.log", "a") as f:
                f.write(f"{datetime.datetime.utcnow().isoformat()} {e}\n")
        except Exception:
            pass

if __name__ == "__main__":
    state_file = sys.argv[1] if len(sys.argv) > 1 else \
        "/Users/jc_agent/.openclaw/workspace/dashboard/state.json"
    tunnel_url = sys.argv[2] if len(sys.argv) > 2 else None
    push_to_github(state_file, tunnel_url)
