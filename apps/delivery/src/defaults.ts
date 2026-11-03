import type { DefaultStyle } from '@blueyvatar/core'

/**
 * Default images. v1 ships the service silhouette and initials; the other
 * Libravatar styles fall back to the silhouette until they are implemented.
 */
export function defaultSvg(style: DefaultStyle | 'service', seed: string, initials?: string): string {
  if (style === 'initials' && initials) {
    const hue = [...seed].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) % 360, 7)
    const text = initials.slice(0, 2).toUpperCase().replace(/[^A-Z0-9]/g, '')
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="hsl(${hue},45%,45%)"/><text x="50" y="50" dy=".35em" text-anchor="middle" font-family="sans-serif" font-size="42" fill="#fff">${text}</text></svg>`
  }
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#c9d3dd"/><circle cx="50" cy="38" r="18" fill="#fff"/><path d="M16 92c4-20 18-30 34-30s30 10 34 30z" fill="#fff"/></svg>'
}
