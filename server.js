const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { plan, declarations, confirm, image, slow, long, isLocal, HOME, groups, cleanOff, blocked, envWithKey, cleanSettings, cleanCharacter, memoryDir } = require('./tools');

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
let wokeAt = 0;

// Characters the user added live in characters/<id>/ as model.glb and character.json.
const CHARS = file('characters');
const charDir = id => /^[a-z0-9-]{1,40}$/.test(id) && path.join(CHARS, id);
function characters() {
  let ids = [];
  try { ids = fs.readdirSync(CHARS).filter(charDir); } catch {}
  return ids.filter(id => fs.existsSync(path.join(CHARS, id, 'model.glb'))).map(id => {
    let data = {};
    try { data = JSON.parse(fs.readFileSync(path.join(CHARS, id, 'character.json'), 'utf8')); } catch {}
    return { id, name: id, ...cleanCharacter(data), ...(fs.existsSync(path.join(CHARS, id, 'rig.glb')) ? { rig: true } : {}) };
  });
}
const tellPages = () => { for (const page of pages) page.write('event: settings\ndata: 1\n\n'); };

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
  const charRoute = route.match(/^\/characters\/([^/]+)(\/(model|rig)\.glb)?$/);   // rig.glb: the same model with bones
  if (req.method === 'GET' && route === '/characters') return json(res, 200, characters());
  if (req.method === 'GET' && charRoute?.[2]) {
    const dir = charDir(charRoute[1]);
    const glb = dir && path.join(dir, charRoute[3] + '.glb');
    if (!glb || !fs.existsSync(glb)) return json(res, 404, { error: 'not found' });
    res.writeHead(200, { 'content-type': 'model/gltf-binary' });
    return fs.createReadStream(glb).pipe(res);
  }
  if (req.method === 'POST' && route === '/characters') {   // body: the .glb file itself; ?name= its name
    const name = new URL(req.url, 'http://x').searchParams.get('name') || 'Watak';
    const id = (name.toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'watak')
      + '-' + Math.random().toString(36).slice(2, 6);
    const dir = path.join(CHARS, id), parts = [];
    let size = 0;
    req.on('data', c => { size += c.length; if (size > 200e6) req.destroy(); else parts.push(c); });
    req.on('end', () => {
      const glb = Buffer.concat(parts);
      if (glb.subarray(0, 4).toString() !== 'glTF') return json(res, 400, { error: 'Fail mesti model .glb' });
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'model.glb'), glb);
      fs.writeFileSync(path.join(dir, 'character.json'), JSON.stringify(cleanCharacter({ name })));
      tellPages();
      json(res, 200, { id });
    });
    return;
  }
  if (req.method === 'POST' && charRoute?.[3] === 'rig') {   // the same model with bones (for example Hyper3D's base.glb)
    const dir = charDir(charRoute[1]);
    if (!dir || !fs.existsSync(dir)) return json(res, 404, { error: 'not found' });
    const parts = [];
    let size = 0;
    req.on('data', c => { size += c.length; if (size > 200e6) req.destroy(); else parts.push(c); });
    req.on('end', () => {
      const glb = Buffer.concat(parts);
      if (glb.subarray(0, 4).toString() !== 'glTF') return json(res, 400, { error: 'Fail mesti model .glb' });
      fs.writeFileSync(path.join(dir, 'rig.glb'), glb);
      tellPages();
      json(res, 200, { result: 'ok' });
    });
    return;
  }
  if ((req.method === 'POST' || req.method === 'DELETE') && charRoute && !charRoute[2]) {
    const dir = charDir(charRoute[1]);
    if (!dir || !fs.existsSync(dir)) return json(res, 404, { error: 'not found' });
    if (req.method === 'DELETE') { fs.rmSync(dir, { recursive: true }); tellPages(); return json(res, 200, { result: 'ok' }); }
    let body = '';
    req.on('data', c => { body += c; if (body.length > 5000) req.destroy(); });
    req.on('end', () => {
      try {
        const now = characters().find(c => c.id === charRoute[1]);
        delete now.id;
        fs.writeFileSync(path.join(dir, 'character.json'), JSON.stringify({ ...now, ...cleanCharacter(JSON.parse(body)) }));
        tellPages();
        json(res, 200, { result: 'ok' });
      } catch (err) {
        json(res, 400, { error: err.message });
      }
    });
    return;
  }
  // Memory for a new session: everything Jarvis was asked to remember, and the end of the last conversations.
  if (req.method === 'GET' && route === '/memory') {
    const read = (f, parse) => { try { return parse(fs.readFileSync(path.join(memoryDir(), f), 'utf8')); } catch { return []; } };
    return json(res, 200, {
      facts: read('facts.json', JSON.parse).slice(-300).map(f => f.text),
      recent: read('history.jsonl', t => t.trim().split('\n').map(l => JSON.parse(l))).slice(-40),
    });
  }
  if (req.method === 'POST' && route === '/history') {
    let body = '';
    req.on('data', c => { body += c; if (body.length > 20000) req.destroy(); });
    req.on('end', () => {
      try {
        const { who, text } = JSON.parse(body);
        if (!['ANDA', 'JARVIS'].includes(who) || typeof text !== 'string' || !text.trim() || text.length > 10000) throw new Error('baris tidak sah');
        fs.mkdirSync(memoryDir(), { recursive: true });
        fs.appendFileSync(path.join(memoryDir(), 'history.jsonl'), JSON.stringify({ at: new Date().toISOString(), who, text: text.trim() }) + '\n');
        json(res, 200, { result: 'ok' });
      } catch (err) {
        json(res, 400, { error: err.message });
      }
    });
    return;
  }
  if (req.method === 'GET' && route === '/settings') {
    let saved = {};
    try { saved = cleanSettings(JSON.parse(fs.readFileSync(file('settings.json'), 'utf8'))); } catch {}
    return json(res, 200, saved);
  }
  if (req.method === 'POST' && route === '/settings') {
    let body = '';
    req.on('data', c => { body += c; if (body.length > 2000) req.destroy(); });
    req.on('end', () => {
      try {
        fs.writeFileSync(file('settings.json'), JSON.stringify(cleanSettings(JSON.parse(body))));
        tellPages();   // every other window reloads them
        json(res, 200, { result: 'ok' });
      } catch (err) {
        json(res, 400, { error: err.message });
      }
    });
    return;
  }
  if (req.method === 'POST' && route === '/wake') {   // only the first window that heard "Hai Jarvis" may start
    const go = Date.now() - wokeAt > 3000;
    if (go) wokeAt = Date.now();
    return json(res, 200, { go });
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
      execFile(cmd[0], cmd[1], { timeout: long.includes(name) ? 900000 : slow.includes(name) ? 120000 : 30000, maxBuffer: 16e6, cwd: HOME }, (err, out, stderr) =>
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
