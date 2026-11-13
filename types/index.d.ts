/** Texts the person sees; each is a template with {name} placeholders. */
export type MessageKey =
  | 'command.description'
  | 'notProject'
  | 'scan.header'
  | 'scan.location'
  | 'scan.branch'
  | 'scan.layout'
  | 'role.owner'
  | 'role.contributor'
  | 'role.derivative'
  | 'check.description'
  | 'check.header'
  | 'check.passed'
  | 'check.failed'
  | 'check.summary.ok'
  | 'check.summary.failed'

/**
 * The language bot-dev speaks in. English is built in; a language pack plugin
 * replaces it by hooking state.set on { plugin: 'bot-dev', key: 'language' }.
 */
export type LanguagePack = {
  /** BCP 47 tag, for example "en" or "zh-TW". */
  tag: string
  /** A folder with architecture.md, done.md and shipping.md in this language. */
  knowledge?: string
  /** The language Claude should answer in, for example "Traditional Chinese (Taiwan)". */
  replyLanguage?: string
  /** Templates that replace the English ones; a missing key stays English. */
  messages?: Partial<Record<MessageKey, string>>
}

declare module 'claude-code' {
  interface PluginState {
    'bot-dev': { language: LanguagePack }
  }
}
