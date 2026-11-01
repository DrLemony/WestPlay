import Hls from 'hls.js'
import { create } from 'zustand'
import { type MusicPlayer, pauseMusicWithGame } from '../musicWithGame'
import type { Channel } from './m3u'

/**
 * TV's player: one `<video>` for the whole page, kept out of the app so a channel plays on (its sound, as the
 * music apps' does) while the player is elsewhere in WestPlay; TvApp puts it on screen while it's open. A
 * stream plays in Chromium's own HLS player if it has one, else through hls.js.
 *
 * shortcut: hls.js loads a stream as the page fetches, so one whose server sends no CORS header won't play
 * (`failed`); if many lists need it, the host could fetch streams for the page.
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

let element: HTMLVideoElement | null = null
let hls: Hls | null = null

/** The page's one video element, made as it's first asked for. */
export function video(): HTMLVideoElement {
  if (element) return element
  const made = document.createElement('video')
  made.className = 'tv-video'
  made.playsInline = true
  made.addEventListener('playing', () => useTv.setState({ playing: true, loading: false, failed: false }))
  made.addEventListener('pause', () => useTv.setState({ playing: false }))
  made.addEventListener('waiting', () => useTv.setState({ loading: true }))
  made.addEventListener('error', () => useTv.setState({ playing: false, loading: false, failed: true }))
  element = made
  return made
}

const nativeHls = () => video().canPlayType('application/vnd.apple.mpegurl') !== ''

/** Plays `channel` from its live edge. */
export function playChannel(channel: Channel) {
  const media = video()
  hls?.destroy()
  hls = null
  useTv.setState({ channel, playing: false, loading: true, failed: false })
  media.volume = useTv.getState().volume
  if (nativeHls() || !Hls.isSupported()) {
    media.src = channel.url
  } else {
    const next = new Hls({ lowLatencyMode: true })
    next.on(Hls.Events.ERROR, (_, data) => {
      if (data.fatal) useTv.setState({ playing: false, loading: false, failed: true })
    })
    next.loadSource(channel.url)
    next.attachMedia(media)
    hls = next
  }
  void media.play().catch(() => {})
}

/** Stops the channel and lets its stream go. */
export function stopTv() {
  hls?.destroy()
  hls = null
  if (element) {
    element.pause()
    element.removeAttribute('src')
    element.load()
  }
  useTv.setState({ channel: null, playing: false, loading: false, failed: false })
}

export function setTvVolume(share: number) {
  const volume = Math.min(1, Math.max(0, share))
  useTv.setState({ volume })
  if (element) element.volume = volume
}

/** TV as one of the cab's players (oneAtATime.ts, musicWithGame.ts). */
export const tvPlayer: MusicPlayer = {
  name: 'tv',
  playingHere: () => useTv.getState().playing,
  pauseHere: () => element?.pause(),
  resumeHere: () => void element?.play().catch(() => {}),
  volume: () => (useTv.getState().channel ? useTv.getState().volume : null),
  sendVolume: (share) => {
    if (element) element.volume = Math.min(1, Math.max(0, share))
  },
  setVolume: setTvVolume,
  subscribe: (changed) => useTv.subscribe((tv, before) => changed(tv.playing && !before.playing)),
}

/** TV with the game: paused while the player is away from it, stopped as the truck's electrics go off. */
export function pauseTvWithGame(): () => void {
  return pauseMusicWithGame(tvPlayer)
}
