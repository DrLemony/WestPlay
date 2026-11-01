/** Where `element` is on the frame, in its pixels, for a WebView of the host's placed over it (Safari's page, TV's
 * player): clipped to the cab's screen and to the keyboard showing; `null` while either isn't there. */
export function nativeRect(element: Element | null): { x: number; y: number; width: number; height: number } | null {
  const box = element?.getBoundingClientRect()
  const cabin = document.querySelector('.carplay')?.getBoundingClientRect()
  if (!box || !cabin) return null
  const keyboard = document.querySelector('.keyboard.shown')?.getBoundingClientRect()
  const scale = window.devicePixelRatio
  const left = Math.max(0, box.left, cabin.left)
  const top = Math.max(0, box.top, cabin.top)
  const right = Math.min(box.right, cabin.right, window.innerWidth)
  const bottom = Math.min(box.bottom, cabin.bottom, window.innerHeight, keyboard?.top ?? Infinity)
  return {
    x: Math.round(left * scale),
    y: Math.round(top * scale),
    width: Math.max(0, Math.floor((right - left) * scale)),
    height: Math.max(0, Math.floor((bottom - top) * scale)),
  }
}
