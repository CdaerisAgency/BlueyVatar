// Prints a new ES256 private JWK for OAUTH_PRIVATE_JWK. Store it in Infisical; never commit it.
// Run: node --experimental-strip-types apps/web/scripts/gen-jwk.ts
import { JoseKey } from '@atproto/jwk-jose'

const kid = `bv-${new Date().toISOString().slice(0, 10)}`
const key = await JoseKey.generate(['ES256'], kid)
console.log(JSON.stringify(key.privateJwk))
