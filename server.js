const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { plan, declarations, confirm, image, slow, isLocal, HOME, groups, cleanOff, blocked, envWithKey } = require('./tools');

const PORT = +process.env.PORT || 4199;
const file = f => path.join(__dirname, f);
const HTML = 'text/html; charset=utf-8';
const STATIC = {
  '/': ['index.html', HTML],
  '/facepoly': ['facepoly/index.html', HTML],
  '/head': ['head/index.html', HTML],
  '/head/model.glb': ['head/model.glb', 'model/gltf-binary'],
};

// Read on every request so editing .env needs no restart.
function env() {
  let text = '';
  try { text = fs.readFileSync(file('.env'), 'utf8'); } catch {}
  return Object.fromEntries([...text.matchAll(/^(\w+)=(.*)$/gm)].map(m => [m[1], m[2].trim()]));
}

// Groups the user switched off in Settings. Kept on disk so the choice survives restarts and is enforced here, not in the page.
function off() {
  try { return cleanOff(JSON.parse(fs.readFileSync(file('permissions.json'), 'utf8')).off); } catch { return []; }
}

const pages = new Set();

const json = (res, code, body) => {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};

http.createServer((req, res) => {
  if (!isLocal(req.headers, PORT)) return json(res, 403, { error: 'forbidden' });
  const route = req.url.split('?')[0];

  if (req.method === 'GET' && STATIC[route]) {
    res.writeHead(200, { 'content-type': STATIC[route][1] });
    return fs.createReadStream(file(STATIC[route][0])).pipe(res);
  }
  if (req.method === 'GET' && route === '/config') {
    const e = env();
    return json(res, 200, {
      key: e.GEMINI_API_KEY || '',
      model: e.MODEL || 'gemini-3.8-live',
      voice: e.VOICE || 'Fenrir',
      tools: declarations.filter(d => !blocked(off()).has(d.name)),
      confirm,
      groups: groups.map(g => ({ id: g.id, label: g.label, count: g.tools.length, on: !off().includes(g.id),
        tools: g.tools.map(name => declarations.find(d => d.name === name).description) })),
    });
  }
  // Every open Jarvis page listens here; when one starts a session the others are told to stop theirs.
  if (req.method === 'GET' && route === '/events') {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
    res.write(':\n\n');
    pages.add(res);
    req.on('close', () => pages.delete(res));
    return;
  }
  if (req.method === 'POST' && route === '/claim') {
    let body = '';
    req.on('data', c => { body += c; if (body.length > 100) req.destroy(); });
    req.on('end', () => {
      const id = body.replace(/[^a-z0-9]/g, '');
      for (const page of pages) page.write(`data: ${id}\n\n`);
      json(res, 200, { result: 'ok' });
    });
    return;
  }
  if (req.method === 'POST' && route === '/key') {
    let body = '';
    req.on('data', c => { body += c; if (body.length > 2000) req.destroy(); });
    req.on('end', () => {
      try {
        let text = '';
        try { text = fs.readFileSync(file('.env'), 'utf8'); } catch {}
        fs.writeFileSync(file('.env'), envWithKey(text, JSON.parse(body).key), { mode: 0o600 });
        json(res, 200, { result: 'ok' });
      } catch (err) {
        json(res, 400, { error: err.message });
      }
    });
    return;
  }
  if (req.method === 'POST' && route === '/permissions') {
    let body = '';
    req.on('data', c => { body += c; if (body.length > 2000) req.destroy(); });
    req.on('end', () => {
      try {
        const list = cleanOff(JSON.parse(body).off);
        fs.writeFileSync(file('permissions.json'), JSON.stringify({ off: list }));
        json(res, 200, { off: list });
      } catch (err) {
        json(res, 400, { error: err.message });
      }
    });
    return;
  }
  if (req.method === 'POST' && route === '/tool') {
    let body = '';
    req.on('data', c => { body += c; if (body.length > 10000) req.destroy(); });
    req.on('end', () => {
      let cmd, name;
      try {
        let args, confirmed;
        ({ name, args, confirmed } = JSON.parse(body));
        if (confirm.includes(name) && confirmed !== true) throw new Error('perlu pengesahan pengguna di skrin');
        if (blocked(off()).has(name)) throw new Error('Pengguna telah mematikan kebenaran untuk alat ini di Tetapan.');
        cmd = plan(name, args);
      } catch (err) {
        return json(res, 400, { error: err.message });
      }
      execFile(cmd[0], cmd[1], { timeout: slow.includes(name) ? 120000 : 30000, maxBuffer: 16e6, cwd: HOME }, (err, out, stderr) =>
        json(res, 200, err ? { error: err.killed
            ? 'Masa tamat. macOS mungkin sedang menunggu pengguna tekan Allow pada tetingkap kebenaran.'
            : (stderr.trim() || 'arahan gagal, kod ' + err.code).slice(0, 500) }
          : image.includes(name) ? { image: out.replace(/\s/g, '') }
          : { result: out.trim().slice(0, 8000) || 'ok' }));
    });
    return;
  }
  json(res, 404, { error: 'not found' });
}).listen(PORT, '127.0.0.1', () => console.log(`Jarvis: http://localhost:${PORT}`));
