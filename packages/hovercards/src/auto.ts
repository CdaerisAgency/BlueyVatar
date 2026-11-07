import { init } from './hovercards.js'

/**
 * Auto-init for <script type="module" src=".../auto.js" data-key="pk_...">.
 * Also serves the classic bundle at /embed/hovercard.js, which accepts the older data-token.
 * Optional: data-api sets the delivery origin (defaults to the script's origin).
 */
const s = (document.currentScript as HTMLScriptElement | null)
  ?? document.querySelector<HTMLScriptElement>('script[data-key],script[data-token]')
if (s) {
  init({ key: s.dataset.key || s.dataset.token || '', api: s.dataset.api, web: new URL(s.src, location.href).origin })
}
