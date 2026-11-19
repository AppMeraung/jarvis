// Every tool maps a model call to one fixed command, run with execFile (no shell).
// AppleScript never has model text spliced into it: values travel as argv ("on run argv").
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const HOME = os.homedir();
const APP = /^[\p{L}\p{N}][\p{L}\p{N} .+&-]{0,59}$/u;

const bad = msg => { throw new Error(msg); };
const app = v => (typeof v === 'string' && APP.test(v) ? v : bad('nama aplikasi tidak sah'));
const text = (v, max = 2000) => (typeof v === 'string' && v.trim() && v.length <= max ? v : bad('teks kosong atau terlalu panjang'));
const pick = (v, list) => (list.includes(v) ? v : bad('pilihan: ' + list.join(', ')));
const bool = v => (v === true || v === 'true' ? true : v === false || v === 'false' ? false : bad('mesti true atau false'));
const int = (v, lo, hi) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= lo && n <= hi ? n : bad(`nombor mesti ${lo}-${hi}`);
};
const email = v => (typeof v === 'string' && /^[^\s@<>"?&]+@[^\s@<>"?&]+\.[^\s@<>"?&]+$/.test(v) ? v : bad('alamat email tidak sah'));
const when = v => {
  const m = typeof v === 'string' && /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d)/.exec(v);
  return m && !isNaN(new Date(v.slice(0, 16))) ? m.slice(1, 6).map(Number) : bad('masa mesti format YYYY-MM-DDTHH:MM');
};
function webUrl(v) {
  let u;
  try { u = new URL(v); } catch { bad('URL tidak sah'); }
  return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : bad('hanya http/https dibenarkan');
}

// A phone number for WhatsApp: digits only with the country code; a Malaysian 01x number becomes 601x.
function phone(v) {
  const d = String(v ?? '').replace(/[\s\-()+]/g, '');
  if (!/^\d{8,15}$/.test(d)) bad('nombor telefon tidak sah, cth. 0123456789 atau 60123456789');
  return d.startsWith('0') ? '6' + d : d;
}
const isoDate = v => /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : bad('tarikh mesti YYYY-MM-DD');

const osa = (script, ...args) => ['osascript', ['-e', script, '--', ...args.map(String)]];
const q = s => encodeURIComponent(s);

// Builds an AppleScript date from five argv items (y, m, d, h, min) starting at index i.
const MK = `
on mk(a, i)
set s to current date
set day of s to 1
set year of s to (item i of a) as integer
set month of s to (item (i + 1) of a) as integer
set day of s to (item (i + 2) of a) as integer
set time of s to ((item (i + 3) of a) as integer) * hours + ((item (i + 4) of a) as integer) * minutes
return s
end mk`;

// shortcut: blocks keystrokes into known terminals/IDEs by process name, switch to bundle ids if one slips through
const KEYGUARD = `tell application "System Events"
set f to name of first process whose frontmost is true
if f is in {"Terminal", "iTerm2", "Warp", "kitty", "Alacritty", "Ghostty", "Code", "Cursor", "Xcode", "stable"} then error "Tidak boleh menaip dalam " & f`;

const cmd = (k, ...mods) => `keystroke "${k}" using {${['command', ...mods].map(m => m + ' down').join(', ')}}`;
const KEYS = {
  return: 'key code 36', tab: 'key code 48', escape: 'key code 53', space: 'key code 49', delete: 'key code 51',
  up: 'key code 126', down: 'key code 125', left: 'key code 123', right: 'key code 124',
  page_up: 'key code 116', page_down: 'key code 121',
  copy: cmd('c'), paste: cmd('v'), cut: cmd('x'), undo: cmd('z'), select_all: cmd('a'), save: cmd('s'), find: cmd('f'),
  new_tab: cmd('t'), new_window: cmd('n'), close_window: cmd('w'), refresh: cmd('r'), minimize: cmd('m'),
  fullscreen: cmd('f', 'control'), zoom_in: cmd('='), zoom_out: cmd('-'),
  switch_app: 'key code 48 using command down', spotlight: 'key code 49 using command down',
  brightness_up: 'key code 144', brightness_down: 'key code 145',
};

const PLAYERS = ['Spotify', 'Music'];
const MEDIA = { play: 'play', pause: 'pause', playpause: 'playpause', next: 'next track', previous: 'previous track' };
const FOLDERS = { Desktop: 'Desktop', Downloads: 'Downloads', Documents: 'Documents', Pictures: 'Pictures',
  Music: 'Music', Movies: 'Movies', Home: '', Applications: '/Applications' };
// Only document-like files: "open" on a script or app would execute it.
const SAFE_EXT = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'md', 'csv', 'rtf', 'pages', 'numbers', 'key',
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'svg', 'mp3', 'm4a', 'wav', 'mp4', 'mov', 'zip'];

const S = d => ({ type: 'STRING', description: d });
const N = d => ({ type: 'NUMBER', description: d });
const B = d => ({ type: 'BOOLEAN', description: d });

// Loads a URL in the Chrome tab that already shows the same site, so repeated searches do not pile up tabs.
// Without Chrome the default browser opens it. $1 = url, $2 = site, $3 = the AppleScript below.
const REUSE_TAB = `on run argv
  set u to item 1 of argv
  set site to item 2 of argv
  tell application "Google Chrome"
    activate
    repeat with w in (windows whose mode is "normal")
      set i to 0
      repeat with t in tabs of w
        set i to i + 1
        if URL of t contains site then
          set URL of t to u
          set active tab index of w to i
          set index of w to 1
          return "Dimuat dalam tab sedia ada"
        end if
      end repeat
    end repeat
    if (count of (windows whose mode is "normal")) is 0 then
      make new window
      -- Chrome started by a script with several profiles can refuse to open a window; say so instead of pretending
      if (count of windows) is 0 then error "Chrome tidak dapat membuka tetingkap. Minta pengguna buka Chrome dahulu."
      set URL of active tab of front window to u
    else
      tell (first window whose mode is "normal") to make new tab with properties {URL:u}
    end if
    return "Dibuka dalam tab baharu"
  end tell
end run`;
// play: look up the first real video of a YouTube search (sponsored slots are not "videoRenderer") and open it, so it starts
// by itself. shortcut: reads YouTube's page markup, falls back to the search page when that changes.
const browse = (url, site, play = '') => ['/bin/zsh', ['-c', `u="$1"
if [ -n "$4" ]; then
  id=$(curl -fsL -m 8 -A "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36" "$1" | grep -o '"videoRenderer":{"videoId":"[A-Za-z0-9_-]\\{11\\}"' | head -1 | cut -d'"' -f6)
  if [ -n "$id" ]; then u="https://www.youtube.com/watch?v=$id"; echo "Video pertama sedang dimainkan."; else echo "Video tidak dapat dipilih secara automatik; halaman carian dibuka."; fi
fi
# A closed Chrome is started the normal way: started by AppleScript it can come up with no window at all.
if [ ! -d "/Applications/Google Chrome.app" ]; then open "$u" && echo "Dibuka dalam browser"
elif pgrep -xq "Google Chrome"; then osascript -e "$3" -- "$u" "$2"
else open -a "Google Chrome" "$u" && echo "Chrome dibuka dengan halaman itu"; fi`, 'jarvis', url, site, REUSE_TAB, play]];

// Background search in Wikipedia (Malay and English) and Malay Wikisource (old hikayat texts), without the browser.
// These are free, stable and openly licensed; general web search engines block automated requests. argv: query.
const SEARCH = `(async () => {
  const q = process.argv[1];
  const sites = ['ms.wikipedia.org', 'en.wikipedia.org', 'ms.wikisource.org'];
  const found = await Promise.all(sites.map(site => fetch('https://' + site + '/w/api.php?action=query&list=search&format=json&srlimit=4&srsearch=' + encodeURIComponent(q),
    { headers: { 'user-agent': 'JarvisMac/1.0' }, signal: AbortSignal.timeout(15000) }).then(r => r.json())
    .then(j => j.query.search.map(h => h.title + '\\n' + 'https://' + site + '/wiki/' + encodeURIComponent(h.title.replace(/ /g, '_')) + '\\n' + h.snippet.replace(/<[^>]+>/g, '').replace(/&quot;/g, '"')))
    .catch(() => [])));
  console.log(found.flat().join('\\n\\n') || 'Tiada hasil.');
})()`;

// Live world information from free services that need no key. curl fetches; Node turns the reply into short text.
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)';
const NEWS = `(async () => {
  let x = '';
  for await (const c of process.stdin) x += c;
  const tag = (s, t) => (s.match(new RegExp('<' + t + '[^>]*>([\\\\s\\\\S]*?)</' + t + '>')) || [])[1] || '';
  const plain = s => s.replace(/<!\\\\[CDATA\\\\[|\\\\]\\\\]>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
  const items = x.split('<item>').slice(1, 11).map(i => plain(tag(i, 'title')) + ' (' + new Date(tag(i, 'pubDate')).toLocaleDateString('ms-MY') + ')');
  console.log(items.join('\\n') || 'Tiada berita dijumpai.');
})()`;
const RATES = `(async () => {
  let x = '';
  for await (const c of process.stdin) x += c;
  const j = JSON.parse(x), want = process.argv[1].split(',');
  if (j.result !== 'success') throw new Error('kadar tidak dapat dibaca');
  const amount = +process.argv[2];
  console.log(want.filter(c => j.rates[c]).map(c => amount + ' ' + j.base_code + ' = ' + +(amount * j.rates[c]).toFixed(4) + ' ' + c).join('\\n')
    + '\\nKemas kini: ' + j.time_last_update_utc + '. Kadar oleh ExchangeRate-API.');
})()`;
const currency = v => /^[A-Za-z]{3}$/.test(v) ? v.toUpperCase() : bad('kod mata wang tiga huruf, cth. MYR, USD, SGD');

// Code: a path inside the user's folder, never a secrets file (its contents would be sent to Gemini).
function codePath(v, dir = false) {
  const p = path.resolve(text(v, 1000).replace(/^~(?=\/|$)/, HOME));
  if (!p.startsWith(HOME + path.sep)) bad('mesti dalam folder pengguna');
  if (/(^|\/)(\.env[^/]*|id_rsa[^/]*|id_ed25519[^/]*|[^/]*\.(pem|key|p12|keystore|jks)|credentials[^/]*|secrets?[^/]*)$/i.test(p)) bad('fail rahsia (kunci, kata laluan) tidak dibaca');
  let st;
  try { st = fs.statSync(p); } catch { bad('tidak dijumpai: ' + p); }
  if (dir ? !st.isDirectory() : !st.isFile()) bad(dir ? 'bukan folder' : 'bukan fail');
  return p;
}
const READ_CODE = `const t = require('fs').readFileSync(process.argv[1]);
if (t.length > 2e6 || t.includes(0)) { console.log('Fail terlalu besar atau bukan teks.'); process.exit(); }
const lines = t.toString('utf8').split('\\n'), from = Math.max(1, +process.argv[2] || 1), to = Math.min(lines.length, +process.argv[3] || from + 299);
console.log(lines.length + ' baris. Baris ' + from + ' hingga ' + to + ':\\n' + lines.slice(from - 1, to).map((l, i) => (from + i) + '  ' + l).join('\\n'));`;
const CHECK_CODE = `const { spawnSync } = require('child_process'), f = process.argv[1], ext = require('path').extname(f).toLowerCase();
const py = 'import ast,sys; ast.parse(open(sys.argv[1], encoding="utf-8").read(), sys.argv[1])';
const how = { '.js': [process.execPath, ['--check', f]], '.mjs': [process.execPath, ['--check', f]], '.cjs': [process.execPath, ['--check', f]],
  '.py': ['/usr/bin/python3', ['-c', py, f]], '.swift': ['/usr/bin/swiftc', ['-parse', f]], '.rb': ['/usr/bin/ruby', ['-c', f]],
  '.sh': ['/bin/bash', ['-n', f]], '.bash': ['/bin/bash', ['-n', f]], '.zsh': ['/bin/zsh', ['-n', f]] }[ext];
if (ext === '.json') { try { JSON.parse(require('fs').readFileSync(f, 'utf8')); console.log('Tiada ralat: JSON sah.'); } catch (e) { console.log('Ralat JSON: ' + e.message); } process.exit(); }
if (!how) { console.log('Semakan sintaks untuk ' + (ext || 'fail ini') + ' belum disokong. Baca dengan read_code dan semak sendiri, atau guna code_agent.'); process.exit(); }
const r = spawnSync(how[0], how[1], { encoding: 'utf8', timeout: 60000 });
console.log(r.status === 0 ? 'Tiada ralat sintaks.' : ('Ralat:\\n' + (r.stderr || r.stdout)).slice(0, 4000));`;
const CODE_SEARCH = `(async () => {
  const q = encodeURIComponent(process.argv[1]), get = u => fetch(u, { headers: { 'user-agent': 'JarvisMac/1.0' }, signal: AbortSignal.timeout(15000) }).then(r => r.json()).catch(() => ({}));
  const [so, mdn] = await Promise.all([get('https://api.stackexchange.com/2.3/search/advanced?order=desc&sort=relevance&site=stackoverflow&pagesize=6&q=' + q),
    get('https://developer.mozilla.org/api/v1/search?locale=en-US&q=' + q)]);
  const plain = s => s.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  const out = (so.items || []).map(i => 'Stack Overflow: ' + plain(i.title) + ' (' + i.score + ' undi' + (i.is_answered ? ', ada jawapan' : '') + ')\\n' + i.link)
    .concat((mdn.documents || []).slice(0, 4).map(d => 'MDN: ' + d.title + '\\nhttps://developer.mozilla.org' + d.mdn_url + '\\n' + d.summary));
  console.log(out.join('\\n\\n') || 'Tiada hasil.');
})()`;

// Memory, kept on this Mac only: facts.json (what Jarvis was asked to remember) and history.jsonl (every conversation).
const memoryDir = () => process.env.JARVIS_MEMORY || path.join(__dirname, 'memory');
const REMEMBER = `const fs = require('fs'), dir = process.argv[1], f = dir + '/facts.json', fact = process.argv[2].trim();
fs.mkdirSync(dir, { recursive: true });
let facts = []; try { facts = JSON.parse(fs.readFileSync(f, 'utf8')); } catch {}
if (facts.some(x => x.text.toLowerCase() === fact.toLowerCase())) { console.log('Sudah diingat.'); process.exit(); }
facts.push({ text: fact, at: new Date().toISOString() });
fs.writeFileSync(f, JSON.stringify(facts.slice(-500), null, 1));
console.log('Diingat: ' + fact);`;
const FORGET = `const fs = require('fs'), f = process.argv[1] + '/facts.json', what = process.argv[2].toLowerCase();
let facts = []; try { facts = JSON.parse(fs.readFileSync(f, 'utf8')); } catch {}
const keep = facts.filter(x => !x.text.toLowerCase().includes(what)), gone = facts.length - keep.length;
if (gone) fs.writeFileSync(f, JSON.stringify(keep, null, 1));
console.log(gone ? gone + ' perkara dilupakan.' : 'Tiada perkara yang sepadan.');`;
// Past conversations: lines that share the most words with the question, with their date, newest first on a tie.
const RECALL = `const fs = require('fs'), words = process.argv[2].toLowerCase().split(/\\\\W+/u).filter(w => w.length > 2);
let lines = []; try { lines = fs.readFileSync(process.argv[1] + '/history.jsonl', 'utf8').trim().split('\\n').map(l => JSON.parse(l)); } catch {}
const hits = lines.map((l, i) => ({ l, i, n: words.filter(w => l.text.toLowerCase().includes(w)).length })).filter(h => h.n)
  .sort((a, b) => b.n - a.n || b.i - a.i).slice(0, 15).sort((a, b) => a.i - b.i);
console.log(hits.map(h => new Date(h.l.at).toLocaleString('ms-MY') + ' ' + h.l.who + ': ' + h.l.text.slice(0, 400)).join('\\n') || 'Tiada perbualan lama yang sepadan.');`;

// A second brain for hard questions: Claude Code answers in an empty folder, with web search, and cannot touch files.
const ASK_CLAUDE = 'd=$(mktemp -d); cd "$d"; for c in "$HOME/.local/bin/claude" /opt/homebrew/bin/claude /usr/local/bin/claude; do [ -x "$c" ] && { "$c" -p "$1" --allowedTools "WebSearch,WebFetch" --disallowedTools "Bash,Edit,Write,Read,Grep,Glob,NotebookEdit" --output-format text; r=$?; rm -rf "$d"; exit $r; }; done; rm -rf "$d"; echo "Claude Code tidak dipasang di Mac ini, jadi otak kedua tidak tersedia."';

// Every git project in the usual places, and whether all of its work is already safe on GitHub. Read only.
const PROJECT_AUDIT = `for root in ~/Claude ~/Desktop ~/Documents ~/Developer ~/Projects ~/Code ~/Syarikat ~/Downloads ~/Sites; do
  [ -d "$root" ] && find "$root" -maxdepth 4 \\( -name node_modules -o -name .Trash -o -name Library \\) -prune -o -name .git -type d -print 2>/dev/null
done | sort -u | while read g; do
  d="\${g%/.git}"; remote=$(git -C "$d" remote get-url origin 2>/dev/null | sed -E 's#https://[^@]*@#https://#')
  dirty=$(git -C "$d" status --porcelain 2>/dev/null | wc -l | tr -d ' ')
  ahead=$(git -C "$d" rev-list --count @{u}..HEAD 2>/dev/null || echo "?")
  last=$(git -C "$d" log -1 --format=%cr 2>/dev/null); size=$(du -sh "$d" 2>/dev/null | cut -f1)
  regen=$(du -shc "$d"/node_modules "$d"/.next "$d"/dist "$d"/build "$d"/ios/Pods "$d"/android/.gradle "$d"/.dart_tool 2>/dev/null | tail -1 | cut -f1)
  if [[ "$remote" == *github.com* && "$dirty" == 0 && "$ahead" == 0 ]]; then state="SELAMAT di GitHub"; else state="BELUM SELAMAT"; fi
  echo "$state | \${d/#$HOME/~} | saiz $size (boleh dijana semula: \${regen:-0}) | commit terakhir $last | belum commit: $dirty | belum push: $ahead | \${remote:-tiada remote}"
done | sort`;
// Items in a folder not opened for a while (Spotlight's "last opened", else last changed), biggest first. Read only.
const OLD_FILES = `const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const dir = process.argv[1], days = +process.argv[2], cutoff = Date.now() - days * 864e5;
const items = fs.readdirSync(dir).filter(n => !n.startsWith('.')).map(n => path.join(dir, n)).slice(0, 2000);
const used = items.length ? execFileSync('mdls', ['-raw', '-name', 'kMDItemLastUsedDate', ...items], { encoding: 'utf8' }).split('\\0') : [];
const old = items.map((p, i) => { const u = Date.parse(used[i]); let st; try { st = fs.statSync(p); } catch { return null; }
  return { p, when: Number.isNaN(u) ? st.mtimeMs : u }; }).filter(x => x && x.when < cutoff);
for (const x of old) { try { x.kb = +execFileSync('du', ['-sk', x.p], { encoding: 'utf8' }).split('\\t')[0]; } catch { x.kb = 0; } }
old.sort((a, b) => b.kb - a.kb);
const size = kb => kb > 1048576 ? (kb / 1048576).toFixed(1) + ' GB' : kb > 1024 ? (kb / 1024).toFixed(0) + ' MB' : kb + ' KB';
console.log(old.length ? old.slice(0, 40).map(x => size(x.kb) + ' | tidak dibuka sejak ' + new Date(x.when).toLocaleDateString('ms-MY') + ' | ' + x.p).join('\\n')
  + '\\nJumlah: ' + old.length + ' item, ' + size(old.reduce((s, x) => s + x.kb, 0)) : 'Tiada item yang tidak dibuka lebih ' + days + ' hari.');`;
// Folders that must stay where macOS expects them.
const KEEP_PUT = ['Desktop', 'Documents', 'Downloads', 'Library', 'Applications', 'Pictures', 'Music', 'Movies', 'Public'].map(n => path.join(HOME, n));
function homeItem(v) {
  const p = path.resolve(text(v, 1000).replace(/^~(?=\/|$)/, HOME));
  if (!p.startsWith(HOME + path.sep) || path.relative(HOME, p).startsWith('.') || p.includes('/Library/')) bad('mesti dalam folder pengguna, bukan fail sistem atau tersembunyi');
  return p;
}

// Exact arithmetic for maths questions. Only numbers, operators, brackets and known maths words get through.
const CALC_WORDS = ['sqrt', 'cbrt', 'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'log', 'ln', 'log10', 'log2', 'exp', 'abs', 'pi', 'e', 'floor', 'ceil', 'round', 'deg', 'rad'];
function mathExpr(v) {
  const x = text(v, 300).replace(/×/g, '*').replace(/÷/g, '/').replace(/\^/g, '**');
  if (!/^[\d\s+\-*/().,%]*$/.test(x.replace(/[a-z0-9]+/gi, w => CALC_WORDS.includes(w.toLowerCase()) || /^\d/.test(w) ? '0' : 'X'))) bad('Ungkapan hanya boleh ada nombor, + - * / ^ ( ) dan fungsi seperti sqrt, sin, log.');
  return x;
}
const CALC = `const M = { sqrt: Math.sqrt, cbrt: Math.cbrt, sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos,
  atan: Math.atan, log: Math.log10, ln: Math.log, log10: Math.log10, log2: Math.log2, exp: Math.exp, abs: Math.abs, pi: Math.PI, e: Math.E,
  floor: Math.floor, ceil: Math.ceil, round: Math.round, deg: x => x * 180 / Math.PI, rad: x => x * Math.PI / 180 };
const x = process.argv[1].replace(/[a-z][a-z0-9]*/gi, w => 'M.' + w.toLowerCase());
const r = Function('M', 'return (' + x + ')')(M);
console.log(Number.isFinite(r) ? +r.toPrecision(12) : 'Tiada jawapan nyata (' + r + ')');`;

// A real mouse click at a screen point (needs Accessibility). argv: x, y, clicks.
const CLICK = `ObjC.import('CoreGraphics'); ObjC.import('AppKit');
function run(argv) {
  const p = $.CGPointMake(+argv[0], +argv[1]), n = +argv[2];
  for (let c = 1; c <= n; c++) for (const type of [$.kCGEventLeftMouseDown, $.kCGEventLeftMouseUp]) {
    const e = $.CGEventCreateMouseEvent(null, type, p, $.kCGMouseButtonLeft);
    $.CGEventSetIntegerValueField(e, $.kCGMouseEventClickState, c);
    $.CGEventPost($.kCGHIDEventTap, e);
    delay(0.04);
  }
  // Naming the app in front lets the model notice when it clicked the wrong window.
  return 'Diklik pada ' + argv[0] + ', ' + argv[1] + '. Aplikasi di depan: ' + $.NSWorkspace.sharedWorkspace.frontmostApplication.localizedName.js;
}`;

// name: { d: description, p: params, opt: optional param names, run: args => [file, argv] }
const T = {
  // Apps and system
  open_app: { d: 'Buka atau bawa ke depan aplikasi macOS', p: { name: S('cth. "Google Chrome", "Spotify", "WhatsApp", "Microsoft Word"') },
    run: a => ['open', ['-a', app(a.name)]] },
  quit_app: { d: 'Tutup aplikasi', p: { name: S('Nama aplikasi') },
    run: a => osa('on run argv\ntell application (item 1 of argv) to quit\nend run', app(a.name)) },
  list_apps: { d: 'Senarai aplikasi yang sedang dibuka', p: {},
    run: () => osa('tell application "System Events" to get name of every process whose background only is false') },
  set_volume: { d: 'Tetapkan volume Mac', p: { level: N('0 hingga 100') },
    run: a => osa('on run argv\nset volume output volume ((item 1 of argv) as integer)\nend run', int(a.level, 0, 100)) },
  mute: { d: 'Senyapkan atau bunyikan semula Mac', p: { on: B('true = senyap') },
    run: a => osa('on run argv\nset volume output muted ((item 1 of argv) is "true")\nend run', bool(a.on)) },
  dark_mode: { d: 'Hidup atau matikan Dark Mode', p: { on: B('true = gelap') },
    run: a => osa('on run argv\ntell application "System Events" to tell appearance preferences to set dark mode to ((item 1 of argv) is "true")\nend run', bool(a.on)) },
  wifi: { d: 'Hidup atau matikan Wi-Fi. Mematikan Wi-Fi memutuskan Jarvis sendiri.', p: { on: B('true = hidup') },
    run: a => ['networksetup', ['-setairportpower', 'en0', bool(a.on) ? 'on' : 'off']] },
  battery: { d: 'Status bateri', p: {}, run: () => ['pmset', ['-g', 'batt']] },
  disk_space: { d: 'Ruang storan Mac', p: {}, run: () => ['df', ['-h', '/System/Volumes/Data']] },
  now: { d: 'Tarikh dan masa sekarang', p: {}, run: () => ['date', []] },
  system_stats: { d: 'Beban CPU, memori bebas, tempoh Mac hidup, alamat IP, volum dan versi macOS', p: {},
    run: () => ['/bin/zsh', ['-c', `top -l 1 -n 0 | awk '/CPU usage/ {print "cpu=" 100-$7}'
memory_pressure | awk -F': ' '/free percentage/ {print "memfree=" $2+0}'
echo "mem=$(( $(sysctl -n hw.memsize) / 1073741824 ))"
echo "uptime=$(uptime | sed -E 's/.*up +//; s/, +[0-9]+ users?.*//')"
echo "ip=$(ipconfig getifaddr en0 2>/dev/null)"
echo "volume=$(osascript -e 'output volume of (get volume settings)') $(osascript -e 'output muted of (get volume settings)')"
echo "mac=$(sysctl -n machdep.cpu.brand_string) · macOS $(sw_vers -productVersion)"`]] },
  sleep_display: { d: 'Padamkan skrin (kunci Mac)', p: {}, run: () => ['pmset', ['displaysleepnow']] },
  sleep_mac: { d: 'Tidurkan Mac', p: {}, run: () => ['pmset', ['sleepnow']] },
  screenshot: { d: 'Ambil tangkapan skrin, disimpan di Desktop', p: {},
    run: () => ['screencapture', ['-x', path.join(HOME, 'Desktop', `Jarvis-${Date.now()}.png`)]] },

  // The user's app projects: their notes index plus the state of each git repo in ~/Claude.
  projects_status: { d: 'Status projek aplikasi pengguna: nota status setiap projek, dan untuk setiap repo bila commit terakhir serta berapa fail belum di-commit', p: {},
    run: () => ['/bin/zsh', ['-c', `cat "$1" 2>/dev/null; echo; echo "Repo (nama | commit terakhir | fail belum commit):"
for d in "$2"/*/.git(N:h); do echo "\${d:t} | $(git -C "$d" log -1 --format=%cr 2>/dev/null) | $(git -C "$d" status --porcelain 2>/dev/null | wc -l | tr -d ' ')"; done`,
      'jarvis', path.join(HOME, '.claude/projects', HOME.replace(/\//g, '-') + '-Claude', 'memory/MEMORY.md'), path.join(HOME, 'Claude')]] },

  // Media
  media: { d: 'Kawal muzik: main, jeda, lagu seterusnya atau sebelum', p: { app: S(PLAYERS.join(' atau ')), action: S(Object.keys(MEDIA).join(', ')) },
    run: a => osa(`tell application "${pick(a.app, PLAYERS)}" to ${MEDIA[pick(a.action, Object.keys(MEDIA))]}`) },
  now_playing: { d: 'Lagu yang sedang dimainkan', p: { app: S(PLAYERS.join(' atau ')) },
    run: a => osa(`tell application "${pick(a.app, PLAYERS)}" to (name of current track) & " - " & (artist of current track)`) },
  play_song: { d: 'Cari dan mainkan lagu, artis atau playlist dalam Spotify. Pulangkan lagu yang sedang dimainkan selepas itu.', p: { query: S('Nama lagu atau artis') },
    // shortcut: plays the top hit by pressing Return in the search view, switch to the Spotify Web API if that stops working
    run: a => osa(`on run argv
tell application "Spotify" to activate
open location (item 1 of argv)
delay 3
try
tell application "System Events" to key code 36
on error
return "Carian dibuka, tapi Jarvis belum ada kebenaran Accessibility untuk tekan play."
end try
delay 2
tell application "Spotify" to return "Sekarang: " & (name of current track) & " - " & (artist of current track)
end run`, 'spotify:search:' + q(text(a.query, 200))) },

  // Mail (app Mail). Drafts only: nothing is ever sent.
  mail_inbox: { d: 'Senarai 30 email terbaharu dalam app Mail: id | tarikh | pengirim | tajuk | dibaca? | dibalas? | PENTING jika ditanda. Guna untuk cari email belum dibaca, belum dibalas atau penting.', p: {},
    run: () => osa(`tell application "Mail"
set out to ""
set n to count of messages of inbox
if n > 30 then set n to 30
repeat with i from 1 to n
set m to message i of inbox
set dr to date received of m
set out to out & ((id of m) as string) & " | " & (short date string of dr) & " | " & (sender of m) & " | " & (subject of m) & " | " & my flag(read status of m, "dibaca", "BELUM DIBACA") & " | " & my flag(was replied to of m, "dibalas", "BELUM DIBALAS") & my flag(flagged status of m, " | PENTING", "") & linefeed
end repeat
if out is "" then return "Peti masuk kosong"
return out
end tell
on flag(b, y, n)
if b then return y
return n
end flag`) },
  mail_read: { d: 'Baca isi satu email ikut id daripada mail_inbox', p: { id: N('id email') },
    run: a => osa(`on run argv
tell application "Mail"
set m to first message of inbox whose id is ((item 1 of argv) as integer)
set c to content of m
if (length of c) > 3000 then set c to text 1 thru 3000 of c
return "Daripada: " & (sender of m) & linefeed & "Tajuk: " & (subject of m) & linefeed & c
end tell
end run`, int(a.id, 1, 2147483647)) },
  mail_draft_reply: { d: 'Tulis draf balasan dan buka di skrin. Tidak dihantar; pengguna tekan Send sendiri.', p: { id: N('id email'), body: S('Isi balasan') },
    run: a => osa(`on run argv
tell application "Mail"
set m to first message of inbox whose id is ((item 1 of argv) as integer)
set r to reply m with opening window
set content of r to (item 2 of argv) & linefeed & linefeed & (content of r)
activate
end tell
return "Draf balasan dibuka. Belum dihantar."
end run`, int(a.id, 1, 2147483647), text(a.body, 5000)) },
  mail_draft: { d: 'Tulis draf email baharu dan buka di skrin. Tidak dihantar; pengguna tekan Send sendiri.', p: { to: S('Alamat email penerima'), subject: S('Tajuk'), body: S('Isi') },
    run: a => osa(`on run argv
tell application "Mail"
set d to make new outgoing message with properties {subject:(item 2 of argv), content:(item 3 of argv), visible:true}
tell d to make new to recipient at end of to recipients with properties {address:(item 1 of argv)}
activate
end tell
return "Draf dibuka. Belum dihantar."
end run`, email(a.to), text(a.subject, 200), text(a.body, 5000)) },

  // Calendar, Reminders, Notes
  calendar_events: { d: 'Acara kalendar bermula hari ini', p: { days: N('Bilangan hari ke depan, 1 hingga 14') },
    run: a => osa(`on run argv
set d0 to current date
set time of d0 to 0
set d1 to d0 + ((item 1 of argv) as integer) * days
set out to ""
tell application "Calendar"
repeat with c in calendars
repeat with e in (every event of c whose start date >= d0 and start date < d1)
set out to out & ((start date of e) as string) & " | " & (summary of e) & linefeed
end repeat
end repeat
end tell
if out is "" then return "Tiada acara"
return out
end run`, int(a.days, 1, 14)) },
  calendar_add: { d: 'Tambah acara ke kalendar', p: { title: S('Nama acara'), start: S('Masa mula, format YYYY-MM-DDTHH:MM'), minutes: N('Tempoh dalam minit') },
    run: a => osa(`on run argv
set s to my mk(argv, 2)
tell application "Calendar" to tell (first calendar whose writable is true) to make new event with properties {summary:(item 1 of argv), start date:s, end date:s + ((item 7 of argv) as integer) * minutes}
return "Acara ditambah"
end run` + MK, text(a.title, 200), ...when(a.start), int(a.minutes, 5, 1440)) },
  reminder_add: { d: 'Tambah peringatan dalam Reminders', p: { title: S('Apa yang perlu diingat'), due: S('Pilihan: masa, format YYYY-MM-DDTHH:MM') }, opt: ['due'],
    run: a => (a.due
      ? osa(`on run argv
set s to my mk(argv, 2)
tell application "Reminders" to make new reminder with properties {name:(item 1 of argv), remind me date:s}
return "Peringatan ditambah"
end run` + MK, text(a.title, 200), ...when(a.due))
      : osa('on run argv\ntell application "Reminders" to make new reminder with properties {name:(item 1 of argv)}\nreturn "Peringatan ditambah"\nend run', text(a.title, 200))) },
  reminders_list: { d: 'Senarai peringatan yang belum selesai', p: {},
    run: () => osa(`tell application "Reminders"
set out to ""
set rs to (reminders whose completed is false)
set n to count of rs
if n > 20 then set n to 20
repeat with i from 1 to n
set out to out & (name of item i of rs) & linefeed
end repeat
if out is "" then return "Tiada peringatan"
return out
end tell`) },
  note_add: { d: 'Cipta nota baharu dalam Notes', p: { title: S('Tajuk nota'), body: S('Isi nota') },
    run: a => osa('on run argv\ntell application "Notes" to make new note with properties {name:(item 1 of argv), body:(item 2 of argv)}\nreturn "Nota disimpan"\nend run', text(a.title, 200), text(a.body, 5000)) },
  notes_search: { d: 'Cari nota ikut tajuk dan baca permulaannya', p: { query: S('Perkataan dalam tajuk') },
    run: a => osa(`on run argv
tell application "Notes"
set out to ""
set ns to (notes whose name contains (item 1 of argv))
set n to count of ns
if n > 5 then set n to 5
repeat with i from 1 to n
set t to plaintext of item i of ns
if (length of t) > 500 then set t to text 1 thru 500 of t
set out to out & (name of item i of ns) & ": " & t & linefeed & linefeed
end repeat
if out is "" then return "Tiada nota ditemui"
return out
end tell
end run`, text(a.query, 100)) },

  // Browser and web
  search_web: { d: 'Cari tanpa membuka browser dalam Wikipedia Melayu, Wikipedia Inggeris dan Wikisource Melayu (hikayat dan teks lama): dapat tajuk, alamat dan ringkasan. Guna untuk sejarah, sains, pengetahuan am dan mencari cerita; kemudian guna read_web untuk membaca halaman. Untuk berita terkini guna web_search.', p: { query: S('Kata carian') },
    run: a => [process.execPath, ['-e', SEARCH, text(a.query, 300)]] },
  news: { d: 'Berita terkini dari Google News: 10 tajuk terbaru dengan tarikh. Guna untuk apa-apa yang berlaku sekarang di Malaysia atau dunia (politik, ekonomi, sukan, teknologi, bencana).', p: { query: S('Topik, cth. "Malaysia", "ekonomi dunia", "Harimau Malaya"'), lang: S('ms (Melayu) atau en (English)') }, opt: ['lang'],
    run: a => { const en = a.lang === 'en';
      return ['/bin/zsh', ['-c', 'curl -sLG -m 15 -A "$4" --data-urlencode "q=$1" --data-urlencode "hl=$2" --data-urlencode "gl=MY" --data-urlencode "ceid=$3" https://news.google.com/rss/search | "$5" -e "$6"',
        'jarvis', text(a.query, 200), en ? 'en-MY' : 'ms', en ? 'MY:en' : 'MY:ms', UA, process.execPath, NEWS]]; } },
  weather: { d: 'Cuaca semasa di mana-mana bandar di dunia: keadaan, suhu, terasa seperti, angin, lembapan dan hujan.', p: { city: S('Nama bandar, cth. "Kuala Lumpur", "Tokyo"') },
    run: a => ['/bin/zsh', ['-c', 'curl -sG -m 15 --data-urlencode "format=%l: %C %t (terasa %f), angin %w, lembapan %h, hujan %p" --data-urlencode "lang=id" "https://wttr.in/$1"', 'jarvis', encodeURIComponent(text(a.city, 80))]] },
  exchange_rate: { d: 'Kadar tukaran mata wang terkini (dikemas kini setiap hari).', p: { from: S('Kod mata wang asal, cth. USD'), to: S('Satu atau lebih kod dipisah koma, cth. MYR,SGD'), amount: N('Jumlah, lalai 1') }, opt: ['amount'],
    run: a => ['/bin/zsh', ['-c', 'curl -s -m 15 "https://open.er-api.com/v6/latest/$1" | "$2" -e "$3" "$4" "$5"', 'jarvis', currency(a.from), process.execPath, RATES,
      text(a.to, 60).split(',').map(c => currency(c.trim())).join(','), String(a.amount === undefined ? 1 : int(a.amount, 0, 1e12))]] },
  whatsapp_message: { d: 'Buka perbualan WhatsApp dengan seseorang dan taip mesej ke dalam kotak mesej. TIDAK dihantar: pengguna semak dan tekan Enter sendiri. Cari nombor dengan contacts_search dahulu jika pengguna sebut nama.', p: { phone: S('Nombor telefon, cth. 0123456789'), text: S('Mesej yang hendak ditaip') },
    run: a => ['open', ['whatsapp://send?phone=' + phone(a.phone) + '&text=' + encodeURIComponent(text(a.text, 4000))]] },
  flights: { d: 'Cari penerbangan di Google Flights dan buka hasilnya (harga, masa, syarikat penerbangan). Jarvis tidak menempah atau membayar; pengguna tempah sendiri.', p: { from: S('Bandar atau kod lapangan terbang asal, cth. KUL'), to: S('Destinasi, cth. Tokyo'), date: S('Tarikh pergi YYYY-MM-DD'), back: S('Tarikh balik YYYY-MM-DD (kosongkan jika sehala)'), people: N('Bilangan penumpang, lalai 1') }, opt: ['back', 'people'],
    run: a => {
      const q = `Flights from ${text(a.from, 60)} to ${text(a.to, 60)} on ${isoDate(a.date)}` + (a.back ? ` returning ${isoDate(a.back)}` : ' one way')
        + (a.people !== undefined ? ` for ${int(a.people, 1, 9)} passengers` : '');
      return browse('https://www.google.com/travel/flights?q=' + encodeURIComponent(q), 'google.com/travel');
    } },
  read_code: { d: 'Baca fail kod atau teks dalam projek pengguna, dengan nombor baris (300 baris setiap kali). Fail rahsia seperti .env tidak dibaca.', p: { path: S('Laluan penuh fail'), from: N('Baris mula, lalai 1'), to: N('Baris akhir') }, opt: ['from', 'to'],
    run: a => [process.execPath, ['-e', READ_CODE, codePath(a.path), String(a.from === undefined ? 1 : int(a.from, 1, 1e7)), String(a.to === undefined ? '' : int(a.to, 1, 1e7))]] },
  check_code: { d: 'Semak ralat sintaks satu fail kod (JavaScript, Python, Swift, Ruby, shell, JSON). Hanya membaca.', p: { path: S('Laluan penuh fail') },
    run: a => [process.execPath, ['-e', CHECK_CODE, codePath(a.path)]] },
  code_search: { d: 'Cari penyelesaian pengaturcaraan di Stack Overflow dan dokumentasi MDN: tajuk, undi dan pautan. Kemudian guna read_web untuk membaca jawapan atau dokumentasi.', p: { query: S('Soalan atau mesej ralat dalam English, cth. "node fetch timeout"') },
    run: a => [process.execPath, ['-e', CODE_SEARCH, text(a.query, 300)]] },
  code_agent: { confirm: true, long: true, d: 'Serahkan kerja kod kepada Claude Code (jurutera AI) dalam satu folder projek: membaiki pepijat, menambah ciri, menyusun semula atau menerangkan kod. Ia boleh membaca dan MENGUBAH fail dalam folder itu (tidak menjalankan arahan shell). Pengguna perlu meluluskan. Boleh ambil masa beberapa minit.', p: { folder: S('Laluan penuh folder projek'), task: S('Tugasan yang jelas dan lengkap, cth. "Betulkan ralat TypeError di halaman log masuk dan terangkan apa yang diubah"') },
    run: a => ['/bin/zsh', ['-c', 'for c in "$HOME/.local/bin/claude" /opt/homebrew/bin/claude /usr/local/bin/claude; do [ -x "$c" ] && cd "$1" && exec "$c" -p "$2" --permission-mode acceptEdits --allowedTools "Read,Edit,Write,Grep,Glob" --output-format text; done; echo "Claude Code tidak dipasang di Mac ini (https://claude.com/claude-code)."',
      'jarvis', codePath(a.folder, true), text(a.task, 4000)]] },
  remember: { d: 'Ingat satu fakta penting tentang pengguna untuk selamanya (nama, keluarga, kerja, kesukaan, matlamat, janji, maklumat yang pengguna minta diingat). Fakta ini dibaca semula pada setiap sesi baharu.', p: { fact: S('Satu ayat yang jelas, cth. "Anak sulung Tuan bernama Aisyah, umur 7 tahun"') },
    run: a => [process.execPath, ['-e', REMEMBER, memoryDir(), text(a.fact, 500)]] },
  recall: { d: 'Cari dalam semua perbualan lama dengan pengguna (sejak hari pertama). Guna bila pengguna merujuk perkara lalu, cth. "semalam kita bincang apa", "nombor yang saya bagi dulu".', p: { query: S('Kata kunci perkara yang dicari') },
    run: a => [process.execPath, ['-e', RECALL, memoryDir(), text(a.query, 300)]] },
  forget: { confirm: true, d: 'Lupakan fakta yang diingat yang mengandungi perkataan ini. Perlu kelulusan pengguna.', p: { what: S('Perkataan dalam fakta yang hendak dilupakan') },
    run: a => [process.execPath, ['-e', FORGET, memoryDir(), text(a.what, 200)]] },
  ask_claude: { long: true, d: 'Otak kedua: tanya Claude (AI Anthropic, dengan carian web) untuk soalan yang sukar atau panjang: penaakulan rumit, matematik tinggi, analisis, penulisan panjang, reka bentuk sistem, perancangan. Ambil masa beberapa saat hingga seminit. Tidak boleh membaca atau mengubah fail.', p: { question: S('Soalan lengkap dengan semua konteks yang perlu, dan bahasa jawapan') },
    run: a => ['/bin/zsh', ['-c', ASK_CLAUDE, 'jarvis', text(a.question, 8000)]] },
  project_audit: { slow: true, d: 'Senarai semua projek Git di Mac (Claude, Desktop, Documents, Developer, Projects, Syarikat, Downloads): sama ada SELAMAT di GitHub (tiada kerja belum commit atau belum push) atau BELUM SELAMAT, saiz, saiz yang boleh dijana semula (node_modules, build), commit terakhir dan remote. Hanya membaca.', p: {},
    run: () => ['/bin/zsh', ['-c', PROJECT_AUDIT]] },
  old_files: { slow: true, d: 'Senarai fail dan folder dalam satu folder yang tidak dibuka lebih N hari, paling besar dahulu, dengan tarikh terakhir dibuka. Hanya membaca; tidak memadam.', p: { folder: S('Laluan penuh folder, cth. ~/Downloads'), days: N('Bilangan hari, lalai 180') }, opt: ['days'],
    run: a => [process.execPath, ['-e', OLD_FILES, codePath(a.folder, true), String(a.days === undefined ? 180 : int(a.days, 1, 10000))]] },
  move_file: { confirm: true, d: 'Alihkan satu fail atau folder ke folder lain (dicipta jika belum ada) untuk menyusun fail ikut projek. Tidak menimpa fail sedia ada. Perlu kelulusan pengguna.', p: { from: S('Laluan penuh fail atau folder'), to_folder: S('Laluan penuh folder destinasi') },
    run: a => {
      const from = homeItem(a.from), to = homeItem(a.to_folder);
      if (KEEP_PUT.includes(from)) bad('folder ini mesti kekal di tempatnya');
      if (to === from || to.startsWith(from + path.sep)) bad('tidak boleh alih folder ke dalam dirinya sendiri');
      if (!fs.existsSync(from)) bad('tidak dijumpai: ' + from);
      return ['/bin/zsh', ['-c', 'mkdir -p "$2" && if [ -e "$2/${1:t}" ]; then echo "Sudah ada item bernama ${1:t} di $2; tidak dialih."; else mv -n "$1" "$2/" && echo "Dialih ke $2/${1:t}"; fi', 'jarvis', from, to]];
    } },
  calculate: { d: 'Kira dengan tepat (matematik, Matematik Tambahan, peratus, wang). Sudut trigonometri dalam radian; guna rad(30) untuk darjah. log = log10, ln = log asli.', p: { expression: S('cth. (2*3+sqrt(16))^2/7, sin(rad(30)), ln(5)') },
    run: a => [process.execPath, ['-e', CALC, mathExpr(a.expression)]] },
  read_web: { d: 'Baca teks sesuatu laman web (cerita, hikayat, artikel, nota pelajaran) tanpa membukanya di skrin. Guna untuk membaca cerita atau fakta dari laman yang dijumpai melalui carian.', p: { url: S('URL penuh bermula https://') },
    // The page is fetched and turned into plain text by macOS itself (textutil); the URL is an argument, never shell text.
    run: a => ['/bin/zsh', ['-c', 'curl -fsL -m 20 --max-filesize 5000000 -A "Mozilla/5.0" "$1" | textutil -convert txt -format html -stdin -stdout | tr -s " \n"', 'jarvis', webUrl(a.url)]] },
  open_url: { d: 'Buka laman web. Guna semula tab laman yang sama jika sudah dibuka.', p: { url: S('URL penuh bermula https://') },
    run: a => { const u = webUrl(a.url); return browse(u, new URL(u).hostname.replace(/^www\./, '')); } },
  web_search: { d: 'Cari di Google dalam tab Google sedia ada (tidak buka tab baharu jika sudah ada)', p: { query: S('Kata carian') },
    run: a => browse('https://www.google.com/search?q=' + q(text(a.query, 300)), 'google.com/search') },
  youtube: { d: 'Cari video atau lagu di YouTube dalam tab YouTube sedia ada. play=true terus memainkan video pertama (guna bila pengguna minta main, pasang atau buka lagu/video); tanpa play, hanya senarai carian dipaparkan.', p: { query: S('Kata carian'), play: B('true untuk terus main video pertama') }, opt: ['play'],
    run: a => browse('https://www.youtube.com/results?search_query=' + q(text(a.query, 300)), 'youtube.com', a.play !== undefined && bool(a.play) ? '1' : '') },  maps: { d: 'Cari tempat atau arah dalam Maps', p: { query: S('Nama tempat atau alamat') },
    run: a => ['open', ['maps://?q=' + q(text(a.query, 300))]] },
  browser_tab: { d: 'Tajuk dan URL tab Chrome yang aktif', p: {},
    run: () => osa('tell application "Google Chrome" to (title of active tab of front window) & " | " & (URL of active tab of front window)') },
  close_tab: { d: 'Tutup tab Chrome yang aktif', p: {},
    run: () => osa(`tell application "Google Chrome"
set t to active tab of front window
if (URL of t) starts with "http://localhost:4199" then error "Tetingkap depan ialah Jarvis sendiri"
close t
end tell`) },

  // Files
  open_folder: { d: 'Buka folder dalam Finder', p: { name: S(Object.keys(FOLDERS).join(', ')) },
    run: a => ['open', [path.resolve(HOME, FOLDERS[pick(a.name, Object.keys(FOLDERS))])]] },
  find_files: { d: 'Cari fail ikut nama; pulangkan laluan penuh', p: { query: S('Sebahagian nama fail') },
    run: a => ['mdfind', ['-onlyin', HOME, '-name', text(a.query, 100)]] },
  open_file: { d: 'Buka dokumen, gambar, audio atau video ikut laluan penuh daripada find_files', p: { path: S('Laluan penuh fail') },
    run: a => {
      const p = path.resolve(text(a.path, 1000));
      if (!p.startsWith(HOME + path.sep)) bad('fail mesti dalam folder pengguna');
      if (!SAFE_EXT.includes(path.extname(p).slice(1).toLowerCase())) bad('jenis fail ini tidak dibenarkan');
      return ['open', [p]];
    } },

  // Keyboard, for the app in front
  type_text: { d: 'Taip teks ke dalam aplikasi yang sedang di depan', p: { text: S('Teks untuk ditaip') },
    run: a => osa(`on run argv
${KEYGUARD}
keystroke (item 1 of argv)
end tell
return "Ditaip dalam " & f
end run`, text(a.text, 2000).replace(/\r?\n/g, '\r')) },
  press_key: { d: 'Tekan kekunci atau pintasan pada aplikasi yang sedang di depan', p: { key: S(Object.keys(KEYS).join(', ')) },
    run: a => osa(`${KEYGUARD}\n${KEYS[pick(a.key, Object.keys(KEYS))]}\nend tell\nreturn "Ditekan dalam " & f`) },

  // More apps: read-only lookups, plus a draft in Outlook (never sent).
  contacts_search: { d: 'Cari kenalan dalam Contacts ikut nama; pulangkan nama, nombor telefon dan email', p: { query: S('Sebahagian nama') },
    run: a => osa(`on run argv
tell application "Contacts"
set out to ""
set ps to (people whose name contains (item 1 of argv))
set n to count of ps
if n > 8 then set n to 8
repeat with i from 1 to n
set p to item i of ps
set out to out & (name of p)
repeat with ph in phones of p
set out to out & " | " & (value of ph)
end repeat
repeat with em in emails of p
set out to out & " | " & (value of em)
end repeat
set out to out & linefeed
end repeat
if out is "" then return "Tiada kenalan ditemui"
return out
end tell
end run`, text(a.query, 100)) },
  photos_search: { d: 'Cari foto dalam Photos ikut nama orang, tempat atau kata kunci; pulangkan bilangan dan contoh', p: { query: S('Nama orang, tempat atau kata kunci') },
    run: a => osa(`on run argv
tell application "Photos"
set found to search for (item 1 of argv)
set n to count of found
if n is 0 then return "Tiada foto ditemui"
set out to (n as string) & " foto ditemui. Contoh:" & linefeed
if n > 10 then set n to 10
repeat with i from 1 to n
set m to item i of found
set d to date of m
set out to out & (filename of m) & " | " & (short date string of d) & linefeed
end repeat
return out
end tell
end run`, text(a.query, 100)) },
  outlook_draft: { d: 'Buka draf email baharu dalam Microsoft Outlook. Tidak dihantar; pengguna semak dan tekan Send sendiri.', p: { to: S('Alamat email penerima'), subject: S('Tajuk'), body: S('Isi') },
    run: a => ['open', ['-a', 'Microsoft Outlook', `mailto:${email(a.to)}?subject=${q(text(a.subject, 200))}&body=${q(text(a.body, 5000))}`]] },
  // Read-only: sizes of things that are usually safe to clear, and the biggest files. It deletes nothing.
  storage_scan: { slow: true, d: 'Imbas storan: ruang kosong, saiz cache dan folder yang boleh dijana semula, item terbesar dalam Downloads, fail melebihi 500 MB, dan node_modules projek. Hanya membaca; tidak memadam apa-apa.', p: {},
    run: () => ['/bin/zsh', ['-c', `df -h /System/Volumes/Data | tail -1 | awk '{print "Ruang kosong: "$4" daripada "$2}'
echo "== Biasanya selamat dikosongkan (boleh dijana atau dimuat turun semula) =="
for d in ~/Library/Caches ~/Library/Developer/Xcode/DerivedData ~/Library/Developer/Xcode/iOS\ DeviceSupport ~/Library/Developer/CoreSimulator/Caches ~/.npm/_cacache ~/.gradle/caches ~/.pub-cache ~/.bun/install/cache ~/Library/Caches/Homebrew ~/.Trash; do [ -e "$d" ] && du -sh "$d" 2>/dev/null; done
echo "== 15 item terbesar dalam Downloads =="
du -sh ~/Downloads/*(N) 2>/dev/null | sort -rh | head -15
echo "== Fail melebihi 500 MB dalam folder pengguna =="
mdfind -onlyin ~ 'kMDItemFSSize > 500000000' 2>/dev/null | head -20 | while read -r f; do du -sh "$f" 2>/dev/null; done
echo "== node_modules projek (boleh dipasang semula dengan npm install) =="
du -sh ~/Claude/*/node_modules(N) ~/Claude/*/*/node_modules(N) 2>/dev/null | sort -rh | head -10`]] },
  // The page forwards this picture to the model, so Jarvis can read whatever app is on screen.
  record_screen: { d: 'Mula rakam video skrin untuk tempoh tertentu; fail .mov disimpan di Desktop. Berhenti sendiri bila tempoh tamat.', p: { seconds: N('Tempoh rakaman dalam saat, 5 hingga 600') },
    run: a => ['/bin/zsh', ['-c', 'f="$HOME/Desktop/Rakaman Jarvis $(date +%Y-%m-%d\\ %H.%M.%S).mov"; nohup screencapture -v -V "$1" "$f" >/dev/null 2>&1 & echo "Merakam $1 saat. Fail: $f"', 'jarvis', String(int(a.seconds, 5, 600))]] },
  stop_recording: { d: 'Hentikan rakaman skrin yang sedang berjalan dan simpan failnya', p: {},
    run: () => ['/bin/zsh', ['-c', 'pkill -INT -x screencapture && echo "Rakaman dihentikan dan disimpan di Desktop" || echo "Tiada rakaman sedang berjalan"']] },
  mouse_click: { d: 'Klik tetikus pada satu titik di skrin. Panggil see_screen dahulu: koordinat x, y ialah kedudukan piksel dalam imej itu.', p: { x: N('Piksel dari kiri'), y: N('Piksel dari atas'), double: B('true untuk klik dua kali') }, opt: ['double'],
    run: a => ['osascript', ['-l', 'JavaScript', '-e', CLICK, String(int(a.x, 0, 10000)), String(int(a.y, 0, 10000)), a.double === undefined ? '1' : bool(a.double) ? '2' : '1']] },
  see_screen: { image: true, d: 'Tengok skrin Mac sekarang (tangkapan skrin). Guna untuk semak apa-apa yang dipaparkan oleh mana-mana aplikasi, dan untuk cari kedudukan sebelum mouse_click.', p: {},
    run: () => ['/bin/zsh', ['-c', 'f=$(mktemp -t jarvis).jpg; w=$(osascript -l JavaScript -e \'ObjC.import("AppKit"); $.NSScreen.mainScreen.frame.size.width\'); screencapture -x -t jpg "$f" 2>/dev/null && sips --resampleWidth "${w:-1600}" "$f" >/dev/null 2>&1 && base64 -i "$f"; s=$?; rm -f "$f"; [ $s = 0 ] || echo "Jarvis belum ada kebenaran Screen Recording. Pengguna perlu benarkan node di System Settings > Privacy & Security > Screen & System Audio Recording." >&2; exit $s']] },

  // Full-power tools. confirm: the page asks the user on screen before the server will run them.
  mail_send: { confirm: true, d: 'Hantar email baharu terus melalui app Mail', p: { to: S('Alamat email penerima'), subject: S('Tajuk'), body: S('Isi') },
    run: a => osa(`on run argv
tell application "Mail"
set d to make new outgoing message with properties {subject:(item 2 of argv), content:(item 3 of argv), visible:false}
tell d to make new to recipient at end of to recipients with properties {address:(item 1 of argv)}
send d
end tell
return "Email dihantar"
end run`, email(a.to), text(a.subject, 200), text(a.body, 5000)) },
  mail_send_reply: { confirm: true, d: 'Balas dan hantar terus satu email ikut id daripada mail_inbox', p: { id: N('id email'), body: S('Isi balasan') },
    run: a => osa(`on run argv
tell application "Mail"
set m to first message of inbox whose id is ((item 1 of argv) as integer)
set r to reply m without opening window
set content of r to (item 2 of argv) & linefeed & linefeed & (content of r)
send r
end tell
return "Balasan dihantar"
end run`, int(a.id, 1, 2147483647), text(a.body, 5000)) },
  run_shell: { confirm: true, d: 'Jalankan arahan zsh dalam folder pengguna dan pulangkan outputnya. Guna ini untuk apa-apa yang alat lain tidak boleh buat.', p: { command: S('Arahan shell') },
    run: a => ['/bin/zsh', ['-lc', text(a.command, 2000)]] },
  trash_file: { confirm: true, d: 'Padam fail atau folder dengan memindahkannya ke Trash', p: { path: S('Laluan penuh') },
    run: a => {
      const p = path.resolve(text(a.path, 1000));
      if (!p.startsWith(HOME + path.sep)) bad('fail mesti dalam folder pengguna');
      return osa('on run argv\ntell application "Finder" to delete ((POSIX file (item 1 of argv)) as alias)\nreturn "Dipindah ke Trash"\nend run', p);
    } },
  open_any: { confirm: true, d: 'Buka apa-apa fail, app atau skrip ikut laluan penuh (skrip akan dijalankan)', p: { path: S('Laluan penuh') },
    run: a => ['open', [path.resolve(text(a.path, 1000))]] },
  applescript: { confirm: true, d: 'Jalankan AppleScript untuk mengawal mana-mana aplikasi Mac yang tiada alat khusus (cth. Outlook, WhatsApp, Telegram, Keynote, Finder)', p: { script: S('Kod AppleScript penuh') },
    run: a => ['osascript', ['-e', text(a.script, 5000)]] },
  restart: { confirm: true, d: 'Mulakan semula Mac', p: {}, run: () => osa('tell application "System Events" to restart') },
  shutdown: { confirm: true, d: 'Matikan Mac', p: {}, run: () => osa('tell application "System Events" to shut down') },
};

const confirm = Object.keys(T).filter(name => T[name].confirm);
const image = Object.keys(T).filter(name => T[name].image);
const slow = Object.keys(T).filter(name => T[name].slow);
const long = Object.keys(T).filter(name => T[name].long);

function plan(name, a) {
  if (!Object.hasOwn(T, name)) bad('alat tidak dikenali: ' + name);
  return T[name].run(a || {});
}

const declarations = Object.entries(T).map(([name, t]) => {
  const keys = Object.keys(t.p);
  return { name, description: t.d, ...(keys.length && {
    parameters: { type: 'OBJECT', properties: t.p, required: keys.filter(k => !(t.opt || []).includes(k)) },
  }) };
});

// Blocks other websites (CSRF) and DNS rebinding from reaching the local server.
function isLocal(headers, port) {
  const ok = [`localhost:${port}`, `127.0.0.1:${port}`];
  if (!ok.includes(headers.host)) return false;
  return !headers.origin || ok.some(h => headers.origin === 'http://' + h);
}

// Permission groups shown as switches in Settings. Every tool belongs to exactly one group (test.js checks this).
const GROUPS = {
  music:     ['Spotify dan Muzik', ['media', 'now_playing', 'play_song']],
  chat:      ['WhatsApp', ['whatsapp_message']],
  mail:      ['Emel (Mail dan Outlook)', ['mail_inbox', 'mail_read', 'mail_draft_reply', 'mail_draft', 'mail_send', 'mail_send_reply', 'outlook_draft']],
  calendar:  ['Kalendar', ['calendar_events', 'calendar_add']],
  reminders: ['Peringatan dan alarm', ['reminder_add', 'reminders_list']],
  notes:     ['Nota', ['note_add', 'notes_search']],
  contacts:  ['Kenalan', ['contacts_search']],
  photos:    ['Foto', ['photos_search']],
  web:       ['Browser, carian web dan kalkulator', ['flights', 'news', 'weather', 'exchange_rate', 'calculate', 'search_web', 'read_web', 'open_url', 'web_search', 'youtube', 'maps', 'browser_tab', 'close_tab']],
  files:     ['Fail dan storan', ['open_folder', 'find_files', 'open_file', 'trash_file', 'storage_scan', 'disk_space', 'project_audit', 'old_files', 'move_file']],
  apps:      ['Buka dan tutup aplikasi', ['open_app', 'quit_app', 'list_apps', 'open_any']],
  system:    ['Sistem (bunyi, Wi-Fi, tidur, restart)', ['set_volume', 'mute', 'dark_mode', 'wifi', 'battery', 'now', 'system_stats', 'sleep_display', 'sleep_mac', 'restart', 'shutdown']],
  screen:    ['Skrin dan papan kekunci', ['screenshot', 'see_screen', 'type_text', 'press_key', 'record_screen', 'stop_recording', 'mouse_click']],
  projects:  ['Status projek', ['projects_status']],
  memory:    ['Ingatan dan otak kedua (Claude)', ['remember', 'recall', 'forget', 'ask_claude']],
  code:      ['Kod dan pengaturcaraan', ['read_code', 'check_code', 'code_search', 'code_agent']],
  scripts:   ['Skrip bebas (shell dan AppleScript)', ['run_shell', 'applescript']],
};
const groups = Object.entries(GROUPS).map(([id, [label, tools]]) => ({ id, label, tools }));

// off = ids of the groups the user switched off. Unknown ids are dropped, so a bad file cannot switch anything else off.
const cleanOff = off => (Array.isArray(off) ? off : []).filter(id => Object.hasOwn(GROUPS, id));
// Screen settings shared by the Chrome tab and Jarvis Mini: only these keys, short text or yes/no.
const SETTING_TYPES = { lang: 'string', voice: 'string', style: 'string', call: 'string', face: 'string', theme: 'string', mini: 'string', brief: 'boolean', wake: 'boolean', memory: 'boolean' };
const cleanSettings = s => Object.fromEntries(Object.entries(SETTING_TYPES)
  .filter(([k, type]) => s && typeof s[k] === type && String(s[k]).length <= 40)
  .map(([k]) => [k, s[k]]));
// A character the user added: a 3D model plus how it looks and sounds. Points are [x, y, z] on the model.
const VOICE_NAMES = ['Fenrir', 'Charon', 'Orus', 'Puck', 'Zephyr', 'Kore', 'Aoede', 'Leda'];
const point = p => Array.isArray(p) && p.length === 3 && p.every(n => typeof n === 'number' && Number.isFinite(n)) ? p : null;
function cleanCharacter(c) {
  const out = {};
  if (!c || typeof c !== 'object') return out;
  if (typeof c.name === 'string' && c.name.trim()) out.name = c.name.trim().slice(0, 30);
  if (VOICE_NAMES.includes(c.voice)) out.voice = c.voice;
  if (typeof c.pitch === 'number' && Number.isFinite(c.pitch)) out.pitch = Math.min(1.6, Math.max(.7, c.pitch));
  if (typeof c.persona === 'string') out.persona = c.persona.slice(0, 600);
  if (point(c.mouth)) out.mouth = c.mouth;
  if (Array.isArray(c.eyes)) out.eyes = c.eyes.filter(point).slice(0, 2);
  for (const k of ['size', 'eyeSize']) if (typeof c[k] === 'number' && c[k] > 0 && c[k] < 10) out[k] = c[k];   // half mouth width, eye radius
  return out;
}
const blocked = off => new Set(cleanOff(off).flatMap(id => GROUPS[id][1]));

// Returns the .env text with the Gemini key set. The key is one line of key characters, so it cannot add other settings.
function envWithKey(text, key) {
  if (typeof key !== 'string' || !/^[A-Za-z0-9_-]{20,100}$/.test(key.trim())) bad('Kunci API tidak sah. Salin semula dari Google AI Studio.');
  const line = 'GEMINI_API_KEY=' + key.trim();
  return /^GEMINI_API_KEY=.*$/m.test(text) ? text.replace(/^GEMINI_API_KEY=.*$/m, line) : text + (text && !text.endsWith('\n') ? '\n' : '') + line + '\n';
}

module.exports = { envWithKey, plan, declarations, confirm, image, slow, long, isLocal, HOME, groups, cleanOff, blocked, cleanSettings, cleanCharacter, memoryDir };
