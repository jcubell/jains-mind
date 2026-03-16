# CONTRIBUTING.md — Dashboard Ownership, Change Log & Coordination Protocol

This file governs how J.AI.N and Perplexity Computer collaborate on `index.html` without stepping on each other.  
**Read this before touching any file in this repo.**

---

## 📌 LATEST VERSION — READ FIRST

**Current production commit:** `17a1178` — feat: expand activity stream with title+detail per thought  
**Branch serving GitHub Pages:** `master`  
**Live URL:** https://jcubell.github.io/jains-mind  
**Last updated by:** J.AI.N (2026-03-15)

### Recent commit history (newest first)
| Commit | Author | Description |
|---|---|---|
| `17a1178` | J.AI.N | feat: expand activity stream with title+detail per thought |
| `a190f6a` | J.AI.N | fix: session cost = today only, daily cost = last30Days aggregate |
| `bcb02c4` | J.AI.N | fix: restore sessionCostUSD for session cost |
| `a41e8f1` | J.AI.N | fix: improve model normalization and token tracking |
| `5da62ec` | J.AI.N | fix: normalize model names to dedupe Claude Sonnet variants |
| `860b416` | J.AI.N | docs: coordination protocol + version control guidelines |
| `87a3c13` | J.AI.N | Add usage/cost widget integration via codexbar |
| `cadee5d` | J.AI.N | Fix lingering Whisper effects in idle |

**⚠️ Always `git reset --hard origin/main` before editing — J.AI.N pushes frequently throughout the day.**

---

## ⚠️ CRITICAL: Sections You Must NOT Touch

The following are **owned exclusively by J.AI.N** and contain live state wiring. **Do not overwrite, restructure, or modify these elements:**

### 🔴 Brain Feed Hero (Top-Left Panel)
The entire `.brain-hero-wrap` block — from `<!-- BRAIN FEED HERO -->` to its closing `</div>` — is J.AI.N's live brain state widget. It receives real-time pushes every few seconds.

**Off-limits HTML elements:**
- `.brain-hero-wrap` / `.brain-hero` — outer container + laser border
- `#brainFocus` — large focus text (the "headline" Josh sees)
- `#brainStream` — scrolling thought stream (the activity log)
- `#modelRoster` — model chip indicators (shows which AI is active)
- `#subagentPanel` — sub-agent status card
- `#objDot` — status indicator dot

**Off-limits JS functions (do not modify or delete):**
- `setModelTheme()` — switches colors based on active model
- `applyState()` — processes incoming state.json and renders it
- `pollTunnel()` / `pollGitHub()` — live state polling loop
- `fetchUsageMetrics()` — cost/usage widget data fetch

**Off-limits CSS blocks:**
- `.brain-hero`, `.brain-hero-wrap`, `.brain-hero-header`, `.brain-hero-focus`
- `.brain-hero-stream`, `.brain-subagents`, `.subagent-row`
- `.model-chip`, `.model-roster`, `.brain-powered`
- `.brain-hero.model-grok`, `.model-sonnet`, `.model-gemini`, `.model-deepseek`, `.model-llama`, `.model-openai`, `.model-whisper`, `.model-default` — per-model conic-gradient laser borders
- `--m-color`, `--m-glow`, `--m-border` CSS vars — these are dynamically set by `setModelTheme()`

**Off-limits Python scripts (never edit):**
- `push_brain.py` — J.AI.N's brain state push pipeline
- `push_github.py` — pushes state.json to master branch
- `state.json` — never edit manually; auto-written by push_brain.py

### 🔴 Activity Stream Detail Format (Added 2026-03-15)
As of commit `17a1178`, each thought entry in `#brainStream` now supports two fields:
- `title` — the step headline (what J.AI.N was doing), model-colored
- `text` — detail/explanation, shown in muted mono with a left border accent

The JS renderer in `applyState()` handles this automatically. **Do not modify the thought rendering logic.**

---

## ✅ Your Zones — What Perplexity Computer Owns

### Today's Jobs (Bottom-Left Panel)
- **HTML:** `<div class="jobs-section">` block in the left column
- **JS:** The `var jobs = [...]` array and `renderJobs()` function
- **CSS:** All `.jobs-section` scoped styles

**To update jobs:** Find `var jobs = [` (around line 2279) and edit the array. Each job object:
```javascript
{
  name: 'Job Name',           // Display name
  time: '7:00 AM ET',         // Human-readable schedule
  scheduleHour: 7,            // 24h hour for auto-status calc
  scheduleMinute: 0,
  status: 'scheduled',        // 'scheduled' | 'active' | 'completed'
  desc: 'Short description',  // Shown under progress bar
  recurring: false,           // true = cycles every 4h (for always-on jobs)
  prevHour: 0,                // Previous job's hour (for progress calc)
  prevMinute: 0,
  subtasks: [                 // Optional: bullet list shown on hover
    'Subtask line 1',
    'Subtask line 2'
  ],
  strategy: 'Strategy text'   // Optional: strategy box below subtasks
}
```

**Auto-status logic:** `getStatusForJob()` auto-promotes jobs to `active` (≤30min before schedule) or `completed` (past schedule time). The `status` field in the array is the default for times that don't match — set to `'scheduled'` for future jobs.

### Live Intelligence Feed (Right Panel)
- **HTML:** Everything inside `<div class="right-panel">` — the feed sections, items, ticker
- **CSS:** All `.right-panel` and `.feed-section` scoped styles, `.ticker-bar`

**Feed HTML structure:**
```html
<div class="right-panel">
  <div class="ticker-bar">...</div>
  <div class="feed-date" id="feedDate">FRIDAY, MARCH 14, 2026</div>
  <div id="feedTimestamp"></div>

  <!-- One feed-section per category -->
  <div class="feed-section">
    <div class="feed-section-header">Category Name</div>

    <!-- signal-fire = high priority (red highlight) -->
    <div class="feed-item signal-fire">
      <strong><span class="ticker-ref">$TICKER</span> Company Name</strong> — Headline text.
      <span class="entity-ref">Source</span>
    </div>

    <!-- signal-watch = medium priority (amber highlight) -->
    <div class="feed-item signal-watch">...</div>

    <!-- signal-noise = low priority (subtle) -->
    <div class="feed-item signal-noise">...</div>
  </div>
</div>
```

**To update the feed:** Find the `<div class="right-panel">` block (around line 1465) and update the HTML content. Change `id="feedDate"` content and the feed items.

**Your accent color is teal `#20B2AA`** — not red (red belongs to J.AI.N's Brain Feed). Scope any new CSS to `.jobs-section` or `.right-panel`.

---

## 🔄 Version Control — MANDATORY Pre-Edit Protocol

**Every single time before you edit any file:**

```bash
cd /tmp/jains-mind        # or wherever you have the repo cloned
git fetch origin
git reset --hard origin/main   # ALWAYS reset to latest — do NOT assume local is current
git log --oneline -10          # scan recent commits from both agents
```

If J.AI.N pushed in the last hour, read the commit message to understand what changed before you start.

---

## 🚀 Deploying to Production (GitHub Pages)

**GitHub Pages serves from the `master` branch, root `/`.**

There are two branches:
- `main` — working branch where all edits are made
- `master` — live production; updated by force-pushing from main

### Full Deploy Workflow

```bash
# 1. Sync to latest first (NEVER skip this)
cd /tmp/jains-mind
git fetch origin
git reset --hard origin/main

# 2. Make your changes to index.html (or other files)
# ... edit files ...

# 3. Validate JS syntax if you touched any JS
node --check index.html   # catches syntax errors before pushing

# 4. Commit to main
git add -A
git commit -m "perplexity: clear description of what you changed"

# 5. Push to main (working branch)
git push origin main

# 6. ⚡ Sync to master (LIVE production)
git push origin main:master --force

# 7. GitHub Pages deploys within ~1-2 minutes
# Check: https://jcubell.github.io/jains-mind
```

### ⚠️ Rules
- **NEVER push directly to `master`** (only sync via `main:master --force`)
- **NEVER `git merge` or `git rebase` into master** — this corrupts it with stale history
- **ALWAYS use `--force` on the master push** — it's intentional and correct here
- `state.json` is pushed to `master` automatically by J.AI.N's `push_github.py` — don't conflict with this
- Vercel (`jains-mind.vercel.app`) is **deprecated** — ignore it, it hit rate limits

### What Happens If You Forget to Reset First
If you skip `git reset --hard origin/main` and J.AI.N pushed since your last sync, your push will either fail (non-fast-forward) or silently overwrite J.AI.N's recent work. The `--force` on master makes this especially risky. **Always reset.**

---

## 📢 Coordination Protocol

1. **Before a significant edit:** Add an entry to the Change Log below stating your intent.
2. **After pushing:** Update the Change Log with what you changed and the commit hash.
3. **If you see a recent commit (<1h old) from J.AI.N:** Check whether your planned edit overlaps. If so, wait or coordinate.

---

## 🧬 Architecture Notes

### Real-Time Brain State Pipeline
- J.AI.N pushes state via: `push_brain.py` → writes `state.json` → `push_github.py` → commits to `master`
- `index.html` polls a **Cloudflare tunnel** (`localhost:3000/state.json`) every 3 seconds
- Falls back to GitHub API (`state.json` in repo root) if tunnel is down 3× in a row
- Tunnel URL is hardcoded in index.html and auto-updated by J.AI.N on each tunnel restart
- **Do not hardcode the tunnel URL** — J.AI.N manages it

### Brain Feed Activity Stream (Updated 2026-03-15)
Each thought pushed via `push_brain.py` can have:
- **Focus arg** (required) → becomes `entry.title` — shown as the step headline in color
- **Detail arg** (optional) → becomes `entry.text` — shown as muted mono detail below title

Single-line pushes (no detail): render as flat single-line (legacy behavior preserved).  
Two-field pushes: render as `title + detail` with left-border accent.

### CSS Architecture
```css
/* Root colors (J.AI.N manages) */
--accent: #ff2222;        /* red — Brain Feed theme */
--accent-soft: rgba(255, 34, 34, 0.08);

/* Dynamic model theme vars (set by setModelTheme()) */
--m-color: <per model>
--m-glow: <per model>
--m-border: <per model>
```

**If Perplexity wants to override accent for right panel only** (without breaking Brain Feed):
```css
.right-panel {
  --accent: #20B2AA;
  --accent-soft: rgba(32, 178, 170, 0.08);
}
```

### Key Line Numbers in index.html (approximate — verify after syncing)
| Section | Approx. Line |
|---|---|
| Ownership map comment | 17–46 |
| Brain Feed CSS starts | ~204 |
| Jobs CSS starts | ~706 |
| Feed CSS starts | ~848 |
| Brain Feed HTML | ~1350 |
| Right panel HTML | ~1465 |
| `var jobs = [...]` array | ~2279 |
| `renderJobs()` function | ~2325 |

---

## Change Log

> **Instructions:** Add a new dated entry each time you make a significant change. Keep entries brief. Reference commit hashes when available.

---

### 2026-03-15 — J.AI.N

#### Activity Stream Title+Detail (`17a1178`)
- `push_brain.py`: thought entries now store `title` (focus/headline) + `text` (detail) separately
- `index.html`: thought renderer shows two-line format when both fields present; single-line when legacy
- New CSS: `.t-body`, `.t-title` (model-colored), `.t-detail` (muted mono + left border accent)

#### Session/Daily Cost Fix (`a190f6a`, `bcb02c4`, `a41e8f1`, `5da62ec`)
- Fixed cost widget duplication — session cost now = today only, daily = last30Days
- Improved model name normalization to dedupe Claude Sonnet variants
- Fixed token tracking in cost summary endpoints

#### CONTRIBUTING.md Comprehensive Update (this commit)
- Added latest version table with all recent commits
- Added detailed jobs array schema documentation
- Added feed HTML structure reference
- Added line number map for key sections
- Added detailed GitHub Pages deploy workflow with warnings
- Added activity stream detail format documentation
- Clarified all no-touch zones

#### Coordination Protocol Added (`860b416`)
- Pre-edit version control protocol
- Ownership map
- Whisper theme fix documentation

#### Whisper Theme Fix (`cadee5d`)
- `applyState()` + `setMode()`: reset whisper model class on idle transitions
- `push_brain.py`: auto-clears whisper to grok-4 default on idle push without model arg
- Prevents dashboard getting stuck in white/whisper color scheme

#### Cache-Busting Headers (`65ecec2`)
- `no-cache, no-store, must-revalidate` meta headers prevent stale CSS/JS on push

#### Codexbar Usage Widget (`87a3c13`)
- Compact cost/usage strip above brain feed — pulls from local `codexbar` CLI

---

### 2026-03-15 — Perplexity Computer

#### Compact Jobs Widget + Fresh Intelligence Feed
- Redesigned Today's Jobs from card-based layout to compact single-line rows grouped by category (SORARE, INTELLIGENCE FEED, MONITORING)
- Status icons: ✓ green for completed, ● teal pulse for active, ○ gray for scheduled
- Completed rows get strikethrough + reduced opacity; removed all subtask/strategy CSS
- Reduced `.panel-body` padding to `8px 16px`
- Fresh intelligence feed data for March 15: updated all 4 categories (AI Providers, Enterprise AI, VC/PE/M&A, Geopolitics & Macro)
- Updated ticker bar with latest prices (SPY $662, NASDAQ 22,105, NVDA $180, BTC $72,520, OIL $99.27)
- Fear & Greed index updated to 20 (Extreme Fear)
- Added $TSLA and OIL to ticker bar

#### Teal Laser Border for Perplexity-Owned Widgets
- Added animated conic-gradient spinning border to `.jobs-section` and `.right-panel` (teal #20B2AA)
- `@property --pplx-laser-angle`, `pplx-laser-spin` (4s), `pplx-laser-pulse` (2.5s), `pplx-scanline` (5s)
- Scoped to `.jobs-section` and `.right-panel` only — does not affect Brain Feed

---

## Quick Reference Checklist

**Before editing:**
- [ ] `git fetch origin && git reset --hard origin/main`
- [ ] `git log --oneline -10` — check for recent commits
- [ ] Identify which sections you'll touch — confirm ownership
- [ ] NOT touching Brain Feed? Good.

**After editing:**
- [ ] `node --check index.html` (if JS was changed)
- [ ] `git add -A && git commit -m "perplexity: what you did"`
- [ ] `git push origin main`
- [ ] `git push origin main:master --force`
- [ ] Add entry to Change Log in this file
- [ ] Verify live at https://jcubell.github.io/jains-mind (~1-2 min deploy time)
