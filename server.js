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

        // === Baseline delta: subtract snapshot if cost_baseline.json exists ===
        let baseline = null;
        try {
          const fs2 = require('fs');
          baseline = JSON.parse(fs2.readFileSync('/Users/jc_agent/.openclaw/workspace/dashboard/cost_baseline.json', 'utf8'));
        } catch(e) { baseline = null; }

        if (baseline) {
          dailyCost   = Math.max(0, rawDaily   - (baseline.total_daily   || 0));
          monthlyCost = Math.max(0, rawMonthly - (baseline.total_monthly || 0));
          weeklyCost  = Math.max(0, rawWeekly  - ((baseline.usage_weekly || 0) + (baseline.byok_usage_weekly || 0)));
        } else {
          dailyCost   = rawDaily;
          weeklyCost  = rawWeekly;
          monthlyCost = rawMonthly;
        }
        // Session cost = delta since baseline (same as daily delta when baseline is same-day)
        sessionCost = dailyCost;
        orSource = 'openrouter';
      }

      // === FALLBACK / MODEL BREAKDOWN: codexbar ===
      const codexbarBin = '/opt/homebrew/bin/codexbar';
      for (const provider of ['codex', 'claude']) {
        let raw;
        try {
          raw = execSync(`${codexbarBin} cost --format json --provider ${provider}`, { timeout: 8000 }).toString();
        } catch (e) { continue; }
        let parsed;
        try { parsed = JSON.parse(raw); } catch(e) { continue; }
        const entries = Array.isArray(parsed) ? parsed : [parsed];
        for (const entry of entries) {
          // If OR API failed, fall back to codexbar for cost totals
          if (orSource === 'codexbar') {
            if (entry.last30DaysCostUSD) dailyCost += entry.last30DaysCostUSD;
            const todayStr = new Date().toLocaleDateString('en-CA');
            let foundToday = false;
            for (const day of (entry.daily || [])) {
              if (day.date === todayStr) { sessionCost += day.totalCost || 0; totalTokens += day.totalTokens || 0; foundToday = true; }
            }
            if (!foundToday && entry.sessionCostUSD) sessionCost += entry.sessionCostUSD;
          }
          // Always use codexbar for per-model breakdown
          for (const day of (entry.daily || [])) {
            const breakdowns = day.modelBreakdowns || [];
            const dayTokens = day.totalTokens || 0;
            const numModels = breakdowns.length || 1;
            for (const mb of breakdowns) {
              const name = normalizeModelName((mb.modelName || '').trim());
              if (!name) continue;
              if (!allModels[name]) allModels[name] = { model: name, cost: 0, tokens: 0, days: 0 };
              allModels[name].cost += mb.cost || 0;
              const dayCost = day.totalCost || 0;
              if (dayCost > 0 && mb.cost > 0) {
                allModels[name].tokens += Math.round(dayTokens * (mb.cost / dayCost));
              } else {
                allModels[name].tokens += Math.round(dayTokens / numModels);
              }
              allModels[name].days += 1;
            }
          }
        }
      }

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

  // /cron-status — list openclaw scheduled jobs
  if (urlPath === '/cron-status') {
    const { exec } = require('child_process');
    exec('openclaw cron list --json', (err, stdout, stderr) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      if (err) return res.end(JSON.stringify({ error: 'unavailable', jobs: [] }));
      try {
        const jobs = JSON.parse(stdout);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ jobs }));
      } catch(e) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'parse_error', jobs: [], raw: stdout.slice(0, 500) }));
      }
    });
    return;
  }

  res.writeHead(404); res.end('Not Found');
});

server.listen(PORT, () => console.log('Dashboard server on port ' + PORT));
