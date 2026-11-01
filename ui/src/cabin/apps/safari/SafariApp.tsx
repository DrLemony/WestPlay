import { useEffect, useRef, useState } from 'react'
import {
  isInHost,
  postToHost,
  subscribeHostMessages,
  type BrowserCommand,
  type HostMessage,
} from '../../../shared/host'
import { TextField } from '../../keyboard/TextField'
import { useKeyboard } from '../../keyboard/store'
import { useCabin } from '../../state/store'
import { useLanguage, useText } from '../../state/text'
import { whenTransitionEnds } from '../../state/launch'
import { nativeRect } from '../nativeRect'
import './safari.css'

type BrowserState = Extract<HostMessage, { type: 'browserState' }>
const INITIAL: BrowserState = {
  type: 'browserState',
  url: '',
  title: '',
  loading: false,
  back: false,
  forward: false,
  error: null,
}
const STORAGE = 'westplay.browser.url'
let current = INITIAL
let started = false
let currentZoom = 1
const command = (command: BrowserCommand) => postToHost({ type: 'browser', command })
function savedAddress() {
  try {
    return localStorage.getItem(STORAGE) || 'https://www.google.com/'
  } catch {
    return 'https://www.google.com/'
  }
}

/** The browser surface is a separate native WebView. This page owns only its controls. */
export function SafariApp() {
  const language = useLanguage()
  const text = useText().safari
  const [state, setState] = useState(current)
  const [address, setAddress] = useState(current.url || savedAddress())
  const [zoom, setZoom] = useState(currentZoom)
  const [generation, setGeneration] = useState(0)
  const area = useRef<HTMLDivElement>(null)
  const handedOver = useCabin((state) => state.truckScreen)
  const remoteId = 'browser-page'

  useEffect(
    () =>
      subscribeHostMessages((message) => {
        if (message.type === 'browserState') {
          current = message
          setState(message)
          if (message.url) {
            if (useKeyboard.getState().field?.id !== 'browser-address') setAddress(message.url)
            try {
              localStorage.setItem(STORAGE, message.url)
            } catch {
              /* Storage may be unavailable. */
            }
          }
        }
        if (message.type === 'browserFocus' && !handedOver) {
          if (message.editable) {
            useKeyboard.getState().attach(
              {
                id: remoteId,
                returnKind: 'done',
                read: () => '',
                write: () => {},
                submit: () => command({ action: 'input', event: { key: 'enter' } }),
                send: (event) => command({ action: 'input', event }),
              },
              language,
            )
          } else useKeyboard.getState().detach(remoteId)
        }
      }),
    [language, handedOver],
  )

  useEffect(() => {
    if (!isInHost() || handedOver) return
    let gone = false
    let frame = 0
    let last = ''
    // Native surfaces cannot participate in the DOM's opening animation.
    whenTransitionEnds(() => {
      if (gone) return
      if (!started) {
        started = true
        command({ action: 'navigate', url: current.url || savedAddress() })
      }
      const place = () => {
        if (gone) return
        const rect = nativeRect(area.current)
        if (rect) {
          const next = JSON.stringify(rect)
          if (last !== next) {
            last = next
            command(rect.width && rect.height ? { action: 'show', ...rect } : { action: 'hide' })
          }
        }
        frame = requestAnimationFrame(place)
      }
      place()
    })
    return () => {
      gone = true
      cancelAnimationFrame(frame)
      command({ action: 'hide' })
      useKeyboard.getState().detach(remoteId)
    }
  }, [handedOver, generation])

  const navigate = () => {
    useKeyboard.getState().detach('browser-address')
    useKeyboard.getState().detach(remoteId)
    command({ action: 'navigate', url: address })
  }
  const changeZoom = (delta: number) => {
    const factor = Math.max(0.5, Math.min(2, Math.round((zoom + delta) * 10) / 10))
    setZoom(factor)
    currentZoom = factor
    command({ action: 'zoom', factor })
  }
  return (
    <section className="app-panel safari-app" aria-label={useText().apps.safari}>
      <div ref={area} className="safari-page">
        {!isInHost() && <p>{text.outsideHost}</p>}
      </div>
      {state.error && (
        <div className="safari-error" role="alert">
          {state.error}
        </div>
      )}
      <div className="safari-bar">
        <button aria-label={text.back} disabled={!state.back} onClick={() => command({ action: 'back' })}>
          ‹
        </button>
        <button aria-label={text.forward} disabled={!state.forward} onClick={() => command({ action: 'forward' })}>
          ›
        </button>
        <div className={state.loading ? 'safari-address loading' : 'safari-address'}>
          <TextField
            id="browser-address"
            value={address}
            onChange={setAddress}
            onSubmit={navigate}
            returnKind="go"
            hint={text.address}
            label={text.address}
          />
          <button
            aria-label={state.loading ? text.stop : text.reload}
            onClick={() => command({ action: state.loading ? 'stop' : 'reload' })}
          >
            {state.loading ? '×' : '↻'}
          </button>
        </div>
        <button aria-label={text.zoomOut} disabled={zoom <= 0.5} onClick={() => changeZoom(-0.1)}>
          a
        </button>
        <span className="safari-zoom">{Math.round(zoom * 100)}%</span>
        <button aria-label={text.zoomIn} disabled={zoom >= 2} onClick={() => changeZoom(0.1)}>
          A
        </button>
        <button
          aria-label={text.restart}
          onClick={() => {
            command({ action: 'close' })
            started = false
            currentZoom = 1
            setZoom(1)
            setGeneration((value) => value + 1)
          }}
        >
          ⟲
        </button>
      </div>
    </section>
  )
}
