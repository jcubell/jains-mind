const http = require('http');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const PORT = 3000;
const HTML_FILE = path.join(__dirname, 'widget.html');
const STATE_FILE = path.join(__dirname, 'state.json');

const server = http.createServer((req, res) => {
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

  // /or-cost-summary — aggregates codexbar cost data from codex + claude providers
  if (urlPath === '/or-cost-summary') {
    try {
      const allModels = {};
      let sessionCost = 0;  // today's cost only
      let dailyCost = 0;    // last30Days aggregate (all sessions)
      let totalTokens = 0;

      const codexbarBin = '/opt/homebrew/bin/codexbar';
      for (const provider of ['codex', 'claude']) {
        let raw;
        try {
          raw = execSync(`${codexbarBin} cost --format json --provider ${provider}`, { timeout: 8000 }).toString();
        } catch (e) {
          continue; // provider not available, skip
        }
        let parsed;
        try { parsed = JSON.parse(raw); } catch(e) { continue; }
        const entries = Array.isArray(parsed) ? parsed : [parsed];
        for (const entry of entries) {
          // Daily (aggregate) cost = last30DaysCostUSD — the full spend across all sessions
          if (entry.last30DaysCostUSD) dailyCost += entry.last30DaysCostUSD;

          const daily = entry.daily || [];

          // Session cost = today's daily entries only (distinct from all-time aggregate)
          const todayStr = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD in local time
          for (const day of daily) {
            if (day.date === todayStr) {
              sessionCost += day.totalCost || 0;
              totalTokens += day.totalTokens || 0;
            }
          }

          // Per-model breakdown from all daily entries (for model breakdown widget)
          for (const day of daily) {
            const breakdowns = day.modelBreakdowns || [];
            const dayTokens = day.totalTokens || 0;
            const numModels = breakdowns.length || 1;
            for (const mb of breakdowns) {
              const name = normalizeModelName((mb.modelName || '').trim());
              if (!name) continue;
              if (!allModels[name]) allModels[name] = { model: name, cost: 0, tokens: 0, days: 0 };
              allModels[name].cost += mb.cost || 0;
              // Distribute day tokens proportionally by cost (or equally if no cost data)
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

      // Compute total cost and pct; rename days→count for backward compat
      const modelList = Object.values(allModels);
      const totalCost = modelList.reduce((s, m) => s + m.cost, 0);
      for (const m of modelList) {
        m.pct = totalCost > 0 ? Math.round((m.cost / totalCost) * 100) : 0;
        m.count = m.days; // backward compat alias
        delete m.days;
      }
      modelList.sort((a, b) => b.cost - a.cost);

      const result = {
        session: { est_cost: sessionCost, pushes: 0 },
        daily: { est_cost: dailyCost, actual_or: null, source: 'codexbar' },
        monthly: { actual_or: null },
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

  res.writeHead(404); res.end('Not Found');
});

server.listen(PORT, () => console.log('Dashboard server on port ' + PORT));
