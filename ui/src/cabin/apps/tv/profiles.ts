/** A TV profile, as a Netflix profile is one: a source of what to watch, by the name the player gave it. */
export type Profile =
  | { id: string; kind: 'm3u'; name: string; url: string }
  | { id: string; kind: 'xtream'; name: string; server: string; username: string; password: string }
  | { id: string; kind: 'videos'; name: string }

export type ProfileKind = Profile['kind']

export const PROFILE_KINDS: readonly ProfileKind[] = ['m3u', 'xtream', 'videos']

const STORAGE = 'westplay.tv.profiles'
/** TV's lists before profiles: each becomes an M3U profile. */
const OLD_STORAGE = 'westplay.tv.playlists'

const text = (value: unknown): value is string => typeof value === 'string' && value.trim() !== ''

/** A profile as stored, checked: anything else (an older shape, a broken one) is left out. */
export function asProfile(value: unknown): Profile | null {
  if (!value || typeof value !== 'object') return null
  const { id, kind, name, url, server, username, password } = value as Record<string, unknown>
  if (!text(id) || !text(name)) return null
  if (kind === 'm3u' && text(url)) return { id, kind, name, url }
  if (kind === 'xtream' && text(server) && text(username) && typeof password === 'string') {
    return { id, kind, name, server, username, password }
  }
  if (kind === 'videos') return { id, kind, name }
  return null
}

/** The player's profiles, as kept in this page's storage (none if it can't be read). */
export function loadProfiles(storage: Storage | undefined = globalThis.localStorage): Profile[] {
  try {
    const saved = storage?.getItem(STORAGE)
    if (saved !== null && saved !== undefined) {
      const list: unknown = JSON.parse(saved)
      return Array.isArray(list) ? list.flatMap((value) => asProfile(value) ?? []) : []
    }
    // The lists kept before profiles, each an M3U profile named by its server.
    const old: unknown = JSON.parse(storage?.getItem(OLD_STORAGE) ?? '[]')
    return Array.isArray(old)
      ? old.filter(text).map((url, index) => ({ id: `m3u-${index}`, kind: 'm3u', name: hostName(url), url }))
      : []
  } catch {
    return []
  }
}

export function saveProfiles(profiles: readonly Profile[], storage: Storage | undefined = globalThis.localStorage) {
  try {
    storage?.setItem(STORAGE, JSON.stringify(profiles))
  } catch {
    /* Storage may be unavailable: the profiles stay for this page. */
  }
}

/** A new profile's id, unlike the others'. */
export function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function hostName(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return 'M3U'
  }
}

/** A profile card's colour, by its place, as Netflix's are. */
const COLOURS = ['#e50914', '#0a84ff', '#30d158', '#ff9f0a', '#bf5af2', '#64d2ff', '#ff375f']
export function profileColour(index: number): string {
  return COLOURS[index % COLOURS.length]!
}
