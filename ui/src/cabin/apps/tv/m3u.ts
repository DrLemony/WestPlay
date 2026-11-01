/** A live channel from an M3U playlist. */
export interface Channel {
  name: string
  url: string
  logo: string | null
  group: string | null
}

/** An `#EXTINF` line's attribute (`tvg-logo="…"`), or null. */
function attribute(info: string, name: string): string | null {
  const value = new RegExp(`${name}="([^"]*)"`, 'i').exec(info)?.[1]?.trim()
  return value ? value : null
}

/** The channels of an M3U playlist (`#EXTM3U`, each stream after its `#EXTINF`), in its order. A text that is
 * no playlist but one address (a stream's own `.m3u8`) is a list of that one channel. */
export function parseM3u(text: string, fallbackName = 'Live'): Channel[] {
  const lines = text
    .replace(/^﻿/, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  const channels: Channel[] = []
  let info: string | null = null
  for (const line of lines) {
    if (line.startsWith('#EXTINF')) {
      info = line
    } else if (!line.startsWith('#') && /^https?:\/\//i.test(line)) {
      const name = info ? nameOf(info) : ''
      channels.push({
        name: name || (info ? fallbackName : hostOf(line, fallbackName)),
        url: line,
        logo: info ? attribute(info, 'tvg-logo') : null,
        group: info ? attribute(info, 'group-title') : null,
      })
      info = null
    }
  }
  return channels
}

/** The playlist's address is a stream itself (HLS's own playlist, not a list of channels). */
export function isStreamAddress(url: string): boolean {
  return /\.m3u8(\?|#|$)/i.test(url)
}

/** The name: after the first comma outside quotes (`#EXTINF:-1 group-title="News, TR",TRT Haber`). */
function nameOf(info: string): string {
  let quoted = false
  for (let i = 0; i < info.length; i++) {
    if (info[i] === '"') quoted = !quoted
    else if (info[i] === ',' && !quoted) return info.slice(i + 1).trim()
  }
  return ''
}

function hostOf(url: string, fallback: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return fallback
  }
}

/** The playlist's groups, each once, in the order they first come. */
export function groupsOf(channels: readonly Channel[]): string[] {
  return [...new Set(channels.flatMap((channel) => (channel.group ? [channel.group] : [])))]
}
