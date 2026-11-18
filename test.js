const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { plan, declarations, confirm, image, slow, isLocal, HOME, groups, cleanOff, blocked, envWithKey } = require('./tools');

// One valid call per tool. The first test fails if a tool is added without a sample here.
const SAMPLES = {
  open_app: { name: 'Google Chrome' }, quit_app: { name: 'Safari' }, list_apps: {},
  set_volume: { level: 30 }, mute: { on: true }, dark_mode: { on: false }, wifi: { on: true },
  battery: {}, disk_space: {}, now: {}, sleep_display: {}, sleep_mac: {}, screenshot: {},
  media: { app: 'Spotify', action: 'next' }, now_playing: { app: 'Music' }, play_song: { query: 'Sudirman' },
  mail_inbox: {}, projects_status: {}, mail_read: { id: 12 }, mail_draft_reply: { id: 12, body: 'Terima kasih' },
  mail_draft: { to: 'ali@example.com', subject: 'Hai', body: 'Apa khabar' },
  whatsapp_message: { phone: '012-345 6789', text: 'Ok, jumpa esok' },
  read_code: { path: __filename }, check_code: { path: __filename }, code_search: { query: 'node fetch timeout' }, code_agent: { folder: __dirname, task: 'Terangkan fail tools.js' }, flights: { from: 'KUL', to: 'Tokyo', date: '2026-12-10', back: '2026-12-17' },
  calendar_events: { days: 3 }, calendar_add: { title: 'Mesyuarat', start: '2026-11-20T15:30', minutes: 60 },
  reminder_add: { title: 'Beli susu', due: '2026-11-20T09:00' }, reminders_list: {},
  note_add: { title: 'Idea', body: 'Isi' }, notes_search: { query: 'Idea' },
  open_url: { url: 'https://example.com/a' }, read_web: { url: 'https://ms.wikisource.org/wiki/Hikayat_Hang_Tuah' }, search_web: { query: 'hikayat sang kancil' }, news: { query: 'Malaysia' }, weather: { city: 'Kuala Lumpur' }, exchange_rate: { from: 'USD', to: 'MYR' }, calculate: { expression: '(2+3)^2' }, web_search: { query: 'nasi lemak & teh' },
  youtube: { query: 'lagu raya' }, maps: { query: 'KLCC' }, browser_tab: {}, close_tab: {},
  open_folder: { name: 'Downloads' }, find_files: { query: 'laporan' },
  open_file: { path: path.join(HOME, 'Documents', 'laporan.pdf') },
  type_text: { text: 'Helo' }, press_key: { key: 'copy' },
  mail_send: { to: 'ali@example.com', subject: 'Hai', body: 'Apa khabar' }, mail_send_reply: { id: 12, body: 'Baik' },
  run_shell: { command: 'ls ~/Desktop' }, trash_file: { path: path.join(HOME, 'Downloads', 'lama.zip') },
  open_any: { path: '/Applications/Safari.app' }, restart: {}, shutdown: {},
  contacts_search: { query: 'Ali' }, photos_search: { query: 'Siti' }, storage_scan: {}, see_screen: {},
  outlook_draft: { to: 'ali@example.com', subject: 'Hai & salam', body: 'Apa khabar?' },
  applescript: { script: 'tell application "Finder" to activate' },
  system_stats: {},
  record_screen: { seconds: 30 }, stop_recording: {}, mouse_click: { x: 100, y: 200 },
};

test('every tool has a sample and builds a command of plain strings', () => {
  assert.deepStrictEqual(Object.keys(SAMPLES).sort(), declarations.map(d => d.name).sort());
  for (const [name, args] of Object.entries(SAMPLES)) {
    const [file, argv] = plan(name, args);
    assert.strictEqual(typeof file, 'string', name);
    assert.ok(argv.every(a => typeof a === 'string'), name);
  }
});

test('every AppleScript compiles', () => {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-')), 'x.scpt');
  const cases = { ...SAMPLES, reminder_no_due: { title: 'Beli susu' } };
  for (const key of Object.keys(KEY_NAMES)) cases['key_' + key] = { key };
  for (const [name, args] of Object.entries(cases)) {
    const tool = name.startsWith('key_') ? 'press_key' : name === 'reminder_no_due' ? 'reminder_add' : name;
    const [file, argv] = plan(tool, args);
    if (file === 'osascript' && argv[0] === '-l') execFileSync('osacompile', ['-l', 'JavaScript', '-o', out, '-e', argv[3]], { stdio: 'pipe' });
    else if (file === 'osascript') execFileSync('osacompile', ['-o', out, '-e', argv[1]], { stdio: 'pipe' });
    for (const a of argv) if (a.startsWith('on run argv')) execFileSync('osacompile', ['-o', out, '-e', a], { stdio: 'pipe' });   // scripts handed to zsh
  }
});
const KEY_NAMES = Object.fromEntries(
  declarations.find(d => d.name === 'press_key').parameters.properties.key.description.split(', ').map(k => [k, 1]));

test('model text is passed as argv, never spliced into AppleScript', () => {
  const evil = 'x" & (do shell script "touch /tmp/pwned") & "';
  for (const [name, args] of [
    ['mail_draft', { to: 'a@b.co', subject: evil, body: evil }], ['note_add', { title: evil, body: evil }],
    ['type_text', { text: evil }], ['calendar_add', { title: evil, start: '2026-11-20T15:30', minutes: 30 }],
    ['notes_search', { query: evil }], ['mail_draft_reply', { id: 1, body: evil }],
  ]) {
    const [, argv] = plan(name, args);
    assert.ok(!argv[1].includes('pwned'), name);
    assert.strictEqual(argv[2], '--', name);
    assert.ok(argv.slice(3).includes(evil), name);
  }
});

test('app names that could break a command are rejected', () => {
  for (const name of ['Safari" to quit\ndo shell script "rm -rf ~', 'a\\b', '-x', '', 42, undefined]) {
    assert.throws(() => plan('quit_app', { name }));
    assert.throws(() => plan('open_app', { name }));
  }
});

test('open_url allows http and https only', () => {
  assert.deepStrictEqual(plan('open_url', SAMPLES.open_url)[1].slice(3, 5), ['https://example.com/a', 'example.com']);
  for (const url of ['file:///etc/passwd', 'javascript:alert(1)', '-a Calculator', 'not a url', undefined]) {
    assert.throws(() => plan('open_url', { url }));
  }
});

test('searches encode the query', () => {
  assert.strictEqual(plan('web_search', SAMPLES.web_search)[1][3], 'https://www.google.com/search?q=nasi%20lemak%20%26%20teh');
  assert.strictEqual(plan('play_song', { query: 'a b' })[1][3], 'spotify:search:a%20b');
  assert.throws(() => plan('web_search', { query: '  ' }));
});

test('numbers, booleans and choices are validated', () => {
  for (const level of [-1, 101, 1.5, '5; do shell script "x"', undefined]) assert.throws(() => plan('set_volume', { level }));
  assert.throws(() => plan('mute', { on: 'yes' }));
  assert.throws(() => plan('calendar_events', { days: 99 }));
  assert.throws(() => plan('media', { app: 'Finder', action: 'play' }));
  assert.throws(() => plan('media', { app: 'Spotify', action: 'quit' }));
  assert.throws(() => plan('press_key', { key: 'cmd+q' }));
  assert.throws(() => plan('open_folder', { name: '../../etc' }));
});

test('dates and email addresses are validated', () => {
  assert.deepStrictEqual(plan('calendar_add', SAMPLES.calendar_add)[1].slice(3), ['Mesyuarat', '2026', '11', '20', '15', '30', '60']);
  for (const start of ['esok petang', '2026-13-40T00:00', '', undefined]) {
    assert.throws(() => plan('calendar_add', { title: 'x', start, minutes: 30 }));
  }
  for (const to of ['ali', 'a@b', 'a b@c.com', '"x"@y.com', undefined]) {
    assert.throws(() => plan('mail_draft', { to, subject: 's', body: 'b' }));
  }
});

test('open_file allows only document types inside the home folder', () => {
  assert.deepStrictEqual(plan('open_file', SAMPLES.open_file), ['open', [path.join(HOME, 'Documents', 'laporan.pdf')]]);
  for (const p of ['/etc/passwd.txt', path.join(HOME, 'x.command'), path.join(HOME, 'Foo.app'), path.join(HOME, 'run.sh'),
    path.join(HOME, 'a', '..', '..', 'other', 'x.pdf'), path.join(HOME, 'noext'), undefined]) {
    assert.throws(() => plan('open_file', { path: p }));
  }
});

test('type_text turns line breaks into Return', () => {
  assert.strictEqual(plan('type_text', { text: 'satu\ndua' })[1][3], 'satu\rdua');
});

test('dangerous tools are flagged for on-screen confirmation, ordinary ones are not', () => {
  assert.deepStrictEqual([...confirm].sort(),
    ['applescript', 'code_agent', 'mail_send', 'mail_send_reply', 'open_any', 'restart', 'run_shell', 'shutdown', 'trash_file']);
  assert.ok(!confirm.includes('open_app'));
});

test('run_shell passes the command as one zsh argument', () => {
  assert.deepStrictEqual(plan('run_shell', { command: 'echo "a b" | wc -c' }), ['/bin/zsh', ['-lc', 'echo "a b" | wc -c']]);
  for (const command of ['', '   ', 42, undefined]) assert.throws(() => plan('run_shell', { command }));
});

test('trash_file only accepts paths inside the home folder', () => {
  assert.strictEqual(plan('trash_file', SAMPLES.trash_file)[1][3], path.join(HOME, 'Downloads', 'lama.zip'));
  for (const p of ['/etc/hosts', HOME, HOME + '/', path.join(HOME, 'a', '..', '..', 'x'), '', undefined]) {
    assert.throws(() => plan('trash_file', { path: p }));
  }
});

test('mail_send validates the recipient', () => {
  assert.throws(() => plan('mail_send', { to: 'bukan email', subject: 's', body: 'b' }));
});

test('unknown tools are rejected', () => {
  for (const name of ['run_shell', 'constructor', '__proto__', undefined]) assert.throws(() => plan(name, {}));
});

test('isLocal accepts the local page and rejects other sites', () => {
  assert.ok(isLocal({ host: 'localhost:4199' }, 4199));
  assert.ok(isLocal({ host: '127.0.0.1:4199', origin: 'http://127.0.0.1:4199' }, 4199));
  assert.ok(!isLocal({ host: 'localhost:4199', origin: 'https://evil.example' }, 4199));
  assert.ok(!isLocal({ host: 'evil.example:4199' }, 4199));
  assert.ok(!isLocal({}, 4199));
});

test('outlook_draft opens an encoded mailto in Outlook and never sends', () => {
  assert.deepStrictEqual(plan('outlook_draft', SAMPLES.outlook_draft),
    ['open', ['-a', 'Microsoft Outlook', 'mailto:ali@example.com?subject=Hai%20%26%20salam&body=Apa%20khabar%3F']]);
  assert.ok(!confirm.includes('outlook_draft'));
  for (const to of ['bukan email', 'a@b.co?bcc=x@y.co', 'a@b.co&body=x', undefined]) {
    assert.throws(() => plan('outlook_draft', { to, subject: 's', body: 'b' }));
  }
});

test('read-only checks need no confirmation; free-form scripts always do', () => {
  for (const name of ['contacts_search', 'photos_search', 'storage_scan', 'see_screen']) assert.ok(!confirm.includes(name), name);
  assert.ok(confirm.includes('applescript'));
  for (const script of ['', '  ', 42, undefined]) assert.throws(() => plan('applescript', { script }));
});

test('storage_scan never deletes anything', () => {
  const script = plan('storage_scan', {})[1][1];
  assert.ok(!/\b(rm|mv|rmdir|unlink|trash_file)\b/.test(script));
  assert.deepStrictEqual(slow, ['storage_scan']);
  assert.deepStrictEqual(image, ['see_screen']);
});

test('every tool belongs to exactly one permission group', () => {
  assert.deepStrictEqual(groups.flatMap(g => g.tools).sort(), declarations.map(d => d.name).sort());
});

test('switching a group off blocks its tools and nothing else', () => {
  assert.strictEqual(blocked([]).size, 0);
  const b = blocked(['music']);
  assert.deepStrictEqual([...b].sort(), ['media', 'now_playing', 'play_song']);
  assert.ok(!b.has('mail_inbox'));
  assert.ok(blocked(['mail', 'scripts']).has('run_shell'));
});

test('bad permission data is ignored instead of trusted', () => {
  for (const off of [undefined, null, 'music', { music: 1 }, ['__proto__', 'constructor', 42, 'nope']]) {
    assert.deepStrictEqual(cleanOff(off), []);
    assert.strictEqual(blocked(off).size, 0);
  }
  assert.deepStrictEqual(cleanOff(['nope', 'music']), ['music']);
});

test('system_stats is a fixed read-only script that takes no input', () => {
  const [file, argv] = plan('system_stats', { anything: '; rm -rf ~' });
  assert.strictEqual(file, '/bin/zsh');
  assert.deepStrictEqual(argv, plan('system_stats', {})[1]);          // arguments never reach the command
  assert.ok(!/\b(rm|mv|kill|sudo|shutdown)\b/.test(argv[1]));
  assert.ok(!confirm.includes('system_stats'));
  assert.ok(groups.find(g => g.id === 'system').tools.includes('system_stats'));
});

test('saving an API key replaces only the key line and rejects anything that is not a key', () => {
  const key = 'TESTKEY_testkey_TESTKEY_testkey_-0001';
  assert.strictEqual(envWithKey('', key), 'GEMINI_API_KEY=' + key + '\n');
  assert.strictEqual(envWithKey('VOICE=Kore\nGEMINI_API_KEY=old\nMODEL=x\n', '  ' + key + ' '), 'VOICE=Kore\nGEMINI_API_KEY=' + key + '\nMODEL=x\n');
  for (const bad of ['', 'short', key + '\nMODEL=evil', key + ' x', 'a'.repeat(200), 42, undefined, null]) {
    assert.throws(() => envWithKey('', bad));
  }
});

test('web tools reuse the tab of the same site instead of opening a new one', () => {
  const [file, argv] = plan('youtube', { query: 'Siti Nurhaliza' });
  assert.strictEqual(file, '/bin/zsh');
  assert.deepStrictEqual(argv.slice(3, 5), ['https://www.youtube.com/results?search_query=Siti%20Nurhaliza', 'youtube.com']);
  assert.ok(argv[5].includes('set URL of t to u') && !argv[5].includes('Siti'));   // the query travels as an argument only
  assert.ok(!argv[1].includes('Siti'));
  assert.strictEqual(plan('web_search', { query: 'gym' })[1][4], 'google.com/search');
});

test('youtube plays the first video only when asked, and the lookup is valid shell', () => {
  assert.strictEqual(plan('youtube', { query: 'a' })[1][6], '');
  assert.strictEqual(plan('youtube', { query: 'a', play: true })[1][6], '1');
  assert.strictEqual(plan('youtube', { query: 'a', play: false })[1][6], '');
  assert.throws(() => plan('youtube', { query: 'a', play: 'ya' }));
  require('node:child_process').execFileSync('/bin/zsh', ['-n', '-c', plan('youtube', { query: 'a' })[1][1]]);
});

test('screen recording length and mouse position are validated and passed as arguments', () => {
  const rec = plan('record_screen', { seconds: 30 })[1];
  assert.strictEqual(rec.at(-1), '30');
  assert.ok(!rec[1].includes('30'));
  for (const seconds of [0, 4, 601, 1.5, '30; rm -rf ~', undefined]) assert.throws(() => plan('record_screen', { seconds }));
  const click = plan('mouse_click', { x: 100, y: 200, double: true })[1];
  assert.deepStrictEqual(click.slice(-3), ['100', '200', '2']);
  assert.strictEqual(plan('mouse_click', { x: 1, y: 2 })[1].at(-1), '1');
  for (const x of [-1, 20000, 1.5, 'abc', undefined]) assert.throws(() => plan('mouse_click', { x, y: 5 }));
  assert.throws(() => plan('mouse_click', { x: 5, y: 5, double: 'yes' }));
  for (const name of ['record_screen', 'stop_recording', 'mouse_click']) assert.ok(groups.find(g => g.id === 'screen').tools.includes(name), name);
});

test('starting a session in one window tells every other Jarvis window to stop', async () => {
  const http = require('node:http');
  const PORT = 4300 + Math.floor(Math.random() * 500);
  const server = require('node:child_process').spawn(process.execPath, ['server.js'], { cwd: __dirname, env: { ...process.env, PORT } });
  try {
    await new Promise(done => server.stdout.once('data', done));
    const heard = new Promise((done, fail) => {
      http.get({ host: 'localhost', port: PORT, path: '/events' }, res => {
        let text = '';
        res.on('data', c => { text += c; if (text.includes('data:')) { res.destroy(); done(text); } });
      }).on('error', fail);
    });
    await new Promise(done => setTimeout(done, 200));   // let the listener connect first
    const post = (body, headers = {}) => fetch(`http://localhost:${PORT}/claim`, { method: 'POST', body, headers }).then(r => r.status);
    assert.strictEqual(await post('abc123 <script>'), 200);
    assert.match(await heard, /data: abc123script\n/);   // only letters and digits are passed on
    assert.strictEqual(await post('x', { origin: 'https://evil.example' }), 403);
  } finally {
    server.kill();
  }
});

test('"Hai Jarvis" wakes Jarvis and "Bye Jarvis" sends it away, other speech does neither', () => {
  const page = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  const { WAKE, BYE } = new Function(page.match(/const NAME = .*\n.*\n.*\n/)[0] + 'return { WAKE, BYE };')();
  for (const s of ['hai jarvis', 'Hello Jarvis', 'hi, Jarvis buka youtube', 'hey jervis', 'Helo Javis.']) assert.match(s, WAKE, s);
  for (const s of ['jarvis', 'hai', 'saya nak tengok chai jarvis', 'mahai jarvisa', 'bye jarvis']) assert.doesNotMatch(s, WAKE, s);
  for (const s of ['bye bye jarvis', 'Bye Jarvis', 'ok stop Jarvis', 'okay stop jarvis', 'stop, Jarvis.', 'bai bai jarvis']) assert.match(s, BYE, s);
  for (const s of ['stop lagu ni', 'hai jarvis', 'jarvis stop muzik', 'bye bye semua']) assert.doesNotMatch(s, BYE, s);
});

test('only the first window that hears the wake words may start', async () => {
  const PORT = 4300 + Math.floor(Math.random() * 500);
  const server = require('node:child_process').spawn(process.execPath, ['server.js'], { cwd: __dirname, env: { ...process.env, PORT } });
  try {
    await new Promise(done => server.stdout.once('data', done));
    const wake = () => fetch(`http://localhost:${PORT}/wake`, { method: 'POST' }).then(r => r.json());
    assert.deepStrictEqual(await wake(), { go: true });
    assert.deepStrictEqual(await wake(), { go: false });
  } finally {
    server.kill();
  }
});

test('shared settings keep only known keys with short text or yes/no values', () => {
  const { cleanSettings } = require('./tools');
  assert.deepStrictEqual(cleanSettings({ lang: 'en', wake: false, brief: true, call: 'Boss', mini: 'l' }), { lang: 'en', wake: false, brief: true, call: 'Boss', mini: 'l' });
  assert.deepStrictEqual(cleanSettings({ lang: 'x'.repeat(41), evil: 'y', theme: { a: 1 }, wake: 'ya' }), {});
  for (const bad of [null, undefined, 'teks', 42, []]) assert.deepStrictEqual(cleanSettings(bad), {});
});

test('a settings save in one window reaches every other window', async () => {
  const http = require('node:http');
  const PORT = 4300 + Math.floor(Math.random() * 500);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-'));
  for (const f of ['server.js', 'tools.js']) fs.copyFileSync(path.join(__dirname, f), path.join(dir, f));
  const server = require('node:child_process').spawn(process.execPath, ['server.js'], { cwd: dir, env: { ...process.env, PORT } });
  try {
    await new Promise(done => server.stdout.once('data', done));
    const url = `http://localhost:${PORT}/settings`;
    assert.deepStrictEqual(await fetch(url).then(r => r.json()), {});
    const heard = new Promise(done => http.get({ host: 'localhost', port: PORT, path: '/events' }, res =>
      res.on('data', c => { if (String(c).includes('event: settings')) { res.destroy(); done(); } })));
    await new Promise(done => setTimeout(done, 200));
    assert.strictEqual((await fetch(url, { method: 'POST', body: JSON.stringify({ lang: 'id', wake: false, x: 1 }) })).status, 200);
    await heard;
    assert.deepStrictEqual(await fetch(url).then(r => r.json()), { lang: 'id', wake: false });
    assert.strictEqual((await fetch(url, { method: 'POST', body: 'bukan json' })).status, 400);
  } finally {
    server.kill();
    fs.rmSync(dir, { recursive: true });
  }
});

test('character data keeps only safe, bounded values', () => {
  const { cleanCharacter } = require('./tools');
  assert.deepStrictEqual(cleanCharacter({ name: ' Mimi ', voice: 'Puck', pitch: 1.3, persona: 'ceria', mouth: [0, 1, .5], eyes: [[0, 1.4, .5], 'x', [1, 2]], size: .1, eyeSize: .05 }),
    { name: 'Mimi', voice: 'Puck', pitch: 1.3, persona: 'ceria', mouth: [0, 1, .5], eyes: [[0, 1.4, .5]], size: .1, eyeSize: .05 });
  assert.deepStrictEqual(cleanCharacter({ pitch: 9, voice: 'Bob', mouth: [0, 'a', 1], size: -1, name: '   ' }), { pitch: 1.6 });
  assert.strictEqual(cleanCharacter({ name: 'x'.repeat(50) }).name.length, 30);
  for (const bad of [null, 'teks', 42]) assert.deepStrictEqual(cleanCharacter(bad), {});
});

test('characters can be added, edited, listed, served and removed, and bad ids are refused', async () => {
  const PORT = 4300 + Math.floor(Math.random() * 500);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-'));
  for (const f of ['server.js', 'tools.js']) fs.copyFileSync(path.join(__dirname, f), path.join(dir, f));
  const server = require('node:child_process').spawn(process.execPath, ['server.js'], { cwd: dir, env: { ...process.env, PORT } });
  const url = p => `http://localhost:${PORT}${p}`;
  try {
    await new Promise(done => server.stdout.once('data', done));
    assert.strictEqual((await fetch(url('/characters?name=x'), { method: 'POST', body: 'bukan glb' })).status, 400);
    const glb = Buffer.concat([Buffer.from('glTF'), Buffer.alloc(16)]);
    const { id } = await fetch(url('/characters?name=Kucing%20Biru'), { method: 'POST', body: glb }).then(r => r.json());
    assert.match(id, /^kucing-biru-[a-z0-9]{4}$/);
    assert.strictEqual((await fetch(url('/characters/' + id), { method: 'POST', body: JSON.stringify({ voice: 'Puck', pitch: 1.2, evil: 1 }) })).status, 200);
    assert.deepStrictEqual(await fetch(url('/characters')).then(r => r.json()), [{ id, name: 'Kucing Biru', voice: 'Puck', pitch: 1.2 }]);
    assert.deepStrictEqual(Buffer.from(await fetch(url(`/characters/${id}/model.glb`)).then(r => r.arrayBuffer())), glb);
    assert.strictEqual((await fetch(url('/characters/..%2Fserver.js/model.glb'))).status, 404);
    assert.strictEqual((await fetch(url('/characters/' + id), { method: 'DELETE' })).status, 200);
    assert.deepStrictEqual(await fetch(url('/characters')).then(r => r.json()), []);
  } finally {
    server.kill();
    fs.rmSync(dir, { recursive: true });
  }
});

test('calculate works out maths exactly and refuses anything that is not maths', () => {
  const run = expression => { const [file, argv] = plan('calculate', { expression }); return execFileSync(file, argv, { encoding: 'utf8' }).trim(); };
  assert.strictEqual(run('(2*3+sqrt(16))^2/5'), '20');
  assert.strictEqual(run('sin(rad(30))'), '0.5');
  assert.strictEqual(run('log(1000) + ln(e)'), '4');
  assert.strictEqual(run('7 × 8 ÷ 2'), '28');
  assert.match(run('sqrt(-1)'), /Tiada jawapan nyata/);
  for (const bad of ['process.exit()', 'require("fs")', 'constructor', '1;alert(1)', 'x=1', '`a`', 'M']) assert.throws(() => plan('calculate', { expression: bad }), bad);
});

test('live world tools pass what the user said only as arguments, and check currency codes', () => {
  for (const [name, args, said] of [['news', { query: 'banjir; rm -rf ~' }, 'banjir; rm -rf ~'], ['weather', { city: 'Kota $(Bharu)' }, null]]) {
    const argv = plan(name, args)[1];
    assert.ok(!argv[1].includes('rm -rf') && !argv[1].includes('Bharu'), name);
    if (said) assert.ok(argv.includes(said), name);
  }
  assert.ok(plan('weather', { city: 'Kota $(Bharu)' })[1].includes('Kota%20%24(Bharu)'));
  assert.deepStrictEqual(plan('exchange_rate', { from: 'usd', to: 'myr, sgd', amount: 50 })[1].slice(-2), ['MYR,SGD', '50']);
  for (const bad of [{ from: 'US', to: 'MYR' }, { from: 'USD', to: 'MYR;ls' }, { from: '$(x)', to: 'MYR' }]) assert.throws(() => plan('exchange_rate', bad));
});

test('WhatsApp opens a typed reply without sending it, and flights only search', () => {
  assert.deepStrictEqual(plan('whatsapp_message', { phone: '012-345 6789', text: 'Jumpa & makan?' }), ['open', ['whatsapp://send?phone=60123456789&text=Jumpa%20%26%20makan%3F']]);
  assert.strictEqual(plan('whatsapp_message', { phone: '+65 9123 4567', text: 'hi' })[1][0], 'whatsapp://send?phone=6591234567&text=hi');
  for (const bad of [{ phone: '123', text: 'hi' }, { phone: '0123456789;ls', text: 'hi' }, { phone: '0123456789', text: '' }]) assert.throws(() => plan('whatsapp_message', bad));
  const argv = plan('flights', { from: 'KUL', to: 'Tokyo', date: '2026-12-10', people: 2 })[1];
  assert.ok(argv.includes('https://www.google.com/travel/flights?q=' + encodeURIComponent('Flights from KUL to Tokyo on 2026-12-10 one way for 2 passengers')));
  assert.throws(() => plan('flights', { from: 'KUL', to: 'Tokyo', date: '10/12/2026' }));
  assert.ok(!confirm.includes('whatsapp_message'));   // it never sends, so no approval needed
});

test('code tools read and check real files, refuse secrets and folders outside home, and editing needs approval', () => {
  const run = (name, args) => { const [file, argv] = plan(name, args); return execFileSync(file, argv, { encoding: 'utf8' }); };
  assert.match(run('read_code', { path: __filename, from: 1, to: 2 }), /baris\. Baris 1 hingga 2:\n1  const test/);
  const good = path.join(__dirname, '.check-ok.js'), broken = path.join(__dirname, '.check-bad.js'), json = path.join(__dirname, '.check.json');
  fs.writeFileSync(good, 'const a = 1;\n'); fs.writeFileSync(broken, 'const a = ;\n'); fs.writeFileSync(json, '{"a": }');
  try {
    assert.match(run('check_code', { path: good }), /Tiada ralat sintaks/);
    assert.match(run('check_code', { path: broken }), /Ralat:[\s\S]*SyntaxError/);
    assert.match(run('check_code', { path: json }), /Ralat JSON/);
  } finally { for (const f of [good, broken, json]) fs.rmSync(f); }
  for (const bad of ['/etc/passwd', path.join(__dirname, '.env'), path.join(HOME, '.ssh', 'id_rsa'), path.join(__dirname, 'tiada.js')]) assert.throws(() => plan('read_code', { path: bad }), bad);
  assert.throws(() => plan('code_agent', { folder: __filename, task: 'x' }));   // must be a folder
  assert.ok(confirm.includes('code_agent') && !confirm.includes('read_code'));
  assert.ok(plan('code_agent', { folder: __dirname, task: 'a; rm -rf ~' })[1].includes('a; rm -rf ~'));   // the task is an argument, not shell text
});
