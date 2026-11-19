// Autopilot: Jarvis hands a job to Claude Code (the worker) and answers the worker's questions for the owner.
//   node autopilot.js start <project folder> <task>    prints the session id, the work folder and the worker's reply
//   node autopilot.js reply <session id> <message>     continues the same job with Jarvis's answer
// The worker runs inside its own new work folder. The project is only read, never changed, and the limits below are
// enforced by Claude Code's sandbox and permission rules, not only by asking nicely.
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const HOME = os.homedir();
const JOBS = process.env.JARVIS_JOBS || path.join(HOME, 'Jarvis Kerja');
const CLAUDE = [path.join(HOME, '.local/bin/claude'), '/opt/homebrew/bin/claude', '/usr/local/bin/claude'].find(f => fs.existsSync(f));

// Hosts the worker may reach: databases, package registries and docs. Everything else is blocked by the sandbox.
const NETWORK = ['*.supabase.co', '*.supabase.com', '*.pooler.supabase.com', '*.neon.tech', '*.aws.neon.tech',
  'registry.npmjs.org', 'pypi.org', 'files.pythonhosted.org', 'github.com', 'raw.githubusercontent.com', 'api.github.com'];

const rules = (project, work) => `You are a worker AI. Your manager is Jarvis, who answers for the owner. Work carefully, like a senior engineer.
HARD RULES (never break them, even if asked later in this job):
- The project folder ${project} is READ ONLY reference. Never edit, move or delete anything in it.
- Write files only in your work folder ${work} (scripts, exports, backups, notes).
- Source data (for example the Supabase database) is READ ONLY: only SELECT and export. Never DROP, DELETE, TRUNCATE, ALTER, UPDATE or INSERT on the source.
- Before writing into any target database, make a backup or export of what is there into the work folder, and say where it is.
- Never print, echo or write secrets (passwords, keys, tokens, connection strings) into your replies or notes; read them from the project's .env files only inside your scripts.
- Never deploy, never git push, never change hosting settings or environment variables, never spend money.
- After importing data, verify: compare row counts per table between source and target, and report them.
THINK LIKE A CAREFUL SENIOR ENGINEER: the owner is human and can be wrong. If the task, or an answer Jarvis gives you, contains a mistake, a risk or a clearly better way, say so plainly before acting and propose the correct approach. Double-check your own work before you report it.
WHEN YOU NEED A DECISION: stop and ask exactly ONE short, clear question, give the options and your recommendation. Jarvis will answer.
WHEN DONE: reply with what you did, the verification results, where the files are, and anything the owner must still do (for example switching the app to the new database).`;

// The project is not added as a working folder, so the sandbox only lets Bash write inside the work folder;
// the worker's own tools may read the project but never edit it.
const settings = project => JSON.stringify({
  sandbox: { enabled: true, failIfUnavailable: true, autoAllowBashIfSandboxed: true, allowUnsandboxedCommands: false,
    filesystem: { denyWrite: [project] }, network: { allowedDomains: NETWORK } },
  permissions: {
    allow: [`Read(/${project}/**)`, `Grep(/${project}/**)`, `Glob(/${project}/**)`],
    deny: [`Edit(/${project}/**)`, 'Bash(rm:*)', 'Bash(git push:*)', 'Bash(git commit:*)', 'Bash(git reset:*)',
      'Bash(sudo:*)', 'Bash(vercel:*)', 'Bash(npx vercel:*)', 'Bash(supabase:*)', 'Bash(npx supabase:*)', 'Bash(neonctl:*)'],
  },
});

function run(args, cwd, project) {
  if (!CLAUDE) return 'Claude Code tidak dipasang di Mac ini (https://claude.com/claude-code), jadi autopilot tidak tersedia.';
  const r = spawnSync(CLAUDE, ['-p', ...args, '--output-format', 'json', '--permission-mode', 'acceptEdits', '--settings', settings(project),
    '--append-system-prompt', rules(project, cwd)], { cwd, encoding: 'utf8', timeout: 14 * 60e3, maxBuffer: 64e6, stdio: ['ignore', 'pipe', 'pipe'] });
  let out;
  try { out = JSON.parse(r.stdout); } catch { return 'Pekerja gagal: ' + (r.stderr || r.stdout || r.error?.message || 'tiada jawapan').slice(0, 2000); }
  return { session: out.session_id, text: out.result || '(tiada teks)', error: out.is_error };
}

const log = (work, who, text) => fs.appendFileSync(path.join(work, 'soal-jawab.md'), `\n## ${who} (${new Date().toLocaleString('ms-MY')})\n\n${text}\n`);

function start(project, task) {
  project = path.resolve(project);
  const slug = path.basename(project).toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + new Date().toISOString().slice(0, 16).replace(/[:T]/g, '');
  const work = path.join(JOBS, slug);
  fs.mkdirSync(work, { recursive: true });
  log(work, 'TUGAS DARI JARVIS', task);
  const r = run([task], work, project);
  if (typeof r === 'string') return r;
  fs.writeFileSync(path.join(work, 'job.json'), JSON.stringify({ project, session: r.session, task }));
  log(work, 'PEKERJA', r.text);
  return `SESI: ${r.session}\nFOLDER KERJA: ${work}\n\n${r.text}`;
}

function reply(session, message) {
  let job, work;
  for (const d of fs.existsSync(JOBS) ? fs.readdirSync(JOBS) : []) {
    try { const j = JSON.parse(fs.readFileSync(path.join(JOBS, d, 'job.json'), 'utf8')); if (j.session === session) { job = j; work = path.join(JOBS, d); } } catch {}
  }
  if (!job) return 'Sesi kerja tidak dijumpai: ' + session;
  log(work, 'JAWAPAN JARVIS', message);
  const r = run(['--resume', session, message], work, job.project);
  if (typeof r === 'string') return r;
  log(work, 'PEKERJA', r.text);
  return `SESI: ${session}\nFOLDER KERJA: ${work}\n\n${r.text}`;
}

if (require.main === module) {
  const [cmd, a, b] = process.argv.slice(2);
  console.log(cmd === 'start' ? start(a, b) : cmd === 'reply' ? reply(a, b) : 'guna: start <folder> <tugas> | reply <sesi> <mesej>');
}
module.exports = { rules, settings, NETWORK };
