import type { Channel } from './m3u'

/**
 * Xtream Codes' player API, as IPTV apps use it: `player_api.php` signs in (`user_info.auth`) and lists live
 * categories and streams; a stream plays at `/live/<username>/<password>/<id>.m3u8`.
 */
export interface XtreamLogin {
  server: string
  username: string
  password: string
}

/** The server as typed, made an address: `http://` if it names none, without a trailing slash or the API's
 * own page (a link copied whole). */
export function serverAddress(typed: string): string {
  let server = typed.trim()
  if (!/^https?:\/\//i.test(server)) server = `http://${server}`
  return server.replace(/\/(player_api\.php|get\.php)(\?.*)?$/i, '').replace(/\/+$/, '')
}

export function apiAddress(login: XtreamLogin, action?: string): string {
  const query = new URLSearchParams({ username: login.username, password: login.password })
  if (action) query.set('action', action)
  return `${serverAddress(login.server)}/player_api.php?${query}`
}

/** Whether the API's first answer signed in. */
export function signedIn(answer: string): boolean {
  try {
    const auth = (JSON.parse(answer) as { user_info?: { auth?: unknown } }).user_info?.auth
    return auth === 1 || auth === '1'
  } catch {
    return false
  }
}

/** The live channels (`get_live_streams`), each in its category (`get_live_categories`) by name. */
export function liveChannels(login: XtreamLogin, categoriesAnswer: string, streamsAnswer: string): Channel[] {
  const categories = new Map<string, string>()
  for (const category of list(categoriesAnswer)) {
    if (category.category_id !== undefined && typeof category.category_name === 'string') {
      categories.set(String(category.category_id), category.category_name)
    }
  }
  const server = serverAddress(login.server)
  const user = encodeURIComponent(login.username)
  const password = encodeURIComponent(login.password)
  return list(streamsAnswer).flatMap((stream) => {
    const id = stream.stream_id
    if ((typeof id !== 'number' && typeof id !== 'string') || typeof stream.name !== 'string') return []
    return [
      {
        name: stream.name.trim(),
        url: `${server}/live/${user}/${password}/${id}.m3u8`,
        logo: typeof stream.stream_icon === 'string' && stream.stream_icon ? stream.stream_icon : null,
        group: categories.get(String(stream.category_id)) ?? null,
      },
    ]
  })
}

function list(answer: string): Record<string, unknown>[] {
  try {
    const parsed: unknown = JSON.parse(answer)
    return Array.isArray(parsed) ? parsed.filter((item) => item && typeof item === 'object') : []
  } catch {
    return []
  }
}
