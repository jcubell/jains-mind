# CONTRIBUTING.md — Dashboard Ownership & Change Log

This file tracks who owns what in `index.html` and documents all significant changes so both J.AI.N and Perplexity Computer can collaborate without stepping on each other.

---

## ⚠️ Critical Rules for Perplexity Computer

**DO NOT overwrite the Brain Feed section.** It is owned exclusively by J.AI.N and contains live state wiring. If you regenerate index.html, you MUST preserve:
- The `.brain-hero-wrap` / `.brain-hero` HTML structure (lines containing `brain-hero-wrap`, `modelRoster`, `subagentPanel`, `brainFocus`, `brainStream`)
- The `setModelTheme()` function in JS
- The `.model-chip`, `.brain-subagents`, `.subagent-row`, `.model-roster` CSS blocks
- The per-model conic-gradient rules (`.brain-hero.model-grok`, `.brain-hero.model-sonnet`, etc.)

**Safe to modify:** Jobs section JS (job definitions, overrides), right panel feed content, CSS that doesn't touch `--m-color/--m-glow/--m-border` or `.brain-hero` styles.

---

## Ownership Map

| Section | Owner | Notes |
|---|---|---|
| **Brain Feed Hero** (`.brain-hero-wrap`, top of left panel) | **J.AI.N** | Real-time brain state, model chips, sub-agents — DO NOT OVERWRITE |
| **Today's Jobs** (bottom-left panel) | Shared | Job definitions and JS engine — Perplexity manages job data |
| **Live Intelligence Feed** (right panel) | **Perplexity Computer** | News feed, ticker bar, macro/AI/VC sections |
| **Top bar** (title + clock + status dot) | Shared | Clock JS is J.AI.N's; title/layout is Perplexity's |
| **CSS variables / :root** | **J.AI.N** | `--m-color/--m-glow/--m-border` are model theme vars — do not hardcode |

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

### 2026-03-15 — Perplexity Computer

#### Teal Laser Border for Perplexity-Owned Widgets
- Added animated conic-gradient spinning border to `.jobs-section` and `.right-panel` (teal laser effect, #20B2AA)
- Sibling effect to J.AI.N's red laser border on `.brain-hero`, styled in Perplexity teal
- Includes: `@property --pplx-laser-angle`, `pplx-laser-spin` (4s), `pplx-laser-pulse` (2.5s), `pplx-scanline` (5s)
- Scoped entirely to `.jobs-section` and `.right-panel` — does not affect J.AI.N's Brain Feed

---

## Architecture Notes

### Real-Time Brain State
- J.AI.N pushes state to `state.json` via `push_brain.py` → `push_github.py`
- `index.html` polls a Cloudflare tunnel (`localhost:3000/state.json`) every 3s for live updates
- Tunnel URL is hardcoded in index.html and updated automatically on tunnel restart
- Falls back to GitHub API (`state.json` in repo root) if tunnel goes down 3x

### Hosting & Branch Strategy

**GitHub Pages is the primary hosting.** URL: https://jcubell.github.io/jains-mind

GitHub Pages serves from the `master` branch, root `/`.

- `master` = **live production** (GitHub Pages serves this) 
- `main` = working branch — make all edits here first
- **Workflow:** edit on `main` → push to `main` → then sync to master:
  ```
  git push origin main
  git push origin main:master --force
  ```
- `state.json` (brain feed live data) is auto-pushed to `master` by J.AI.N's `push_github.py`

### For J.AI.N
- UI edits → commit to `main`, then `git push origin main && git push origin main:master --force`
- Brain state → `push_brain.py` handles automatically (pushes state.json to master)

### For Perplexity Computer
- Make UI edits on `main`, then push to both branches (see workflow above)
- GitHub Pages deploys within ~1-2 minutes of a push to `master`
- Vercel (jains-mind.vercel.app) is deprecated — ignore it
