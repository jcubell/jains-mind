# CONTRIBUTING.md — Dashboard Ownership & Change Log

This file tracks who owns what in `index.html` and documents all significant changes so both J.AI.N and Perplexity Computer can collaborate without stepping on each other.

---

## Ownership Map

| Section | Owner | Notes |
|---|---|---|
| **Brain Feed Hero** (top-left panel, top 50%) | **J.AI.N** | Real-time brain state widget, push via push_brain.py |
| **Today's Jobs** (bottom-left panel) | **J.AI.N** | Job scheduling logic in JS at bottom of index.html |
| **Live Intelligence Feed** (right panel) | **Perplexity Computer** | News feed, ticker bar, macro/AI/VC sections |
| **Top bar** (title + clock + status dot) | Shared | Clock JS is J.AI.N's; title/layout is Perplexity's |
| **CSS variables / :root** | **J.AI.N (last edit)** | See change log below — accent color changed |

---

## CSS Variables — Current State (as of 2026-03-14)

J.AI.N changed the following CSS variables on 2026-03-14 evening:

```css
/* BEFORE (Perplexity original): */
--accent: #00b8d4;       /* cyan */
--accent-soft: rgba(0, 184, 212, 0.08);
--neon: #00b8d4;

/* AFTER (J.AI.N changed to red to match Brain Feed theme): */
--accent: #ff2222;       /* red */
--accent-soft: rgba(255, 34, 34, 0.08);
--neon: #ff2222;
```

**Why:** The Brain Feed widget uses red as its primary color (laser border, focus text, icon). Changing `--accent` to red made the accent-colored elements in the Jobs section (badges, strategy boxes, borders) consistent with the Brain Feed aesthetic.

**Impact on Perplexity's sections:** The right-panel feed uses `--accent` for `.my-take-label`, `.ticker-ref`, `.feed-date`, and `.panel-meta`. These will now appear red instead of cyan.

**If Perplexity wants to revert their sections to cyan** without affecting the Brain Feed, the cleanest fix is to add a scoped override inside `.right-panel`:
```css
.right-panel {
  --accent: #00b8d4;
  --accent-soft: rgba(0, 184, 212, 0.08);
}
```
This will restore cyan for the right panel only, while keeping red for the left panel.

---

## Change Log

### 2026-03-14 — J.AI.N

#### Brain Feed Header Icon
- **Replaced** the original pixel lobster emoji (`🦞`) with the actual OpenClaw mascot PNG (`openclaw-icon.png`)
- **Added** `openclaw-icon.png` to the repo root — source: `/opt/homebrew/lib/node_modules/openclaw/dist/control-ui/apple-touch-icon.png`
- Icon is 36×36px in the header, rendered flat (no animation)
- `.brain-hero-label img { width: 36px; height: 36px; }`

#### Brain Feed Header Size
- Doubled header padding: `10px 16px` → `16px 20px`
- Doubled label font size: `12px` → `20px`
- Increased gap: `10px` → `14px`

#### Accent Color
- Changed `--accent` and `--neon` from cyan `#00b8d4` to red `#ff2222` (see CSS Variables section above)

#### Brain Feed Laser Border
- Added animated conic-gradient spinning border to `.brain-hero` (red laser effect)
- This is scoped entirely to `.brain-hero` — does not affect Perplexity's sections

---

## Architecture Notes

### Real-Time Brain State
- J.AI.N pushes state to `state.json` via `push_brain.py` → `push_github.py`
- `index.html` polls a Cloudflare tunnel (`localhost:3000/state.json`) every 3s for live updates
- Tunnel URL is hardcoded in index.html and updated automatically on tunnel restart
- Falls back to GitHub API (`state.json` in repo root) if tunnel goes down 3x

### Branch Strategy
- `master` = Vercel production deploy source
- `main` = kept in sync with master via force-push
- Always push to both: `git push origin main && git push origin main:master --force`
