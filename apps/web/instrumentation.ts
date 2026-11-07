export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { assertTokenKey } = await import('./lib/token-crypto')
    assertTokenKey()
  }
}
