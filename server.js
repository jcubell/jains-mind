const http = require('http');
const fs = require('fs');
const path = require('path');

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

  res.writeHead(404); res.end('Not Found');
});

server.listen(PORT, () => console.log('Dashboard server on port ' + PORT));
