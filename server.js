const http = require('http');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const PORT = 3000;
const HTML_FILE = path.join(__dirname, 'widget.html');
const STATE_FILE = path.join(__dirname, 'state.json');

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  // Strip query string for routing
  const urlPath = req.url.split('?')[0];

  if (urlPath === '/' || urlPath === '/widget.html' || urlPath === '/index.html') {
    try {
      const html = fs.readFileSync(HTML_FILE, 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(html);
    } catch(e) {
      res.writeHead(500); res.end('widget.html not found');
    }
    return;
  }

  if (urlPath === '/state.json' || urlPath === '/state') {
    try {
      const state = fs.readFileSync(STATE_FILE, 'utf8');
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store, no-cache' });
      res.end(state);
    } catch(e) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{}');
    }
    return;
  }

  if (req.method === 'POST' && urlPath === '/push-state') {
    let body = '';
    req.on('data', d => body += d);
    req.on('end', () => {
      try {
        JSON.parse(body); // validate
        fs.writeFileSync(STATE_FILE, body, 'utf8');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{"ok":true}');
      } catch(e) {
        res.writeHead(400); res.end('{"error":"invalid json"}');
      }
    });
    return;
  }

  // Normalize model names to canonical keys (dedupes variant suffixes like -4-5 vs -4-6)
  function normalizeModelName(name) {
    if (!name) return name;
    // Strip openrouter/ prefix (e.g. openrouter/anthropic/claude-sonnet-4-6 → claude-sonnet-4-6)
    let n = name.toLowerCase().trim();
    n = n.replace(/^openrouter\/[^/]+\//, '').replace(/^openrouter\//, '');
    // Claude Sonnet variants → canonical claude-sonnet-4-6
    if (n.includes('claude') && n.includes('sonnet')) return 'claude-sonnet-4-6';
    // Claude Opus variants → canonical claude-opus
    if (n.includes('claude') && n.includes('opus')) return 'claude-opus';
    // Claude Haiku variants → canonical claude-haiku
    if (n.includes('claude') && n.includes('haiku')) return 'claude-haiku';
    // Grok variants → canonical grok-4
    if (n.includes('grok')) return 'grok-4';
    // GPT-4o-mini → canonical gpt-4o-mini (check before gpt-4o)
    if (n.startsWith('gpt-4o-mini') || n.includes('gpt-4o-mini')) return 'gpt-4o-mini';
    // GPT-4o variants → canonical gpt-4o
    if (n.startsWith('gpt-4o') || n.includes('gpt-4o')) return 'gpt-4o';
    // GPT-5 variants (gpt-5, gpt-5.2, gpt-5-preview, etc.) → canonical gpt-5
    if (n.startsWith('gpt-5') || n.includes('gpt-5')) return 'gpt-5';
    // Gemini flash variants → canonical gemini-2.0-flash
    if (n.includes('gemini') && n.includes('flash')) return 'gemini-2.0-flash';
    // Gemini pro variants → canonical gemini-2.5-pro
    if (n.includes('gemini') && (n.includes('pro') || n.includes('2.5'))) return 'gemini-2.5-pro';
    // DeepSeek variants → canonical deepseek-chat-v3-0324
    if (n.includes('deepseek')) return 'deepseek-chat-v3-0324';
    // Llama variants → canonical llama
    if (n.includes('llama')) return 'llama';
    return n; // fallback: return lowercased/stripped name
  }

  // /or-model-usage — per-model usage counts from codexbar (for model rotation widget)
  if (urlPath === '/or-model-usage') {
    try {
      const codexbarBin = '/opt/homebrew/bin/codexbar';
      const allModels = {};
      for (const provider of ['codex', 'claude']) {
        let raw;
        try { raw = execSync(`${codexbarBin} cost --format json --provider ${provider}`, { timeout: 8000 }).toString(); } catch(e) { continue; }
        let parsed; try { parsed = JSON.parse(raw); } catch(e) { continue; }
        const entries = Array.isArray(parsed) ? parsed : [parsed];
        for (const entry of entries) {
          for (const day of (entry.daily || [])) {
            for (const mb of (day.modelBreakdowns || [])) {
              const name = normalizeModelName((mb.modelName || '').trim());
              if (!name) continue;
              if (!allModels[name]) allModels[name] = { model: name, count: 0 };
              allModels[name].count += 1;
            }
          }
        }
      }
      const models = Object.values(allModels);
      const total = models.reduce((s, m) => s + m.count, 0);
      for (const m of models) m.pct = total > 0 ? Math.round((m.count / total) * 100) : 0;
      models.sort((a, b) => b.count - a.count);
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ models }));
    } catch(e) {
      res.writeHead(500); res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // /or-cost-summary — primary: OpenRouter API key stats; fallback: codexbar
  if (urlPath === '/or-cost-summary') {
    try {
      const allModels = {};
      let sessionCost = 0;
      let dailyCost = 0;
      let weeklyCost = 0;
      let monthlyCost = 0;
      let totalTokens = 0;
      let orSource = 'codexbar';

      // === PRIMARY: OpenRouter /auth/key endpoint ===
      // Returns usage (total), usage_daily, usage_weekly, usage_monthly
      // Also byok_usage* for BYOK (bring-your-own-key) spend routed through OR
      let orKeyData = null;
      try {
        const fs2 = require('fs');
        const orKey = fs2.readFileSync('/Users/jc_agent/.secrets/openrouter_api_key.txt', 'utf8').trim();
        const https = require('https');
        orKeyData = await new Promise((resolve, reject) => {
          const options = {
            hostname: 'openrouter.ai',
            path: '/api/v1/auth/key',
            method: 'GET',
            headers: { 'Authorization': 'Bearer ' + orKey }
          };
          const req2 = https.request(options, (r) => {
            let body = '';
            r.on('data', d => body += d);
            r.on('end', () => {
              try { resolve(JSON.parse(body)); } catch(e) { reject(e); }
            });
          });
          req2.on('error', reject);
          req2.setTimeout(5000, () => { req2.destroy(); reject(new Error('timeout')); });
          req2.end();
        });
      } catch(e) {
        orKeyData = null; // fall through to codexbar
      }

      if (orKeyData && orKeyData.data) {
        const d = orKeyData.data;
        // OR credits usage (billed to OR account)
        const orDaily   = d.usage_daily   || 0;
        const orWeekly  = d.usage_weekly  || 0;
        const orMonthly = d.usage_monthly || 0;
        // BYOK usage (billed to user's own API keys, routed via OR)
        const byokDaily   = d.byok_usage_daily   || 0;
        const byokWeekly  = d.byok_usage_weekly  || 0;
        const byokMonthly = d.byok_usage_monthly || 0;
        // Raw totals
        const rawDaily   = orDaily   + byokDaily;
        const rawWeekly  = orWeekly  + byokWeekly;
        const rawMonthly = orMonthly + byokMonthly;

        // OR resets usage_daily at midnight UTC (= 8 PM ET).
        // So rawDaily IS today's spend — no baseline subtraction needed for daily/monthly.
        dailyCost   = rawDaily;
        weeklyCost  = rawWeekly;
        monthlyCost = rawMonthly;

        // === Session cost: delta since session baseline snapshot ===
        // baseline.json is written at session start (or midnight ET cron).
        // Session = how much spent since that snapshot.
        let baseline = null;
        try {
          baseline = JSON.parse(fs.readFileSync('/Users/jc_agent/.openclaw/workspace/dashboard/cost_baseline.json', 'utf8'));
        } catch(e) { baseline = null; }

        if (baseline) {
          sessionCost = Math.max(0, rawDaily - (baseline.total_daily || 0));
        } else {
          sessionCost = 0;
        }
        orSource = 'openrouter';
      }

      // === MODEL BREAKDOWN: subagents/runs.json + state.json ===
      // OpenRouter BYOK API doesn't expose per-model breakdown, so we reconstruct
      // from (1) sub-agent runs tracked in runs.json, (2) main session model from state.json
      try {
        const RUNS_PATH = '/Users/jc_agent/.openclaw/subagents/runs.json';
        const STATE_PATH = '/Users/jc_agent/.openclaw/workspace/dashboard/state.json';
        // Model pricing (per 1M tokens, in/out)
        const MODEL_PRICING = {
          'claude-sonnet-4-6': { in: 3.0, out: 15.0 },
          'grok-4': { in: 3.0, out: 15.0 },
          'grok-4-fast': { in: 0.20, out: 0.50 },
          'gemini-2.0-flash': { in: 0.10, out: 0.40 },
          'gemini-2.5-pro': { in: 1.25, out: 10.0 },
          'deepseek-chat-v3-0324': { in: 0.20, out: 0.77 },
          'deepseek-r1': { in: 0.70, out: 2.50 },
          'gpt-4o': { in: 2.50, out: 10.0 },
          'gpt-4o-mini': { in: 0.15, out: 0.60 },
          'mistral': { in: 0, out: 0 },
        };

        // Today's date window (use Unix epoch cutoff for today in ET)
        const now = Date.now();
        // 24h window
        const cutoff24h = now - 24 * 60 * 60 * 1000;

        // 1. Scan subagent runs for today
        let runsData = null;
        try { runsData = JSON.parse(fs.readFileSync(RUNS_PATH, 'utf8')); } catch(e) {}
        const runs = runsData ? (Array.isArray(runsData.runs) ? runsData.runs : Object.values(runsData.runs || {})) : [];

        for (const run of runs) {
          const ts = run.createdAt || 0;
          if (ts < cutoff24h) continue;
          const rawModel = (run.model || '').replace(/^openrouter\/[^/]+\//, '').replace(/^openrouter\//, '');
          const name = normalizeModelName(rawModel);
          if (!name) continue;
          if (!allModels[name]) allModels[name] = { model: name, cost: 0, tokens: 0, days: 0 };
          // Use tracked cost if available, else estimate
          const trackedCost = run.cost || 0;
          const inTok = run.inputTokens || 0;
          const outTok = run.outputTokens || 0;
          if (trackedCost > 0) {
            allModels[name].cost += trackedCost;
          } else if (inTok > 0 || outTok > 0) {
            const p = MODEL_PRICING[name] || { in: 3.0, out: 15.0 };
            allModels[name].cost += (inTok * p.in + outTok * p.out) / 1_000_000;
          }
          allModels[name].tokens += (inTok + outTok);
          allModels[name].days += 1;
        }

        // 2. Read model_usage_log.json — accurate per-model call counts from push_brain.py
        //    This replaces the old state.json single-model + hardcoded newsbot approach
        const LOG_FILE = path.join(__dirname, 'model_usage_log.json');
        let logData = null;
        try { logData = JSON.parse(fs.readFileSync(LOG_FILE, 'utf8')); } catch(e) {}
        if (logData) {
          // ET date key (UTC-4)
          const etNow = new Date(Date.now() - 4 * 3600 * 1000);
          const todayKey = etNow.toISOString().slice(0, 10);
          const todayCounts = logData[todayKey] || {};
          const totalCalls = Object.values(todayCounts).reduce((s, v) => s + v, 0);
          const subagentCostSoFar = Object.values(allModels).reduce((s, m) => s + m.cost, 0);
          const remainingCost = Math.max(0, dailyCost - subagentCostSoFar);
          for (const [model, count] of Object.entries(todayCounts)) {
            if (!allModels[model]) allModels[model] = { model, cost: 0, tokens: 0, days: 0 };
            allModels[model].days = count;
            // Distribute remaining daily cost proportionally by call count
            allModels[model].cost += totalCalls > 0 ? remainingCost * (count / totalCalls) : 0;
          }
        } else {
          // Fallback: use current state.json model + hardcoded newsbot
          let stateData = null;
          try { stateData = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')); } catch(e) {}
          const mainModel = normalizeModelName(
            ((stateData && stateData.brain && stateData.brain.model) || 'claude-sonnet-4-6')
              .replace(/^openrouter\/[^/]+\//, '').replace(/^openrouter\//, '')
          );
          if (mainModel) {
            if (!allModels[mainModel]) allModels[mainModel] = { model: mainModel, cost: 0, tokens: 0, days: 0 };
            const subagentCostTotal = Object.values(allModels).reduce((s, m) => s + m.cost, 0);
            allModels[mainModel].cost += Math.max(0, dailyCost - subagentCostTotal);
            allModels[mainModel].days += 1;
          }
          const newsModel = 'gemini-2.0-flash';
          if (!allModels[newsModel]) allModels[newsModel] = { model: newsModel, cost: 0, tokens: 0, days: 0 };
          allModels[newsModel].cost += 0.006;
          allModels[newsModel].days += 7;
        }

      } catch(e) {
        // Silently fall through — model breakdown will be empty
      }

      // Fallback: try codexbar for any local tracked models
      try {
        const codexbarBin = '/opt/homebrew/bin/codexbar';
        for (const provider of ['codex', 'claude']) {
          let raw;
          try { raw = execSync(`${codexbarBin} cost --format json --provider ${provider}`, { timeout: 5000 }).toString(); } catch(e) { continue; }
          let parsed; try { parsed = JSON.parse(raw); } catch(e) { continue; }
          const entries = Array.isArray(parsed) ? parsed : [parsed];
          for (const entry of entries) {
            if (orSource === 'codexbar') {
              if (entry.last30DaysCostUSD) dailyCost += entry.last30DaysCostUSD;
              const todayStr = new Date().toLocaleDateString('en-CA');
              for (const day of (entry.daily || [])) {
                if (day.date === todayStr) { sessionCost += day.totalCost || 0; totalTokens += day.totalTokens || 0; }
              }
            }
          }
        }
      } catch(e) {}

      // Compute total cost and pct for model breakdown
      const modelList = Object.values(allModels);
      const totalCost = modelList.reduce((s, m) => s + m.cost, 0);
      for (const m of modelList) {
        m.pct = totalCost > 0 ? Math.round((m.cost / totalCost) * 100) : 0;
        m.count = m.days;
        delete m.days;
      }
      modelList.sort((a, b) => b.cost - a.cost);

      const result = {
        session: { est_cost: sessionCost, pushes: 0 },
        daily:   { est_cost: dailyCost,   actual_or: orSource === 'openrouter' ? dailyCost   : null, source: orSource },
        monthly: { actual_or: orSource === 'openrouter' ? monthlyCost : null },
        weekly:  { actual_or: orSource === 'openrouter' ? weeklyCost  : null },
        models: modelList,
        tokens: totalTokens
      };

      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(result));
    } catch (e) {
      res.writeHead(500); res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // /tldr — extract live TLDR items from index.html (updated every ~3h by Perplexity agent)
  if (urlPath === '/tldr') {
    const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' };
    try {
      const html = fs.readFileSync(path.join(__dirname, '../jains-mind/index.html'), 'utf8');
      const sectionMatch = html.match(/id="tldrSection"([\s\S]*?)(<\/div>\s*){2}/);
      const sectionHtml = sectionMatch ? sectionMatch[0] : html;
      const items = [];
      const itemRegex = /<div class="tldr-item"[^>]*data-cat="([^"]*)"[^>]*>([\s\S]*?)<\/div>/g;
      let m;
      while ((m = itemRegex.exec(sectionHtml)) !== null) {
        items.push({ cat: m[1], html: m[2].trim() });
      }
      res.writeHead(200, headers);
      res.end(JSON.stringify({ items, ts: Date.now() }));
    } catch(e) {
      res.writeHead(500, headers);
      res.end(JSON.stringify({ error: e.message, items: [] }));
    }
    return;
  }

  // /refresh — signal desktop to reload (POST)
  if (req.method === 'POST' && urlPath === '/refresh') {
    global.refreshPending = true;
    global.refreshAt = Date.now();
    const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
    res.writeHead(200, headers);
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  // /refresh-state — consume-on-read refresh signal (GET)
  if (urlPath === '/refresh-state') {
    const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' };
    const pending = global.refreshPending === true;
    const at = global.refreshAt || 0;
    global.refreshPending = false; // consume-on-read
    res.writeHead(200, headers);
    res.end(JSON.stringify({ pending, at }));
    return;
  }

  // /sleep — set sleep mode (POST)
  if (req.method === 'POST' && urlPath === '/sleep') {
    global.sleepMode = true;
    const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
    res.writeHead(200, headers);
    res.end(JSON.stringify({ ok: true, sleep: true }));
    return;
  }

  // /wake — clear sleep mode (POST)
  if (req.method === 'POST' && urlPath === '/wake') {
    global.sleepMode = false;
    const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
    res.writeHead(200, headers);
    res.end(JSON.stringify({ ok: true, sleep: false }));
    return;
  }

  // /sleep-state — GET current sleep state
  if (urlPath === '/sleep-state') {
    const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' };
    res.writeHead(200, headers);
    res.end(JSON.stringify({ sleep: global.sleepMode === true, sleeping: global.sleepMode === true }));
    return;
  }

  // /clear-state — force-reset stuck working state (POST)
  if (req.method === 'POST' && urlPath === '/clear-state') {
    try {
      let state = {};
      try { state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch(e) {}
      if (!state.brain) state.brain = {};
      state.brain.mode     = 'idle';
      state.brain.focus    = 'Cleared — awaiting instruction';
      state.brain.subagent  = null;
      state.brain.subagents = [];
      state.updated_at = new Date().toISOString();
      fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
      const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
      res.writeHead(200, headers);
      res.end(JSON.stringify({ ok: true }));
    } catch(e) {
      res.writeHead(500); res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // /cron-status — list openclaw scheduled jobs for mobile dashboard
  if (urlPath === '/cron-status') {
    const { exec } = require('child_process');
    const cronEnv = { ...process.env, PATH: '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin' };
    exec('/opt/homebrew/bin/openclaw cron list --json', { env: cronEnv }, (err, stdout) => {
      const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' };
      if (err) { res.writeHead(200, headers); return res.end(JSON.stringify({ error: 'unavailable', jobs: [] })); }
      try {
        // Strip plugin/log lines that pollute stdout before the JSON object
        const jsonStart = stdout.indexOf('{');
        const cleanStdout = jsonStart >= 0 ? stdout.slice(jsonStart) : stdout;
        const parsed = JSON.parse(cleanStdout);
        const jobs = Array.isArray(parsed) ? parsed : (parsed.jobs || []);
        res.writeHead(200, headers);
        res.end(JSON.stringify({ jobs, ts: Date.now() }));
      } catch(e) {
        res.writeHead(200, headers);
        res.end(JSON.stringify({ error: 'parse_error', jobs: [], raw: stdout.slice(0, 500) }));
      }
    });
    return;
  }

  // /task-queue — live task queue: active + recent sub-agent runs + brain state
  if (urlPath === '/task-queue') {
    const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' };
    try {
      const RUNS_PATH = '/Users/jc_agent/.openclaw/subagents/runs.json';
      const STATE_PATH = path.join(__dirname, 'state.json');
      const now = Date.now();
      const windowMs = 4 * 60 * 60 * 1000; // show last 4h

      // Load runs
      let runs = [];
      try {
        const rd = JSON.parse(fs.readFileSync(RUNS_PATH, 'utf8'));
        runs = Object.values(rd.runs || rd || {});
      } catch(e) {}

      // Load brain state for current subagent(s)
      let brainSubagents = [];
      let brainSubagent = null;
      let brainFocus = '';
      let brainMode = 'idle';
      try {
        const state = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
        brainSubagents = (state.brain && state.brain.subagents) ? state.brain.subagents : [];
        brainSubagent = (state.brain && state.brain.subagent) ? state.brain.subagent : null;
        brainFocus = (state.brain && state.brain.focus) || '';
        brainMode = (state.brain && state.brain.mode) || 'idle';
      } catch(e) {}

      // Get active subagent IDs from brain state
      const activeIds = new Set();
      if (brainSubagent && brainSubagent.name) activeIds.add(brainSubagent.name);
      for (const a of brainSubagents) { if (a.name) activeIds.add(a.name); }

      // Build task items from runs (last 4h, FIFO order)
      const cutoff = now - windowMs;
      const tasks = runs
        .filter(r => (r.createdAt || 0) > cutoff)
        .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)) // FIFO
        .map(r => {
          const childKey = r.childSessionKey || '';
          // Match against brain subagents
          const isActive = brainMode === 'working' && (
            activeIds.size > 0
              ? Array.from(activeIds).some(n => childKey.includes(n) || (r.label || '').includes(n))
              : false
          );
          const ageMs = now - (r.startedAt || r.createdAt || now);
          const resolvedEndedAt = r.completedAt || r.endedAt || r.cleanupCompletedAt || null;
          const durationMs = r.durationMs || (resolvedEndedAt ? resolvedEndedAt - (r.startedAt || r.createdAt) : null);
          // Infer status
          let status = 'queued';
          if (resolvedEndedAt || r.cleanupHandled) status = 'complete';
          else if ((r.startedAt && ageMs < 2 * 60 * 60 * 1000) || isActive) status = 'in-progress';
          // ETA: if we have eta_seconds from brain subagent, use it
          let eta = null;
          if (status === 'in-progress') {
            const matchedSub = brainSubagent && (childKey.includes(brainSubagent.name || '') || true) ? brainSubagent : null;
            if (matchedSub && matchedSub.eta_seconds) {
              const elapsed = ageMs / 1000;
              eta = Math.max(0, matchedSub.eta_seconds - elapsed);
            }
          }
          return {
            id: r.runId || r.id,
            label: r.label || (r.task ? r.task.slice(0, 60) + '…' : 'Task'),
            task: r.task ? r.task.slice(0, 120) : '',
            model: (r.model || '').replace(/^openrouter\/[^/]+\//, '').replace(/^openrouter\//, ''),
            status,
            createdAt: r.createdAt || r.startedAt || 0,
            startedAt: r.startedAt || null,
            completedAt: resolvedEndedAt,
            ageMs,
            durationMs,
            eta,
            isActive
          };
        });

      // If brain is working but no matching run in window, add a synthetic in-progress entry
      if (brainMode === 'working' && brainFocus && tasks.filter(t => t.status === 'in-progress').length === 0) {
        const synthAgents = brainSubagents.length > 0 ? brainSubagents : (brainSubagent ? [brainSubagent] : []);
        for (const sa of synthAgents) {
          tasks.push({
            id: 'brain-' + (sa.name || 'active'),
            label: sa.name || 'Agent',
            task: sa.task || brainFocus,
            model: (sa.model || '').replace(/^openrouter\/[^/]+\//, '').replace(/^openrouter\//, ''),
            status: 'in-progress',
            createdAt: sa.started_at ? new Date(sa.started_at).getTime() : now,
            startedAt: sa.started_at ? new Date(sa.started_at).getTime() : now,
            completedAt: null,
            ageMs: sa.started_at ? now - new Date(sa.started_at).getTime() : 0,
            durationMs: null,
            eta: sa.eta_seconds || null,
            isActive: true,
            synthetic: true
          });
        }
      }

      const inProgress = tasks.filter(t => t.status === 'in-progress').length;
      const queued = tasks.filter(t => t.status === 'queued').length;
      const complete = tasks.filter(t => t.status === 'complete').length;

      res.writeHead(200, headers);
      res.end(JSON.stringify({ tasks, inProgress, queued, complete, brainMode, brainFocus, ts: now }));
    } catch(e) {
      res.writeHead(500); res.end(JSON.stringify({ error: e.message, tasks: [] }));
    }
    return;
  }

  // Static image files (PNG, JPG, ICO, etc.)
  const imageExts = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.ico': 'image/x-icon', '.svg': 'image/svg+xml', '.gif': 'image/gif', '.webp': 'image/webp' };
  const ext = require('path').extname(urlPath).toLowerCase();
  if (imageExts[ext]) {
    const imgPath = path.join(__dirname, urlPath);
    if (fs.existsSync(imgPath)) {
      const data = fs.readFileSync(imgPath);
      res.writeHead(200, { 'Content-Type': imageExts[ext], 'Cache-Control': 'public, max-age=86400' });
      res.end(data);
      return;
    }
  }

  res.writeHead(404); res.end('Not Found');
});

server.listen(PORT, () => console.log('Dashboard server on port ' + PORT));
