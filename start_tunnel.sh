#!/bin/bash
# Start Cloudflare tunnel (one instance only).
# Captures tunnel URL and writes to /tmp/current-tunnel-url.txt
# push_brain.py reads that file and embeds URL in brain_state.json on GitHub,
# so the dashboard can self-heal after restarts.

LOG="/tmp/cloudflared-tunnel.log"
URL_FILE="/tmp/current-tunnel-url.txt"
PUSH_GITHUB="/Users/jc_agent/.openclaw/workspace/dashboard/push_github.py"

# Kill any stray cloudflared processes to prevent duplicates
pkill -f "cloudflared tunnel --url http://localhost:3000" 2>/dev/null
sleep 1

# Rotate log
echo "" > "$LOG"
rm -f "$URL_FILE"

# Start cloudflared in background, capture URL, then keep it alive in foreground
/opt/homebrew/bin/cloudflared tunnel --url http://localhost:3000 --logfile "$LOG" &
TUNNEL_PID=$!

# Wait for tunnel URL to appear (up to 60s)
for i in $(seq 1 30); do
  URL=$(grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' "$LOG" 2>/dev/null | tail -1)
  if [ -n "$URL" ]; then
    echo "Tunnel URL: $URL"
    echo "$URL" > "$URL_FILE"
    # Push updated tunnel URL to GitHub so dashboard can self-heal
    /opt/homebrew/bin/python3 "$PUSH_GITHUB" \
      /Users/jc_agent/.openclaw/workspace/dashboard/state.json \
      "$URL" &
    break
  fi
  sleep 2
done

wait $TUNNEL_PID
