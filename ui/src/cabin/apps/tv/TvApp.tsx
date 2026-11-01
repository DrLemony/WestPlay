import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { TextField } from '../../keyboard/TextField'
import { useText } from '../../state/text'
import { type Channel, groupsOf, isStreamAddress, parseM3u } from './m3u'
import { playChannel, setTvVolume, stopTv, useTv, video } from './player'
import './tv.css'

const STORAGE = 'westplay.tv.playlists'
/** A free list of channels that broadcast openly (iptv-org), offered while the player has none of their own. */
const SUGGESTED = 'https://iptv-org.github.io/iptv/countries/tr.m3u'

function savedPlaylists(): string[] {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(STORAGE) ?? '[]')
    return Array.isArray(saved) ? saved.filter((url): url is string => typeof url === 'string') : []
  } catch {
    return []
  }
}

function savePlaylists(urls: string[]) {
  try {
    localStorage.setItem(STORAGE, JSON.stringify(urls))
  } catch {
    /* Storage may be unavailable: the lists stay for this page. */
  }
}

type Page = { kind: 'lists' } | { kind: 'channels'; url: string } | { kind: 'player' }

/** TV: the player's M3U playlists, a list's channels, and the channel playing. */
export function TvApp() {
  const text = useText().tv
  const playing = useTv((state) => state.channel)
  const [page, setPage] = useState<Page>(() => (useTv.getState().channel ? { kind: 'player' } : { kind: 'lists' }))
  return (
    <section className="app-panel tv-app" aria-label={useText().apps.tv}>
      {page.kind === 'lists' && (
        <Playlists
          onOpen={(url) => {
            // A stream's own address plays at once; a playlist opens its channels.
            const stream = isStreamAddress(url) ? parseM3u(url, text.live)[0] : undefined
            if (stream) {
              playChannel(stream)
              setPage({ kind: 'player' })
            } else setPage({ kind: 'channels', url })
          }}
          onNowPlaying={playing ? () => setPage({ kind: 'player' }) : null}
        />
      )}
      {page.kind === 'channels' && (
        <Channels
          url={page.url}
          onBack={() => setPage({ kind: 'lists' })}
          onPlay={(channel) => {
            playChannel(channel)
            setPage({ kind: 'player' })
          }}
        />
      )}
      {page.kind === 'player' && <Player onBack={() => setPage({ kind: 'lists' })} />}
    </section>
  )
}

function Playlists({ onOpen, onNowPlaying }: { onOpen(url: string): void; onNowPlaying: (() => void) | null }) {
  const text = useText().tv
  const [urls, setUrls] = useState(savedPlaylists)
  const [address, setAddress] = useState('')
  const add = () => {
    const url = address.trim()
    if (!/^https?:\/\//i.test(url)) return
    const next = [url, ...urls.filter((saved) => saved !== url)]
    setUrls(next)
    savePlaylists(next)
    setAddress('')
  }
  const remove = (url: string) => {
    const next = urls.filter((saved) => saved !== url)
    setUrls(next)
    savePlaylists(next)
  }
  return (
    <>
      <header className="tv-bar">
        <h1>{text.playlists}</h1>
        {onNowPlaying && (
          <button className="tv-pill" onClick={onNowPlaying}>
            {text.nowPlaying}
          </button>
        )}
      </header>
      <div className="tv-add">
        <TextField
          id="tv-address"
          value={address}
          onChange={setAddress}
          onSubmit={add}
          returnKind="go"
          hint={text.playlistHint}
          label={text.addPlaylist}
        />
        <button className="tv-pill" onClick={add}>
          {text.add}
        </button>
      </div>
      <ul className="tv-list">
        {urls.map((url) => (
          <li key={url}>
            <button className="tv-row" onClick={() => onOpen(url)}>
              {url}
            </button>
            <button className="tv-remove" aria-label={text.remove} onClick={() => remove(url)}>
              ×
            </button>
          </li>
        ))}
        {urls.length === 0 && (
          <li>
            <button className="tv-row" onClick={() => onOpen(SUGGESTED)}>
              {text.suggested}
              <small>{SUGGESTED}</small>
            </button>
          </li>
        )}
      </ul>
    </>
  )
}

function Channels({ url, onBack, onPlay }: { url: string; onBack(): void; onPlay(channel: Channel): void }) {
  const text = useText().tv
  const [channels, setChannels] = useState<Channel[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [group, setGroup] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  useEffect(() => {
    let gone = false
    fetch(url)
      .then((response) => (response.ok ? response.text() : Promise.reject(new Error(String(response.status)))))
      .then((body) => !gone && setChannels(parseM3u(body, text.live)))
      .catch(() => !gone && setFailed(true))
    return () => {
      gone = true
    }
  }, [url, text.live])
  const groups = useMemo(() => groupsOf(channels ?? []), [channels])
  const shown = useMemo(() => {
    const query = search.trim().toLocaleLowerCase()
    return (channels ?? []).filter(
      (channel) => (!group || channel.group === group) && (!query || channel.name.toLocaleLowerCase().includes(query)),
    )
  }, [channels, group, search])
  return (
    <>
      <header className="tv-bar">
        <button className="tv-back" onClick={onBack}>
          ‹ {text.playlists}
        </button>
        <TextField id="tv-search" value={search} onChange={setSearch} hint={text.search} label={text.search} />
      </header>
      {groups.length > 0 && (
        <div className="tv-groups">
          <button className={group === null ? 'tv-chip chosen' : 'tv-chip'} onClick={() => setGroup(null)}>
            {text.all}
          </button>
          {groups.map((name) => (
            <button key={name} className={group === name ? 'tv-chip chosen' : 'tv-chip'} onClick={() => setGroup(name)}>
              {name}
            </button>
          ))}
        </div>
      )}
      {failed && <p className="tv-note">{text.playlistFailed}</p>}
      {!failed && channels === null && <p className="tv-note">{text.loading}</p>}
      {channels !== null && shown.length === 0 && <p className="tv-note">{text.noChannels}</p>}
      <ul className="tv-list tv-channels">
        {shown.map((channel, index) => (
          <li key={`${channel.url}#${index}`}>
            <button className="tv-row" onClick={() => onPlay(channel)}>
              {channel.logo ? <img src={channel.logo} alt="" loading="lazy" /> : <span className="tv-logo" />}
              {channel.name}
            </button>
          </li>
        ))}
      </ul>
    </>
  )
}

function Player({ onBack }: { onBack(): void }) {
  const text = useText().tv
  const { channel, playing, loading, failed, volume } = useTv()
  const screen = useRef<HTMLDivElement>(null)
  // The page's one video, in this screen while it shows (player.ts).
  useLayoutEffect(() => {
    const media = video()
    screen.current?.appendChild(media)
    return () => media.remove()
  }, [])
  return (
    <>
      <header className="tv-bar">
        <button className="tv-back" onClick={onBack}>
          ‹ {text.playlists}
        </button>
        <h1>{channel?.name}</h1>
      </header>
      <div ref={screen} className="tv-screen">
        {failed && <p className="tv-note">{text.streamFailed}</p>}
        {!failed && loading && <p className="tv-note">{text.loading}</p>}
      </div>
      <div className="tv-controls">
        <button
          className="tv-pill"
          disabled={!channel}
          onClick={() => (playing ? video().pause() : channel && playChannel(channel))}
        >
          {playing ? text.pause : text.play}
        </button>
        <button className="tv-pill" aria-label={text.volumeDown} onClick={() => setTvVolume(volume - 0.1)}>
          −
        </button>
        <span className="tv-volume">{Math.round(volume * 100)}%</span>
        <button className="tv-pill" aria-label={text.volumeUp} onClick={() => setTvVolume(volume + 0.1)}>
          +
        </button>
        <button
          className="tv-pill"
          disabled={!channel}
          onClick={() => {
            stopTv()
            onBack()
          }}
        >
          {text.stop}
        </button>
      </div>
    </>
  )
}
