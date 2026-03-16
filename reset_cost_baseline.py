#!/usr/bin/env python3
"""Reset the daily cost baseline at midnight ET.
Captures current OpenRouter usage as the new zero-point for today's spend.
"""
import json, urllib.request, datetime, os

BASELINE_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'cost_baseline.json')
OR_KEY_FILE = os.path.expanduser('~/.secrets/openrouter_api_key.txt')

def reset_baseline():
    try:
        or_key = open(OR_KEY_FILE).read().strip()
        req = urllib.request.Request(
            'https://openrouter.ai/api/v1/auth/key',
            headers={'Authorization': f'Bearer {or_key}'}
        )
        with urllib.request.urlopen(req, timeout=10) as r:
            d = json.loads(r.read()).get('data', {})

        baseline = {
            'captured_at': datetime.datetime.utcnow().isoformat() + 'Z',
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
        print(f"Baseline reset at {baseline['captured_at']} — daily was ${baseline['total_daily']:.4f}")
    except Exception as e:
        print(f"ERROR: {e}")

if __name__ == '__main__':
    reset_baseline()
