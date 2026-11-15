/** The site's public origin: PUBLIC_URL when set, otherwise the production address. A trailing slash is left as given. */
export const publicUrl = (env: Record<string, string | undefined> = process.env): string => env.PUBLIC_URL ?? 'https://blueyvatar.com'
