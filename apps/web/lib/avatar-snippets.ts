/** Embed snippets for the account page. The image is the user's own primary email hash on the public avatar route. */
export function avatarUrl(base: string, emailHash: string, size = 200): string {
  return `${base.replace(/\/+$/, '')}/avatar/${emailHash}?s=${size}`
}

export function imgSnippet(url: string, size = 200): string {
  return `<img src="${url}" width="${size}" height="${size}" alt="Avatar">`
}

export const markdownSnippet = (url: string): string => `![Avatar](${url})`
