// Tidy loose files into project and company folders, the way the owner already keeps them.
//   node organize.js plan [folder...]        numbered moves for the loose items (Desktop and Downloads by default)
//   node organize.js apply [numbers|semua]   carries out the last plan (no file is ever overwritten), logged
//   node organize.js undo                    moves the last batch back where it came from
//   node organize.js rule <words> <folder>   learn: names containing these words go to this folder
// Destinations are found, not hard-coded: ~/Claude/_Dokumen/<Project>, ~/Syarikat/<Company>/{Dokumen,Media},
// ~/Syarikat/Media Umum/{Tangkap Layar,Rakaman Skrin}, plus rules the owner taught.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const HOME = process.env.JARVIS_ORGANIZE_HOME || os.homedir();
const MEM = process.env.JARVIS_MEMORY || path.join(__dirname, 'memory');
const RULES = path.join(MEM, 'organize-rules.json');
const PLAN = path.join(MEM, 'organize-plan.json');
const LAST = path.join(MEM, 'organize-last.json');
const LOG = path.join(HOME, 'Syarikat', '_log-pindahan.tsv');
const MEDIA = /\.(png|jpe?g|gif|webp|heic|mov|mp4|m4a|mp3|wav)$/i;
const read = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const norm = s => s.toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, ' ').trim();
const dirs = p => { try { return fs.readdirSync(p, { withFileTypes: true }).filter(d => d.isDirectory() && !d.name.startsWith('.')).map(d => d.name); } catch { return []; } };
// Words too common to say which company or project a file belongs to.
const COMMON = new Set(['studio', 'travel', 'tours', 'app', 'apps', 'android', 'web', 'site', 'lain', 'dokumen', 'media', 'umum', 'bank', 'brothers', 'the', 'and']);
// Words that appear in all sorts of file names, so they say nothing about where a file belongs.
const VAGUE = new Set(['document', 'dokumen', 'salinan', 'screenshot', 'gambar', 'image', 'images', 'scanned', 'final', 'update', 'information', 'result',
  'proposal', 'cadangan', 'borang', 'senarai', 'declaration', 'company', 'profile', 'invoice', 'invois', 'resit', 'receipt', 'report', 'laporan',
  'desktop', 'downloads', 'copy', 'bulanan', 'mingguan', 'tahunan', 'january', 'february', 'november', 'december', 'october', 'september']);
// Office papers and pictures belong to the company; notes, data and builds belong to the project (when both names match).
const PAPER = /\.(pdf|docx?|xlsx?|pptx?|csv|png|jpe?g|heic|webp|mov|mp4|eml)$/i;

function rules() {
  const out = read(RULES, []).map(r => ({ ...r, words: r.words.map(norm), why: 'peraturan Tuan' }));
  for (const p of dirs(path.join(HOME, 'Claude', '_Dokumen')).filter(n => n !== 'Lain')) {
    out.push({ words: [norm(p), norm(p).replace(/ /g, '')], to: path.join(HOME, 'Claude', '_Dokumen', p), why: 'projek ' + p });
  }
  for (const c of dirs(path.join(HOME, 'Syarikat')).filter(n => !['Media Umum', 'Peribadi'].includes(n))) {
    const words = norm(c).split(' ').filter(w => w.length >= 4 && !COMMON.has(w));
    if (words.length) out.push({ words, to: path.join(HOME, 'Syarikat', c), company: true, why: 'syarikat ' + c });
  }
  return out;
}

// Where one loose item should go, or null. The longest matching word wins, so "kendurikita" beats "kenduri".
function place(name, list, known = new Map(), isFile = true) {
  const n = norm(name), flat = n.replace(/ /g, '');
  let best = null;
  for (const r of list) for (const w of r.words) {
    if (!(w.length >= 3 && (` ${n} `.includes(` ${w} `) || (w.length >= 6 && flat.includes(w.replace(/ /g, '')))))) continue;
    const tie = best && w.length === best.len && !!r.company !== !!best.company && (r.company ? PAPER.test(name) : !PAPER.test(name));
    if (!best || w.length > best.len || tie || (r.why === 'peraturan Tuan' && w.length >= best.len)) best = { ...r, len: w.length, word: w };
  }
  if (best) {
    let to = best.to;
    if (best.company) to = path.join(to, MEDIA.test(name) && fs.existsSync(path.join(to, 'Media')) ? 'Media' : 'Dokumen');
    return { to, why: `${best.why} ("${best.word}")` };
  }
  const umum = path.join(HOME, 'Syarikat', 'Media Umum');
  if (/^(screenshot|screen shot|tangkap layar|photo |pasted )/i.test(name) && /\.(png|jpe?g|heic|webp)$/i.test(name)) return { to: path.join(umum, 'Tangkap Layar'), why: 'tangkapan skrin' };
  if (/^(screen recording|rakaman)/i.test(name) && MEDIA.test(name)) return { to: path.join(umum, 'Rakaman Skrin'), why: 'rakaman skrin' };
  // Last, a guess from the files already filed: a distinctive word (an account number, a client name) that only one folder has.
  if (!isFile) return null;                    // folders are never guessed; they hold many things
  const hits = new Map();
  for (const w of n.split(' ')) for (const f of known.get(w) || []) hits.set(f, (hits.get(f) || 0) + 1);
  const top = [...hits].sort((a, b) => b[1] - a[1])[0];
  return top ? { to: top[0], why: 'teka: nama mirip fail yang sudah ada di sana' } : null;
}

// word -> the one folder whose existing files use it (words used in several folders are dropped)
function learn(list) {
  const seen = new Map(), folders = new Set();
  for (const r of list) for (const sub of r.company ? ['Dokumen', 'Media'] : ['']) folders.add(path.join(r.to, sub));
  for (const f of folders) {
    let names = [];
    try { names = fs.readdirSync(f).slice(0, 800); } catch { continue; }
    for (const nm of names) for (const w of new Set(norm(nm).split(' '))) {
      // only telling words: 8+ letters, or a long number such as an account or reference number
      if (w.length < 8 || VAGUE.has(w) || COMMON.has(w) || /^20\d\d/.test(w)) continue;
      if (!seen.has(w)) seen.set(w, new Set());
      seen.get(w).add(f);
    }
  }
  return new Map([...seen].filter(([, set]) => set.size === 1).map(([w, set]) => [w, [...set]]));
}

function plan(folders) {
  const list = rules(), known = learn(list), moves = [], unsure = [];
  for (const f of folders.length ? folders : [path.join(HOME, 'Desktop'), path.join(HOME, 'Downloads')]) {
    for (const d of fs.existsSync(f) ? fs.readdirSync(f, { withFileTypes: true }) : []) {
      const from = path.join(f, d.name);
      // Leave apps, hidden files, unfinished downloads and project folders (git repositories) where they are.
      if (d.name.startsWith('.') || /\.(app|download|crdownload|part)$/i.test(d.name) || fs.existsSync(path.join(from, '.git'))) continue;
      const p = place(d.name, list, known, d.isFile());
      if (p && path.dirname(from) !== p.to) moves.push({ from, to: p.to, why: p.why }); else if (!p) unsure.push(from);
    }
  }
  fs.mkdirSync(MEM, { recursive: true });
  fs.writeFileSync(PLAN, JSON.stringify(moves, null, 1));
  const short = p => p.replace(HOME, '~');
  return (moves.length ? moves.map((m, i) => `${i + 1}. ${short(m.from)}  ->  ${short(m.to)}/  [${m.why}]`).join('\n') : 'Tiada fail yang boleh disusun secara automatik.')
    + (unsure.length ? `\n\nTidak pasti (${unsure.length}), tanya Tuan atau ajar dengan peraturan baharu:\n` + unsure.slice(0, 40).map(short).join('\n') : '');
}

// "1,3,5-9" -> [0,2,4..8]; "semua" or nothing -> every move
function pick(spec, n) {
  if (!spec || /^(semua|all)$/i.test(spec.trim())) return [...Array(n).keys()];
  const out = new Set();
  for (const part of spec.split(',')) {
    const [a, b] = part.split('-').map(x => parseInt(x, 10));
    if (!a) throw new Error('nombor tidak sah: ' + part);
    for (let i = a; i <= (b || a); i++) if (i >= 1 && i <= n) out.add(i - 1);
  }
  return [...out];
}

function apply(spec) {
  const moves = read(PLAN, []), done = [], skipped = [];
  if (!moves.length) return 'Tiada pelan. Buat pelan dahulu.';
  for (const i of pick(spec, moves.length)) {
    const m = moves[i], dest = path.join(m.to, path.basename(m.from));
    if (!fs.existsSync(m.from)) { skipped.push(`${m.from} (sudah tiada)`); continue; }
    if (fs.existsSync(dest)) { skipped.push(`${m.from} (sudah ada fail sama nama di destinasi)`); continue; }   // never overwrite
    fs.mkdirSync(m.to, { recursive: true });
    fs.renameSync(m.from, dest);
    done.push({ from: m.from, to: dest });
  }
  fs.writeFileSync(LAST, JSON.stringify(done, null, 1));
  fs.writeFileSync(PLAN, '[]');
  if (done.length) { fs.mkdirSync(path.dirname(LOG), { recursive: true }); fs.appendFileSync(LOG, done.map(d => `${d.from}\t${d.to}`).join('\n') + '\n'); }
  return `${done.length} item dialih.` + (skipped.length ? `\nDilangkau (${skipped.length}):\n${skipped.join('\n')}` : '') + '\nBoleh dibatalkan dengan organize_undo.';
}

function undo() {
  const last = read(LAST, []), back = [];
  for (const d of last.reverse()) {
    if (fs.existsSync(d.to) && !fs.existsSync(d.from)) { fs.renameSync(d.to, d.from); back.push(d.from); }
  }
  fs.writeFileSync(LAST, '[]');
  return back.length ? `${back.length} item dikembalikan ke tempat asal.` : 'Tiada pindahan untuk dibatalkan.';
}

function rule(words, to) {
  to = path.resolve(to.replace(/^~(?=\/|$)/, HOME));
  if (!to.startsWith(HOME + path.sep)) throw new Error('folder mesti dalam folder pengguna');
  const list = read(RULES, []).filter(r => r.to !== to || norm(r.words.join(' ')) !== norm(words));
  list.push({ words: words.split(',').map(w => w.trim()).filter(Boolean), to });
  fs.mkdirSync(MEM, { recursive: true });
  fs.writeFileSync(RULES, JSON.stringify(list, null, 1));
  return `Diingat: nama yang mengandungi "${words}" pergi ke ${to.replace(HOME, '~')}`;
}

if (require.main === module) {
  const [cmd, ...a] = process.argv.slice(2);
  try {
    console.log(cmd === 'plan' ? plan(a) : cmd === 'apply' ? apply(a[0]) : cmd === 'undo' ? undo() : cmd === 'rule' ? rule(a[0], a[1]) : 'guna: plan | apply | undo | rule');
  } catch (err) { console.log('Ralat: ' + err.message); process.exitCode = 1; }
}
module.exports = { place, norm, pick };
