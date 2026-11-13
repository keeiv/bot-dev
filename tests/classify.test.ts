import { expect, test } from 'claude-code/testing'
import { CHECKS, classify, DEFAULT_LANGUAGE, fill, FINGERPRINT, projectSection, say, tail, UPSTREAM_ROOTS } from '../hooks/register'
import type { Facts } from '../hooks/register'

const ROOT = 'C:/work/bot'
const UPSTREAM_ROOT = UPSTREAM_ROOTS[0]

function facts(over: Partial<Facts> = {}): Facts {
  return {
    root: ROOT,
    present: [...FINGERPRINT],
    isNamed: true,
    remotes: { origin: 'https://github.com/keeiv/bot.git' },
    rootCommits: [UPSTREAM_ROOT],
    userName: 'keeiv',
    pinnedRole: '',
    ...over,
  }
}

test('outside a git repository nothing is detected', async () => {
  expect(classify(facts({ root: null })).isProject).toBe(false)
})

test('a repository missing a fingerprint file is not BOT.', async () => {
  const found = classify(facts({ present: FINGERPRINT.filter(path => path !== 'src/bot.py') }))
  expect(found.isProject).toBe(false)
  if (!found.isProject) expect(found.reason).toContain('src/bot.py')
})

test('a project under another name is not BOT.', async () => {
  expect(classify(facts({ isNamed: false })).isProject).toBe(false)
})

test('the keeiv/bot origin with the keeiv git user is the owner', async () => {
  const found = classify(facts())
  expect(found.isProject && found.role).toBe('owner')
})

test('the owner check accepts an ssh origin and any letter case', async () => {
  const found = classify(facts({ remotes: { origin: 'git@github.com:keeiv/bot.git' }, userName: 'Keeiv' }))
  expect(found.isProject && found.role).toBe('owner')
})

test('a clone by someone else is a contributor', async () => {
  const found = classify(facts({ userName: 'someone' }))
  expect(found.isProject && found.role).toBe('contributor')
})

test('a fork with keeiv/bot as upstream is a contributor', async () => {
  const found = classify(
    facts({
      remotes: { origin: 'https://github.com/someone/bot.git', upstream: 'https://github.com/keeiv/bot' },
      userName: 'someone',
    }),
  )
  expect(found.isProject && found.role).toBe('contributor')
})

test('a fork tied only by history is a contributor, even for the keeiv user', async () => {
  const found = classify(facts({ remotes: { origin: 'https://github.com/someone/bot.git' } }))
  expect(found.isProject && found.role).toBe('contributor')
})

test('a copy with no remote or shared history is a derivative', async () => {
  const found = classify(facts({ remotes: {}, rootCommits: ['0000000'] }))
  expect(found.isProject && found.role).toBe('derivative')
})

test('git config bot-dev.role overrides the guess', async () => {
  const pinned = classify(facts({ remotes: {}, rootCommits: [], pinnedRole: 'Owner' }))
  expect(pinned.isProject && pinned.role).toBe('owner')
  const ignored = classify(facts({ pinnedRole: 'admin' }))
  expect(ignored.isProject && ignored.role).toBe('owner')
})

test('the prompt section names the role, the checks and the knowledge files', async () => {
  const text = projectSection(ROOT, 'contributor', '/plugin/knowledge')
  expect(text).toContain('Role: contributor')
  expect(text).toContain('open a pull request')
  expect(text).toContain('python -m bandit -r src services -ll')
  expect(text).toContain('/plugin/knowledge/done.md')
  expect(projectSection(ROOT, 'owner', '/k')).toContain('commit to main and push directly')
})

test('without a language pack every text is English', async () => {
  expect(say(DEFAULT_LANGUAGE, 'scan.location', { root: ROOT })).toBe(`Location: ${ROOT}`)
  expect(say(DEFAULT_LANGUAGE, 'role.owner')).toBe('owner')
})

test('a language pack replaces the texts it names and keeps English for the rest', async () => {
  const pack = { tag: 'zh-TW', messages: { 'scan.location': '位置：{root}' } }
  expect(say(pack, 'scan.location', { root: ROOT })).toBe(`位置：${ROOT}`)
  expect(say(pack, 'role.owner')).toBe('owner')
})

test('an unknown placeholder is left as written', async () => {
  expect(fill('{known} {unknown}', { known: 1 })).toBe('1 {unknown}')
})

test('the prompt asks for the pack reply language only when one is set', async () => {
  expect(projectSection(ROOT, 'owner', '/k')).not.toContain('Talk to the person in')
  expect(projectSection(ROOT, 'owner', '/k', 'Traditional Chinese (Taiwan)')).toContain(
    'Talk to the person in Traditional Chinese (Taiwan).',
  )
})

test('the checks are the ones CI runs, in its order', async () => {
  expect(CHECKS.map(([name]) => name)).toEqual(['pytest', 'flake8', 'black', 'isort', 'bandit'])
  const bandit = CHECKS.find(([name]) => name === 'bandit')?.[1] ?? []
  expect(bandit).toEqual(['-m', 'bandit', '-r', 'src', 'services', '-ll'])
})

test('a failed check keeps only the end of its output', async () => {
  const output = Array.from({ length: 40 }, (_, i) => `line ${i}`).join('\n')
  const kept = tail(output, 3).split('\n')
  expect(kept).toEqual(['line 37', 'line 38', 'line 39'])
})

test('the prompt points at every knowledge file and both commands', async () => {
  const text = projectSection(ROOT, 'owner', '/k')
  for (const file of ['architecture', 'done', 'shipping', 'recipes', 'testing', 'map']) {
    expect(text).toContain(`/k/${file}.md`)
  }
  expect(text).toContain('/bot-check')
})
