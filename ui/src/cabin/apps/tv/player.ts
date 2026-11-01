import { create } from 'zustand'
import { type HostMessage, isInHost, postToHost, subscribeHostMessages, type TvCommand } from '../../../shared/host'
import { type MusicPlayer, pauseMusicWithGame } from '../musicWithGame'
import type { Channel } from './m3u'

/**
 * TV's player: the host's (westplay_host::tv_view), a WebView of its own placed over TV's screen, which plays
 * what's asked and fetches playlists and Xtream's answers (it loads `http://` and ignores CORS, this page
 * can't). This side keeps what plays and how, as the player tells it.
 */
export interface TvState {
  channel: Channel | null
  playing: boolean
  loading: boolean
  failed: boolean
  /** 0 to 1, as the player set it. */
  volume: number
}

export const useTv = create<TvState>(() => ({
  channel: null,
  playing: false,
  loading: false,
  failed: false,
  volume: 1,
}))

export const sendTv = (command: TvCommand) => postToHost({ type: 'tv', command })

let listening = false
let nextId = 1
const fetching = new Map<number, (text: string | null) => void>()
const listing: ((videos: Extract<HostMessage, { type: 'tvVideos' }>) => void)[] = []
const pasting: ((text: string) => void)[] = []

/** Hears the player, once. */
function listen() {
  if (listening) return
  listening = true
  subscribeHostMessages((message) => {
    if (message.type === 'tvState') {
      const { playing, loading, failed } = message
      useTv.setState({ playing, loading, failed })
    } else if (message.type === 'tvFetched') {
      fetching.get(message.id)?.(message.ok ? (message.text ?? '') : null)
      fetching.delete(message.id)
    } else if (message.type === 'tvVideos') {
      for (const done of listing.splice(0)) done(message)
    } else if (message.type === 'tvPasted') {
      for (const done of pasting.splice(0)) done(message.text)
    }
  })
}

/** `url`'s text, fetched by the player (`null`: it couldn't). Outside WestPlay (a preview), by this page. */
export function fetchText(url: string): Promise<string | null> {
  if (!isInHost()) {
    return fetch(url)
      .then((response) => (response.ok ? response.text() : null))
      .catch(() => null)
  }
  listen()
  const id = nextId++
  return new Promise((done) => {
    fetching.set(id, done)
    sendTv({ action: 'fetch', id, url })
  })
}

/** The PC videos (`folder`: one is chosen in the companion). */
export function listVideos(): Promise<{ folder: boolean; videos: Channel[] }> {
  if (!isInHost()) return Promise.resolve({ folder: false, videos: [] })
  listen()
  return new Promise((done) => {
    listing.push(({ folder, videos }) =>
      done({ folder, videos: videos.map(({ name, url }) => ({ name, url, logo: null, group: null })) }),
    )
    sendTv({ action: 'videos' })
  })
}

/** The PC clipboard's text, as one line (`''`: none). Outside WestPlay (a preview), this browser's. */
export function pasteText(): Promise<string> {
  if (!isInHost()) return navigator.clipboard.readText().catch(() => '')
  listen()
  return new Promise((done) => {
    pasting.push(done)
    sendTv({ action: 'paste' })
  })
}

/** Plays `channel` (a stream from its live edge, a video from its start). */
export function playChannel(channel: Channel) {
  listen()
  useTv.setState({ channel, playing: false, loading: true, failed: false })
  sendTv({ action: 'play', url: channel.url })
  sendTv({ action: 'volume', share: useTv.getState().volume })
}

/** Stops what plays, and lets its stream go. */
export function stopTv() {
  sendTv({ action: 'stop' })
  useTv.setState({ channel: null, playing: false, loading: false, failed: false })
}

export function setTvVolume(share: number) {
  const volume = Math.min(1, Math.max(0, share))
  useTv.setState({ volume })
  sendTv({ action: 'volume', share: volume })
}

/** TV as one of the cab's players (oneAtATime.ts, musicWithGame.ts). */
export const tvPlayer: MusicPlayer = {
  name: 'tv',
  playingHere: () => useTv.getState().playing,
  pauseHere: () => sendTv({ action: 'pause' }),
  resumeHere: () => sendTv({ action: 'resume' }),
  volume: () => (useTv.getState().channel ? useTv.getState().volume : null),
  sendVolume: (share) => sendTv({ action: 'volume', share: Math.min(1, Math.max(0, share)) }),
  setVolume: setTvVolume,
  subscribe: (changed) => useTv.subscribe((tv, before) => changed(tv.playing && !before.playing)),
}

/** TV with the game: paused while the player is away from it, stopped as the truck's electrics go off. */
export function pauseTvWithGame(): () => void {
  return pauseMusicWithGame(tvPlayer)
}
