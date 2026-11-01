import { useEffect, useMemo, useRef, useState } from 'react'
import { TextField } from '../../keyboard/TextField'
import { useKeyboard } from '../../keyboard/store'
import { type Strings, useText } from '../../state/text'
import { nativeRect } from '../nativeRect'
import { type Channel, groupsOf, isStreamAddress, parseM3u } from './m3u'
import { fetchText, listVideos, pasteText, playChannel, sendTv, setTvVolume, stopTv, useTv } from './player'
import {
  loadProfiles,
  newId,
  PROFILE_KINDS,
  type Profile,
  type ProfileKind,
  profileColour,
  saveProfiles,
} from './profiles'
import { apiAddress, liveChannels, signedIn } from './xtream'
import './tv.css'

/** A free list of channels that broadcast openly (iptv-org), offered in M3U's form. */
const SUGGESTED = 'https://iptv-org.github.io/iptv/countries/tr.m3u'

type Words = Strings['tv']
type Page =
  | { kind: 'profiles' }
  | { kind: 'add' }
  | { kind: 'form'; profile: ProfileKind }
  | { kind: 'browse'; profile: Profile }
  | { kind: 'player'; from: Profile }

/** TV: the player's profiles (as Netflix's), each an M3U list, an Xtream server or the PC's videos; a
 * profile's channels or videos; and the one playing. */
export function TvApp() {
  const text = useText()
  const [profiles, setProfiles] = useState(loadProfiles)
  const [page, setPage] = useState<Page>({ kind: 'profiles' })
  const keep = (next: Profile[]) => {
    setProfiles(next)
    saveProfiles(next)
  }
  return (
    <section className="app-panel tv-app" aria-label={text.apps.tv}>
      {page.kind === 'profiles' && (
        <Profiles
          profiles={profiles}
          onOpen={(profile) => setPage({ kind: 'browse', profile })}
          onAdd={() => setPage({ kind: 'add' })}
          onRemove={(id) => keep(profiles.filter((profile) => profile.id !== id))}
        />
      )}
      {page.kind === 'add' && (
        <AddKind
          onPick={(profile) => setPage({ kind: 'form', profile })}
          onCancel={() => setPage({ kind: 'profiles' })}
        />
      )}
      {page.kind === 'form' && (
        <ProfileForm
          kind={page.profile}
          onSave={(profile) => {
            keep([...profiles, profile])
            setPage({ kind: 'profiles' })
          }}
          onCancel={() => setPage({ kind: 'add' })}
        />
      )}
      {page.kind === 'browse' && (
        <Browse
          profile={page.profile}
          onBack={() => setPage({ kind: 'profiles' })}
          onPlay={(channel) => {
            playChannel(channel)
            setPage({ kind: 'player', from: page.profile })
          }}
        />
      )}
      {page.kind === 'player' && <Player onBack={() => setPage({ kind: 'browse', profile: page.from })} />}
    </section>
  )
}

function Profiles({
  profiles,
  onOpen,
  onAdd,
  onRemove,
}: {
  profiles: Profile[]
  onOpen(profile: Profile): void
  onAdd(): void
  onRemove(id: string): void
}) {
  const text = useText().tv
  const [wantsManaging, setManaging] = useState(false)
  // Removing the last one ends managing, or the + card and Done would both be gone.
  const managing = wantsManaging && profiles.length > 0
  return (
    <div className="tv-profiles">
      <h1>{text.sources}</h1>
      <div className="tv-cards">
        {profiles.map((profile, index) => (
          <button
            key={profile.id}
            className="tv-card"
            onClick={() => (managing ? onRemove(profile.id) : onOpen(profile))}
            aria-label={managing ? `${text.remove} ${profile.name}` : profile.name}
          >
            <span className="tv-avatar" style={{ background: profileColour(index) }}>
              <KindGlyph kind={profile.kind} />
              {managing && <span className="tv-avatar-remove">×</span>}
            </span>
            <span className="tv-card-name">{profile.name}</span>
            <span className="tv-card-kind">{text.kinds[profile.kind]}</span>
          </button>
        ))}
        {!managing && (
          <button className="tv-card" onClick={onAdd}>
            <span className="tv-avatar tv-avatar-add">+</span>
            <span className="tv-card-name">{text.addProfile}</span>
          </button>
        )}
      </div>
      {profiles.length > 0 && (
        <button className="tv-manage" onClick={() => setManaging(!managing)}>
          {managing ? text.done : text.manageProfiles}
        </button>
      )}
    </div>
  )
}

function KindGlyph({ kind }: { kind: ProfileKind }) {
  const glyph = { m3u: '☰', xtream: '▶', videos: '▣' }[kind]
  return (
    <span className="tv-avatar-glyph" aria-hidden>
      {glyph}
    </span>
  )
}

function AddKind({ onPick, onCancel }: { onPick(kind: ProfileKind): void; onCancel(): void }) {
  const text = useText().tv
  return (
    <div className="tv-add">
      <header className="tv-bar">
        <button className="tv-back" onClick={onCancel}>
          ‹ {text.back}
        </button>
        <h1>{text.chooseKind}</h1>
      </header>
      <div className="tv-kinds">
        {PROFILE_KINDS.map((kind) => (
          <button key={kind} className="tv-kind" onClick={() => onPick(kind)}>
            <KindGlyph kind={kind} />
            <b>{text.kinds[kind]}</b>
            <span>{text.kindAbout[kind]}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

function ProfileForm({
  kind,
  onSave,
  onCancel,
}: {
  kind: ProfileKind
  onSave(profile: Profile): void
  onCancel(): void
}) {
  const text = useText().tv
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [server, setServer] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const profile = ((): Profile | null => {
    const id = newId()
    const named = name.trim() || text.kinds[kind]
    if (kind === 'm3u') return /^https?:\/\//i.test(url.trim()) ? { id, kind, name: named, url: url.trim() } : null
    if (kind === 'xtream') {
      return server.trim() && username.trim()
        ? { id, kind, name: named, server: server.trim(), username: username.trim(), password }
        : null
    }
    return { id, kind, name: named }
  })()
  const save = () => {
    if (!profile) return
    useKeyboard.getState().detach(useKeyboard.getState().field?.id ?? '')
    onSave(profile)
  }
  return (
    <div className="tv-form">
      <header className="tv-bar">
        <button className="tv-back" onClick={onCancel}>
          ‹ {text.back}
        </button>
        <h1>{text.kinds[kind]}</h1>
        <button className="tv-pill tv-primary" disabled={!profile} onClick={save}>
          {text.save}
        </button>
      </header>
      <Field id="tv-name" label={text.name} value={name} onChange={setName} hint={text.kinds[kind]} />
      {kind === 'm3u' && (
        <>
          <Field id="tv-link" label={text.link} value={url} onChange={setUrl} hint={text.linkHint} onSubmit={save} />
          <button className="tv-suggest" onClick={() => setUrl(SUGGESTED)}>
            {text.suggested}
          </button>
        </>
      )}
      {kind === 'xtream' && (
        <>
          <Field id="tv-server" label={text.server} value={server} onChange={setServer} hint={text.serverHint} />
          <Field id="tv-user" label={text.username} value={username} onChange={setUsername} hint={text.username} />
          <Field
            id="tv-password"
            label={text.password}
            value={password}
            onChange={setPassword}
            hint={text.password}
            onSubmit={save}
          />
        </>
      )}
      {kind === 'videos' && <p className="tv-note">{text.kindAbout.videos}</p>}
    </div>
  )
}

function Field(props: {
  id: string
  label: string
  value: string
  onChange(value: string): void
  hint: string
  onSubmit?(): void
}) {
  const text = useText().tv
  const paste = () =>
    void pasteText().then((pasted) => {
      if (pasted) props.onChange(pasted)
    })
  return (
    <div className="tv-field">
      <span>{props.label}</span>
      <TextField
        id={props.id}
        value={props.value}
        onChange={props.onChange}
        onSubmit={props.onSubmit}
        returnKind="done"
        hint={props.hint}
        label={props.label}
      />
      <button className="tv-pill" onClick={paste}>
        {text.paste}
      </button>
    </div>
  )
}

/** A profile's channels or videos, or why there are none. */
async function load(profile: Profile, text: Words): Promise<Channel[] | string> {
  if (profile.kind === 'm3u') {
    if (isStreamAddress(profile.url)) return parseM3u(profile.url, text.live)
    const body = await fetchText(profile.url)
    return body === null ? text.playlistFailed : parseM3u(body, text.live)
  }
  if (profile.kind === 'xtream') {
    const first = await fetchText(apiAddress(profile))
    if (first === null || !signedIn(first)) return text.xtreamFailed
    const [categories, streams] = await Promise.all([
      fetchText(apiAddress(profile, 'get_live_categories')),
      fetchText(apiAddress(profile, 'get_live_streams')),
    ])
    return streams === null ? text.xtreamFailed : liveChannels(profile, categories ?? '[]', streams)
  }
  const { folder, videos } = await listVideos()
  return folder ? (videos.length ? videos : text.noVideos) : text.noVideoFolder
}

function Browse({ profile, onBack, onPlay }: { profile: Profile; onBack(): void; onPlay(channel: Channel): void }) {
  const words = useText().tv
  const [result, setResult] = useState<Channel[] | string | null>(null)
  const [group, setGroup] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  useEffect(() => {
    let gone = false
    void load(profile, words).then((loaded) => !gone && setResult(loaded))
    return () => {
      gone = true
    }
  }, [profile, words])
  const channels = useMemo(() => (Array.isArray(result) ? result : []), [result])
  const groups = useMemo(() => groupsOf(channels), [channels])
  const shown = useMemo(() => {
    const query = search.trim().toLocaleLowerCase()
    return channels.filter(
      (channel) => (!group || channel.group === group) && (!query || channel.name.toLocaleLowerCase().includes(query)),
    )
  }, [channels, group, search])
  return (
    <>
      <header className="tv-bar">
        <button className="tv-back" onClick={onBack}>
          ‹ {words.back}
        </button>
        <h1>{profile.name}</h1>
        <TextField id="tv-search" value={search} onChange={setSearch} hint={words.search} label={words.search} />
      </header>
      {groups.length > 0 && (
        <div className="tv-groups">
          <button className={group === null ? 'tv-chip chosen' : 'tv-chip'} onClick={() => setGroup(null)}>
            {words.all}
          </button>
          {groups.map((name) => (
            <button key={name} className={group === name ? 'tv-chip chosen' : 'tv-chip'} onClick={() => setGroup(name)}>
              {name}
            </button>
          ))}
        </div>
      )}
      {result === null && <p className="tv-note">{words.loading}</p>}
      {typeof result === 'string' && <p className="tv-note">{result}</p>}
      {Array.isArray(result) && shown.length === 0 && <p className="tv-note">{words.noChannels}</p>}
      <ul className="tv-list">
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
  // The host's player, placed over this screen while it shows, and gone (stopped) as it goes.
  useEffect(() => {
    let frame = 0
    let last = ''
    const place = () => {
      const rect = nativeRect(screen.current)
      const next = JSON.stringify(rect)
      if (rect && next !== last) {
        last = next
        sendTv(rect.width && rect.height ? { action: 'show', ...rect } : { action: 'hide' })
      }
      frame = requestAnimationFrame(place)
    }
    place()
    return () => {
      cancelAnimationFrame(frame)
      sendTv({ action: 'hide' })
      useTv.setState({ channel: null, playing: false, loading: false, failed: false })
    }
  }, [])
  const status = failed ? text.streamFailed : loading ? text.loading : ''
  return (
    <>
      <header className="tv-bar">
        <button className="tv-back" onClick={onBack}>
          ‹ {text.back}
        </button>
        <h1>{channel?.name}</h1>
      </header>
      <div ref={screen} className="tv-screen" />
      <div className="tv-controls">
        <span className="tv-status">{status}</span>
        <button
          className="tv-pill"
          disabled={!channel}
          onClick={() => {
            // A stream that failed starts again; one paused plays on (a video where it stopped).
            if (playing) sendTv({ action: 'pause' })
            else if (failed && channel) playChannel(channel)
            else sendTv({ action: 'resume' })
          }}
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
