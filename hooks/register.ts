import type { EngineInterface, Register } from 'claude-code'
import type { LanguagePack, MessageKey } from '../types'

// ── What makes a checkout BOT. ─────────────────────────────────────────

/** Files every BOT. checkout has at its git root. */
export const FINGERPRINT = [
  'src/bot.py',
  'src/cogs',
  'src/locales/help.py',
  'src/utils/command_sync.py',
  'pyproject.toml',
] as const

/** The upstream repository and its root commit (history as of 2026-11-11). */
export const UPSTREAM = { owner: 'keeiv', repo: 'bot' } as const
export const UPSTREAM_ROOTS = ['94daa94685e308daf3d6c8a9a81a83b97a7d816a'] as const

const PROJECT_NAME = /^\s*name\s*=\s*"discord-bot"\s*$/m
const UPSTREAM_URL = /github\.com[:/]keeiv\/bot(?:\.git)?\/?$/i

export type Role = 'owner' | 'contributor' | 'derivative'

export type Facts = {
  /** The git top level, or null outside a repository. */
  root: string | null
  /** Which fingerprint paths exist under the root. */
  present: readonly string[]
  /** Whether pyproject.toml names the project discord-bot. */
  isNamed: boolean
  /** Remote name to fetch URL. */
  remotes: Readonly<Record<string, string>>
  /** Root commits of HEAD. */
  rootCommits: readonly string[]
  /** git config user.name, or empty. */
  userName: string
  /** git config bot-dev.role, when the person pinned one. */
  pinnedRole: string
}

export type Detection =
  | { isProject: false; reason: string }
  | { isProject: true; root: string; role: Role; reasons: readonly string[] }

/** Decides from gathered facts whether this is BOT. and who is working on it. */
export function classify(facts: Facts): Detection {
  if (!facts.root) return { isProject: false, reason: 'not inside a git repository' }
  const missing = FINGERPRINT.filter(path => !facts.present.includes(path))
  if (missing.length > 0) {
    return { isProject: false, reason: `missing ${missing.join(', ')}` }
  }
  if (!facts.isNamed) {
    return { isProject: false, reason: 'pyproject.toml does not name discord-bot' }
  }

  const reasons: string[] = []
  const upstreamRemotes = Object.entries(facts.remotes)
    .filter(([, url]) => UPSTREAM_URL.test(url))
    .map(([name]) => name)
  const sharesRoot = facts.rootCommits.some(commit =>
    (UPSTREAM_ROOTS as readonly string[]).includes(commit),
  )
  if (upstreamRemotes.length > 0) reasons.push(`remote ${upstreamRemotes.join(', ')} is keeiv/bot`)
  if (sharesRoot) reasons.push('shares the keeiv/bot root commit')

  const pinned = facts.pinnedRole.trim().toLowerCase()
  if (pinned === 'owner' || pinned === 'contributor') {
    reasons.push(`role pinned by git config bot-dev.role`)
    return { isProject: true, root: facts.root, role: pinned, reasons }
  }

  if (upstreamRemotes.length === 0 && !sharesRoot) {
    reasons.push('no remote or history ties it to keeiv/bot')
    return { isProject: true, root: facts.root, role: 'derivative', reasons }
  }
  const isOwner =
    upstreamRemotes.includes('origin') &&
    facts.userName.trim().toLowerCase() === UPSTREAM.owner
  reasons.push(isOwner ? 'origin is keeiv/bot and git user is keeiv' : 'a clone or fork of keeiv/bot')
  return { isProject: true, root: facts.root, role: isOwner ? 'owner' : 'contributor', reasons }
}

// ── Reading the checkout ───────────────────────────────────────────────

type Host = EngineInterface

async function git($: Host, cwd: string, args: string[]): Promise<string | null> {
  try {
    const run = await $.process.run(['git', ...args], { cwd, timeoutMs: 5000 })
    return run.exitCode === 0 ? run.stdout.trim() : null
  } catch {
    return null
  }
}

async function gather($: Host, cwd: string): Promise<Facts> {
  const root = await git($, cwd, ['rev-parse', '--show-toplevel'])
  if (!root) {
    return { root: null, present: [], isNamed: false, remotes: {}, rootCommits: [], userName: '', pinnedRole: '' }
  }
  const present: string[] = []
  for (const path of FINGERPRINT) {
    if (await $.fs.exists(`${root}/${path}`)) present.push(path)
  }
  let isNamed = false
  if (present.includes('pyproject.toml')) {
    try {
      isNamed = PROJECT_NAME.test(String(await $.fs.read(`${root}/pyproject.toml`)))
    } catch {
      isNamed = false
    }
  }
  const remotes: Record<string, string> = {}
  for (const line of ((await git($, root, ['remote', '-v'])) ?? '').split('\n')) {
    const match = /^(\S+)\s+(\S+)\s+\(fetch\)$/.exec(line.trim())
    const [, name, url] = match ?? []
    if (name && url) remotes[name] = url
  }
  const rootCommits = ((await git($, root, ['rev-list', '--max-parents=0', 'HEAD'])) ?? '')
    .split('\n')
    .filter(Boolean)
  const userName = (await git($, root, ['config', 'user.name'])) ?? ''
  const pinnedRole = (await git($, root, ['config', '--get', 'bot-dev.role'])) ?? ''
  return { root, present, isNamed, remotes, rootCommits, userName, pinnedRole }
}

// ── Language ───────────────────────────────────────────────────────────

const LANGUAGE = { plugin: 'bot-dev', key: 'language' } as const

const ENGLISH: Record<MessageKey, string> = {
  'command.description': 'BOT.: detect this checkout, its role and live layout',
  notProject: 'Not inside a BOT. checkout ({reason}); bot-dev stays inactive.',
  'scan.header': 'BOT. {version}, role: {role} ({reasons})',
  'scan.location': 'Location: {root}',
  'scan.branch': 'Branch: {branch}, latest commit: {head}, uncommitted: {changed} paths',
  'scan.layout':
    'Cogs: core {core}, features {features}, games {games}; services {services}; locale modules {locales}; test files {tests}',
  'role.owner': 'owner',
  'role.contributor': 'contributor',
  'role.derivative': 'derivative',
  'check.description': 'BOT.: run the CI checks (pytest, flake8, black, isort, bandit)',
  'check.header': 'Checks in {root} with {python}:',
  'check.passed': '{name}: passed ({seconds}s)',
  'check.failed': '{name}: failed ({seconds}s)',
  'check.summary.ok': 'All checks passed. MySQL integration tests only run in CI.',
  'check.summary.failed': '{count} check(s) failed; the output went to Claude.',
}

export const DEFAULT_LANGUAGE: LanguagePack = { tag: 'en' }

/** Fills {name} placeholders; an unknown name is left as written. */
export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in values ? String(values[name]) : whole,
  )
}

export function say(pack: LanguagePack, key: MessageKey, values: Record<string, string | number> = {}): string {
  return fill(pack.messages?.[key] ?? ENGLISH[key], values)
}

/** Writes the default so a language pack plugin's state.set hook can swap it. */
async function announceLanguage($: Host): Promise<void> {
  await $.state.set(LANGUAGE, DEFAULT_LANGUAGE)
}

async function currentLanguage($: Host): Promise<LanguagePack> {
  const { value } = await $.state.get(LANGUAGE)
  return value ?? DEFAULT_LANGUAGE
}

// ── What Claude is told ────────────────────────────────────────────────

const ROLE_RULES: Record<Role, string> = {
  owner:
    'You work with the owner (maintainer) of keeiv/bot. Within the agreed scope, commit to main and push directly; no pull request. Before pushing: git fetch and confirm main...origin/main is 0 0, run every check below, stage explicit paths only, scan the staged diff for secrets. After pushing: confirm 0 0 again and wait for the "CI Pipeline" workflow (it includes the MySQL integration job). Force pushes and history rewrites need the owner\'s explicit consent each time.',
  contributor:
    'This is a clone or fork of keeiv/bot by a contributor. Never push to keeiv/bot directly: work on a branch of the fork and open a pull request. PR title uses the commit prefix plus a Traditional Chinese summary; the body states the problem, the new behaviour and the verification, links any issue, and for data migrations adds backup, compatibility and rollback. A PR with a security risk is not merged. Open an issue first for new dependencies, data format or table changes, cross-module restructuring, or changes to existing commands or permissions.',
  derivative:
    'This checkout looks like BOT. but no remote or history ties it to keeiv/bot. Apply the same engineering rules, but do not assume the keeiv/bot owner\'s workflow: ask how changes are shipped here before pushing anything.',
}

export function projectSection(root: string, role: Role, knowledge: string, replyLanguage?: string): string {
  return [
    `# BOT. project (bot-dev plugin)`,
    `You are inside a BOT. checkout at ${root}: a discord.py 2.7 bot, Python 3.11+, AGPL-3.0. Role: ${role}.`,
    ROLE_RULES[role],
    '',
    'Rules that hold for every change:',
    '- Cogs in src/cogs/{core,features,games} handle Discord parameters, permissions, defer and presentation; business rules, saving and queries live in src/services; shared helpers in src/utils. Every non-package module under src/cogs needs async def setup(bot); one failed load stops startup.',
    '- Sync storage work goes through await run_storage(fn, ...) with read, change and save in one job. Documents use read_document()/write_document() from src/utils/document_store.py; never fall back to old JSON in MySQL mode. A failed save raises and changes nothing in memory.',
    '- Member-facing text exists in English and Chinese: MESSAGES in src/locales/*_messages.py via tx("key"), entry points under @localized(...); command and option descriptions are English in code with Chinese in src/locales/commands.py TEXT; /help lives in src/locales/help.py CATEGORIES.',
    '- Comments and docstrings in English only; section banners only as "# ── Title ───" padded to 68 characters.',
    '- Sync commands with sync_global() from src/utils/command_sync.py, never tree.sync().',
    '- Done means all of these pass from the repo root: python -m pytest -q; python -m flake8 src services tests; python -m black --check src services tests; python -m isort --check-only src services tests; python -m bandit -r src services -ll. New files must be staged before tests/test_comment_style.py sees them. MySQL-only tests skip locally and run in CI. Report anything not run as not run.',
    '- Commit messages: "type: 繁體中文主旨" with type feat, fix, docs, style, refactor, test or chore; a Chinese body when needed. Never commit .env, data/, node pairing files or keys, run_bot*.bat, tokens, cookies or user data.',
    '',
    `Read these before larger work (they cite the repo docs that win any conflict): ${knowledge}/architecture.md, ${knowledge}/done.md, ${knowledge}/shipping.md, ${knowledge}/recipes.md (step-by-step changes), ${knowledge}/testing.md, ${knowledge}/map.md (where each feature lives). Run /scan for the live layout; /bot-check runs the CI checks.`,
    ...(replyLanguage ? [`Talk to the person in ${replyLanguage}.`] : []),
  ].join('\n')
}

// ── The scan ───────────────────────────────────────────────────────────

async function names($: Host, dir: string, suffix: string): Promise<string[]> {
  try {
    return (await $.fs.list(dir))
      .filter(entry => entry.kind === 'file' && entry.name.endsWith(suffix) && entry.name !== '__init__.py')
      .map(entry => entry.name.slice(0, -suffix.length))
      .sort()
  } catch {
    return []
  }
}

async function countTests($: Host, dir: string): Promise<number> {
  let total = 0
  try {
    for (const entry of await $.fs.list(dir)) {
      if (entry.kind === 'dir' && !entry.name.startsWith('.') && entry.name !== '__pycache__') {
        total += await countTests($, `${dir}/${entry.name}`)
      } else if (entry.kind === 'file' && /^test_.*\.py$/.test(entry.name)) {
        total += 1
      }
    }
  } catch {
    return total
  }
  return total
}

async function scan($: Host, pack: LanguagePack, root: string, role: Role, reasons: readonly string[]) {
  let version = '?'
  try {
    version = /^\s*version\s*=\s*"([^"]+)"/m.exec(String(await $.fs.read(`${root}/pyproject.toml`)))?.[1] ?? '?'
  } catch {
    version = '?'
  }
  const core = await names($, `${root}/src/cogs/core`, '.py')
  const features = await names($, `${root}/src/cogs/features`, '.py')
  const games = await names($, `${root}/src/cogs/games`, '.py')
  const services = await names($, `${root}/src/services`, '.py')
  const locales = await names($, `${root}/src/locales`, '.py')
  const tests = await countTests($, `${root}/tests`)
  const branch = (await git($, root, ['branch', '--show-current'])) || '(detached)'
  const changed = ((await git($, root, ['status', '--porcelain'])) ?? '').split('\n').filter(Boolean)
  const head = (await git($, root, ['log', '-1', '--format=%h %s'])) ?? ''

  const text = [
    say(pack, 'scan.header', { version, role: say(pack, `role.${role}`), reasons: reasons.join('; ') }),
    say(pack, 'scan.location', { root }),
    say(pack, 'scan.branch', { branch, head, changed: changed.length }),
    say(pack, 'scan.layout', {
      core: core.length,
      features: features.length,
      games: games.length,
      services: services.length,
      locales: locales.length,
      tests,
    }),
  ].join('\n')
  const context = [
    `bot-dev /scan of ${root} (version ${version}, role ${role}, branch ${branch}, ${changed.length} uncommitted paths).`,
    `Cogs core: ${core.join(', ')}.`,
    `Cogs features: ${features.join(', ')}.`,
    `Cogs games: ${games.join(', ')}.`,
    `Services: ${services.join(', ')}.`,
    `Locale modules: ${locales.join(', ')}.`,
    `${tests} test files under tests/.`,
    changed.length > 0 ? `Uncommitted: ${changed.slice(0, 40).join(' | ')}` : 'Working tree clean.',
  ].join('\n')
  return { text, context: [context] }
}

// ── The checks ─────────────────────────────────────────────────────────

/** The same checks CI runs, in its order. */
export const CHECKS: readonly (readonly [string, readonly string[]])[] = [
  ['pytest', ['-m', 'pytest', '-q']],
  ['flake8', ['-m', 'flake8', 'src', 'services', 'tests']],
  ['black', ['-m', 'black', '--check', 'src', 'services', 'tests']],
  ['isort', ['-m', 'isort', '--check-only', 'src', 'services', 'tests']],
  ['bandit', ['-m', 'bandit', '-r', 'src', 'services', '-ll']],
]

/** The project's virtual environment when there is one, else python on PATH. */
async function findPython($: Host, root: string): Promise<string> {
  for (const candidate of ['.venv/Scripts/python.exe', '.venv/bin/python']) {
    if (await $.fs.exists(`${root}/${candidate}`)) return `${root}/${candidate}`
  }
  return 'python'
}

/** The last lines of a check's output, enough to see why it failed. */
export function tail(output: string, lines = 25): string {
  return output.trimEnd().split('\n').slice(-lines).join('\n')
}

async function runChecks($: Host, pack: LanguagePack, root: string) {
  const python = await findPython($, root)
  const lines = [say(pack, 'check.header', { root, python })]
  const failures: string[] = []
  for (const [name, args] of CHECKS) {
    const started = Date.now()
    let exitCode = 1
    let output = ''
    try {
      const run = await $.process.run([python, ...args], { cwd: root, timeoutMs: 600000 })
      exitCode = run.exitCode
      output = `${run.stdout}\n${run.stderr}`
    } catch (error) {
      output = String(error)
    }
    const seconds = Math.round((Date.now() - started) / 1000)
    lines.push(say(pack, exitCode === 0 ? 'check.passed' : 'check.failed', { name, seconds }))
    if (exitCode !== 0) failures.push(`${name} failed (exit ${exitCode}):\n${tail(output)}`)
  }
  lines.push(
    failures.length === 0
      ? say(pack, 'check.summary.ok')
      : say(pack, 'check.summary.failed', { count: failures.length }),
  )
  const context =
    failures.length === 0
      ? [`bot-dev /bot-check in ${root}: every CI check passed (MySQL integration tests are CI-only).`]
      : [`bot-dev /bot-check in ${root}: ${failures.length} check(s) failed.\n\n${failures.join('\n\n')}`]
  return { text: lines.join('\n'), context }
}

// ── Hooks ──────────────────────────────────────────────────────────────

// One detection per working directory; /scan refreshes it. A reload starts over.
const detections = new Map<string, Promise<Detection>>()

function detect($: Host, cwd: string, isFresh = false): Promise<Detection> {
  const known = detections.get(cwd)
  if (known && !isFresh) return known
  const found = gather($, cwd).then(classify)
  detections.set(cwd, found)
  return found
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await announceLanguage($)
    await $.command.register({
      name: 'scan',
      description: say(await currentLanguage($), 'command.description'),
    })
    await $.command.register({
      name: 'bot-check',
      description: say(await currentLanguage($), 'check.description'),
    })
    void detect($, e.cwd)
    return started
  })

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    const found = await detect($, await $.session.cwd())
    if (!found.isProject) return composed
    const pack = await currentLanguage($)
    const section = {
      id: 'bot-dev:project',
      text: projectSection(found.root, found.role, pack.knowledge ?? `${$.plugin.root}/knowledge`, pack.replyLanguage),
      scope: 'session' as const,
    }
    return { sections: [...composed.sections, section] }
  })

  on('command.run', { command: 'scan' }, async $ => {
    // Announce again so a language pack loaded since the session began applies.
    await announceLanguage($)
    const pack = await currentLanguage($)
    const found = await detect($, await $.session.cwd(), true)
    if (!found.isProject) return { text: say(pack, 'notProject', { reason: found.reason }) }
    return scan($, pack, found.root, found.role, found.reasons)
  })

  on('command.run', { command: 'bot-check' }, async $ => {
    await announceLanguage($)
    const pack = await currentLanguage($)
    const found = await detect($, await $.session.cwd())
    if (!found.isProject) return { text: say(pack, 'notProject', { reason: found.reason }) }
    return runChecks($, pack, found.root)
  })
}
