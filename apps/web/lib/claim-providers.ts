import { METHOD_FOR, isOAuthProvider, providerConfig, type Method, type Platform } from './claims'

type Env = Record<string, string | undefined>

/**
 * Platforms that sign in through a provider app are available only when that provider is switched on
 * (flag "true" and credentials set). Instagram has a fallback, so it is always available.
 */
export function platformAvailable(platform: string, env: Env = process.env): boolean {
  return !isOAuthProvider(platform) || platform === 'instagram' || providerConfig(platform, env) !== null
}

/** Instagram checks through OAuth when its provider is on and falls back to the rel="me" page check otherwise. */
export function methodFor(platform: Platform, env: Env = process.env): Method {
  return platform === 'instagram' && providerConfig('instagram', env) ? 'instagram-oauth' : METHOD_FOR[platform]
}
