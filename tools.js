// Every tool maps a model call to one fixed command, run with execFile (no shell).
// AppleScript never has model text spliced into it: values travel as argv ("on run argv").
const os = require('node:os');
const path = require('node:path');

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
  mail:      ['Emel (Mail dan Outlook)', ['mail_inbox', 'mail_read', 'mail_draft_reply', 'mail_draft', 'mail_send', 'mail_send_reply', 'outlook_draft']],
  calendar:  ['Kalendar', ['calendar_events', 'calendar_add']],
  reminders: ['Peringatan dan alarm', ['reminder_add', 'reminders_list']],
  notes:     ['Nota', ['note_add', 'notes_search']],
  contacts:  ['Kenalan', ['contacts_search']],
  photos:    ['Foto', ['photos_search']],
  web:       ['Browser dan carian web', ['open_url', 'web_search', 'youtube', 'maps', 'browser_tab', 'close_tab']],
  files:     ['Fail dan storan', ['open_folder', 'find_files', 'open_file', 'trash_file', 'storage_scan', 'disk_space']],
  apps:      ['Buka dan tutup aplikasi', ['open_app', 'quit_app', 'list_apps', 'open_any']],
  system:    ['Sistem (bunyi, Wi-Fi, tidur, restart)', ['set_volume', 'mute', 'dark_mode', 'wifi', 'battery', 'now', 'system_stats', 'sleep_display', 'sleep_mac', 'restart', 'shutdown']],
  screen:    ['Skrin dan papan kekunci', ['screenshot', 'see_screen', 'type_text', 'press_key', 'record_screen', 'stop_recording', 'mouse_click']],
  projects:  ['Status projek', ['projects_status']],
  scripts:   ['Skrip bebas (shell dan AppleScript)', ['run_shell', 'applescript']],
};
const groups = Object.entries(GROUPS).map(([id, [label, tools]]) => ({ id, label, tools }));

// off = ids of the groups the user switched off. Unknown ids are dropped, so a bad file cannot switch anything else off.
const cleanOff = off => (Array.isArray(off) ? off : []).filter(id => Object.hasOwn(GROUPS, id));
// Screen settings shared by the Chrome tab and Jarvis Mini: only these keys, short text or yes/no.
const SETTING_TYPES = { lang: 'string', voice: 'string', style: 'string', call: 'string', face: 'string', theme: 'string', brief: 'boolean', wake: 'boolean' };
const cleanSettings = s => Object.fromEntries(Object.entries(SETTING_TYPES)
  .filter(([k, type]) => s && typeof s[k] === type && String(s[k]).length <= 40)
  .map(([k]) => [k, s[k]]));
const blocked = off => new Set(cleanOff(off).flatMap(id => GROUPS[id][1]));

// Returns the .env text with the Gemini key set. The key is one line of key characters, so it cannot add other settings.
function envWithKey(text, key) {
  if (typeof key !== 'string' || !/^[A-Za-z0-9_-]{20,100}$/.test(key.trim())) bad('Kunci API tidak sah. Salin semula dari Google AI Studio.');
  const line = 'GEMINI_API_KEY=' + key.trim();
  return /^GEMINI_API_KEY=.*$/m.test(text) ? text.replace(/^GEMINI_API_KEY=.*$/m, line) : text + (text && !text.endsWith('\n') ? '\n' : '') + line + '\n';
}

module.exports = { envWithKey, plan, declarations, confirm, image, slow, isLocal, HOME, groups, cleanOff, blocked, cleanSettings };
