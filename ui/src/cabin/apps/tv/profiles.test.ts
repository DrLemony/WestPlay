import { describe, expect, it } from 'vitest'
import { asProfile, loadProfiles, saveProfiles } from './profiles'

/** A stand-in for the page's storage. */
function storage(items: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(items))
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
    clear: () => map.clear(),
    key: (index) => [...map.keys()][index] ?? null,
    get length() {
      return map.size
    },
  }
}

describe('profiles', () => {
  it('keep each kind and read it back', () => {
    const kept = storage()
    const profiles = [
      { id: 'a', kind: 'm3u', name: 'TR', url: 'https://x/tr.m3u' },
      { id: 'b', kind: 'xtream', name: 'Ev', server: 'http://s:8080', username: 'u', password: '' },
      { id: 'c', kind: 'videos', name: 'Filmler' },
    ] as const
    saveProfiles(profiles, kept)
    expect(loadProfiles(kept)).toEqual(profiles)
  })

  it('leave out what isn’t a profile', () => {
    expect(asProfile({ id: 'a', kind: 'm3u', name: 'x' })).toBeNull()
    expect(asProfile({ id: 'a', kind: 'jellyfin', name: 'x' })).toBeNull()
    expect(loadProfiles(storage({ 'westplay.tv.profiles': 'not json' }))).toEqual([])
  })

  it('make the lists kept before profiles M3U profiles', () => {
    const old = storage({ 'westplay.tv.playlists': '["https://iptv-org.github.io/iptv/countries/tr.m3u"]' })
    expect(loadProfiles(old)).toEqual([
      { id: 'm3u-0', kind: 'm3u', name: 'iptv-org.github.io', url: 'https://iptv-org.github.io/iptv/countries/tr.m3u' },
    ])
  })
})
