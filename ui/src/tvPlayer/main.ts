import Hls from 'hls.js'

/**
 * TV's player page, in a WebView of its own (westplay_host::tv_view): plays what the cabin's TV app asks,
 * and fetches playlists and Xtream's answers for it (its browser loads `http://` and ignores CORS, the cabin
 * page's can't). It hears only the host and tells only the host.
 */

type Command =
  | { action: 'play'; url: string }
  | { action: 'pause' | 'resume' | 'stop' }
  | { action: 'volume'; share: number }
  | { action: 'fetch'; id: number; url: string }

/** The largest text a fetch passes on (a big M3U, Xtream's whole channel list). */
const MAX_TEXT = 30_000_000

/** The host's bridge, as this page uses it (its messages are this page's own, not the cabin's). */
interface Bridge {
  postMessage(message: unknown): void
  addEventListener(type: 'message', listener: (event: { data: Command }) => void): void
}
const webview = window.chrome?.webview as unknown as Bridge | undefined
const media = document.querySelector('video')!
let hls: Hls | null = null
let failed = false

const post = (message: unknown) => webview?.postMessage(message)
const tell = () =>
  post({
    type: 'state',
    playing: !media.paused && !media.ended,
    loading: media.readyState < 3 && !failed && !!media.src,
    failed,
  })

for (const event of ['playing', 'pause', 'waiting', 'canplay', 'ended', 'emptied']) media.addEventListener(event, tell)
media.addEventListener('error', () => {
  if (!media.getAttribute('src')) return
  failed = true
  tell()
})

/** A stream (HLS: `.m3u8`, or an Xtream `/live/` address) plays through Chromium's own HLS player if it has
 * one, else hls.js; a file (MP4, WebM…) plays as it is. */
function play(url: string) {
  stop()
  failed = false
  const isHls = /\.m3u8(\?|$)/i.test(url)
  if (isHls && media.canPlayType('application/vnd.apple.mpegurl') === '' && Hls.isSupported()) {
    hls = new Hls({ lowLatencyMode: true })
    hls.on(Hls.Events.ERROR, (_, data) => {
      if (!data.fatal) return
      failed = true
      tell()
    })
    hls.loadSource(url)
    hls.attachMedia(media)
  } else {
    media.src = url
  }
  void media.play().catch(() => {})
  tell()
}

function stop() {
  hls?.destroy()
  hls = null
  media.pause()
  media.removeAttribute('src')
  media.load()
}

async function fetchText(id: number, url: string) {
  try {
    const response = await fetch(url)
    const text = response.ok ? await response.text() : ''
    post({ type: 'fetched', id, ok: response.ok && text.length <= MAX_TEXT, text: text.length <= MAX_TEXT ? text : '' })
  } catch {
    post({ type: 'fetched', id, ok: false })
  }
}

webview?.addEventListener('message', (event) => {
  const command = event.data
  switch (command.action) {
    case 'play':
      return play(command.url)
    case 'pause':
      return media.pause()
    case 'resume':
      return void media.play().catch(() => {})
    case 'stop':
      stop()
      return tell()
    case 'volume':
      media.volume = Math.min(1, Math.max(0, command.share))
      return
    case 'fetch':
      return void fetchText(command.id, command.url)
  }
})
