/**
 * OpenAPI 3.1 description of the delivery API (issue #142). Served at /openapi.json.
 * The route and error-code tests in openapi.test.ts keep this file in step with app.ts,
 * errors.ts, and docs/api/errors-v1.md.
 */
import { DEFAULT_STYLES } from '@blueyvatar/core'
import { ERROR_CODES } from './errors.js'

type Json = Record<string, unknown>

const ref = (name: string) => ({ $ref: `#/components/${name}` })
const hdr = (name: string) => ref(`headers/${name}`)
const errRef = (description: string) => ({ description, content: { 'application/json': { schema: ref('schemas/Error') } } })

const rateHeaders = { 'x-rate-limit-limit': hdr('RateLimitLimit'), 'x-rate-limit-remaining': hdr('RateLimitRemaining'), 'x-rate-limit-reset': hdr('RateLimitReset') }
const okHeaders = { ...rateHeaders, 'x-tier': hdr('Tier'), 'x-usage-cost': hdr('UsageCost'), 'x-adjusted-params': hdr('AdjustedParams'), 'cache-control': hdr('CacheControlPrivate') }

const q = (name: string) => ref(`parameters/${name}`)
const avatarQuery = ['s', 'd', 'f', 'r', 'fmt', 'q', 'ttl', 'json'].map(q)

const errors = {
  '400': errRef('Malformed identifier or parameter. Codes: invalid_identifier, invalid_size, invalid_default, default_url_not_allowed, invalid_rating, invalid_format, invalid_quality, invalid_ttl, invalid_platform.'),
  '401': errRef('invalid_key or key_expired.'),
  '402': errRef('license_inactive'),
  '403': errRef('origin_not_allowed, tier_required, origin_forbidden, access_denied, or secret_key_required.'),
  '429': { description: 'rate_limited. Wait retry-after seconds.', headers: { ...rateHeaders, 'retry-after': hdr('RetryAfter') }, content: { 'application/json': { schema: ref('schemas/Error') } } },
  '500': errRef('internal'),
} as const
const keyErrors = { '401': errors['401'], '402': errors['402'], '403': errors['403'], '429': errors['429'], '500': errors['500'] }

const avatarOp = (summary: string, idParam: string, extra: Json[] = []): Json => ({
  summary,
  description: 'Redirects (302) to a signed, immutable /img URL, or to the default image when nothing is visible. With json=true it answers 200 JSON instead and never redirects. Tier limits on s, d, fmt, q, and ttl are applied silently and reported in x-adjusted-params.',
  tags: ['Avatars'],
  security: [{}, { apiKeyHeader: [] }, { apiKeyQuery: [] }],
  parameters: [ref(`parameters/${idParam}`), ...avatarQuery, ...extra],
  responses: {
    '200': { description: 'JSON mode (json=true).', headers: okHeaders, content: { 'application/json': { schema: ref('schemas/AvatarJson') } } },
    '302': { description: 'Redirect to the image or default.', headers: { location: { schema: { type: 'string' } }, ...okHeaders } },
    '400': errors['400'], '401': errors['401'], '402': errors['402'], '403': errors['403'], '404': errRef('not_found, only with d=404 and no avatar.'), '429': errors['429'], '500': errors['500'],
  },
})

export const openApiDocument = {
  openapi: '3.1.0',
  info: {
    title: 'BlueyVatar delivery API',
    version: '1.0.0',
    description: 'Avatars and profile JSON served from atproto repositories. The API never accepts a raw email address: send the SHA-256 (or legacy MD5) hash. Human docs: https://blueyvatar.com/docs.',
    license: { name: 'AGPL-3.0-only', identifier: 'AGPL-3.0-only' },
  },
  servers: [{ url: 'https://img.blueyvatar.com', description: 'Proposed delivery host. Use a configurable base URL.' }],
  tags: [
    { name: 'Avatars', description: 'Avatar delivery (spec section 7).' },
    { name: 'Profile', description: 'Profile JSON, QR codes, and platform redirects.' },
    { name: 'Usage', description: 'Metered usage for secret keys.' },
    { name: 'Images', description: 'Signed, immutable image objects behind the redirects.' },
    { name: 'Service', description: 'Health and description.' },
  ],
  paths: {
    '/healthz': { get: { summary: 'Health check', tags: ['Service'], responses: { '200': { description: 'ok', content: { 'text/plain': { schema: { type: 'string', const: 'ok' } } } } } } },
    '/readyz': { get: { summary: 'Readiness check', description: 'Runs a dependency check (Postgres) within a time budget.', tags: ['Service'], responses: { '200': { description: 'Ready.', content: { 'application/json': { schema: { type: 'object' } } } }, '503': errRef('not_ready: a dependency check failed or timed out.') } } },
    '/metrics': { get: { summary: 'Prometheus metrics', description: 'Needs a bearer token (METRICS_TOKEN). Answers not_found when no token is configured or the token is wrong.', tags: ['Service'], responses: { '200': { description: 'Prometheus text format.', content: { 'text/plain': { schema: { type: 'string' } } } }, '404': errRef('not_found') } } },
    '/openapi.json': { get: { summary: 'This document', tags: ['Service'], responses: { '200': { description: 'OpenAPI 3.1 JSON.', content: { 'application/json': { schema: { type: 'object' } } } } } } },
    '/usage': {
      get: {
        summary: 'Usage for a secret key',
        description: 'Metered usage of the license behind a secret key: current period, per-meter counts, and history by tier. Secret keys only, in the x-api-key header. Counts toward the rate limit but is not metered. Never cached, and sends no CORS headers.',
        tags: ['Usage'],
        security: [{ apiKeyHeader: [] }],
        responses: {
          '200': { description: 'Usage document.', headers: { ...rateHeaders, 'x-tier': hdr('Tier') }, content: { 'application/json': { schema: ref('schemas/Usage') } } },
          '401': errRef('invalid_key or key_expired, including a missing key or a key sent only as the token query parameter.'),
          '402': errors['402'],
          '403': errRef('secret_key_required: a publishable key was used.'),
          '429': errors['429'],
          '500': errors['500'],
        },
      },
    },
    '/avatar/{hash}': { get: avatarOp('Avatar by email hash (Gravatar compatible)', 'Hash', [q('name')]) },
    '/u/{id}': { get: avatarOp('Avatar by handle or DID', 'Id') },
    '/profile/{id}': {
      get: {
        summary: 'Profile JSON',
        description: 'Cross-origin browser callers (hovercards) need a Plus, Business, or Enterprise key. Any origin may read the response, and the rate-limit and tier headers are exposed to scripts. Hidden profiles answer not_found, the same as unknown ones.',
        tags: ['Profile'],
        security: [{}, { apiKeyHeader: [] }, { apiKeyQuery: [] }],
        parameters: [ref('parameters/ProfileId')],
        responses: {
          '200': { description: 'Profile document.', headers: { ...okHeaders, 'access-control-allow-origin': { schema: { type: 'string', const: '*' } } }, content: { 'application/json': { schema: ref('schemas/Profile') } } },
          '400': errors['400'], ...keyErrors, '404': errRef('not_found'),
        },
      },
    },
    '/qr/{file}': {
      get: {
        summary: 'Profile QR code',
        description: 'Available on every plan. The file is {id}.svg or {id}.png. Default size is 256. With to=github the QR points at /go/{handle}/github.',
        tags: ['Profile'],
        security: [{ apiKeyHeader: [] }, { apiKeyQuery: [] }],
        parameters: [ref('parameters/QrFile'), q('s'), ref('parameters/To'), q('ttl')],
        responses: {
          '200': { description: 'QR image.', headers: okHeaders, content: { 'image/svg+xml': { schema: { type: 'string' } }, 'image/png': { schema: { type: 'string', format: 'binary' } } } },
          '400': errors['400'], ...keyErrors, '404': errRef('not_found'), '502': errRef('upstream_error'),
        },
      },
    },
    '/go/{handle}/{platform}': {
      get: {
        summary: 'QR redirect to a verified platform',
        description: 'Redirects (302) to the user\'s verified account on the platform, to bsky.app for bluesky, or to the profile page when the platform is missing, hidden, or not https.',
        tags: ['Profile'],
        security: [{}, { apiKeyHeader: [] }, { apiKeyQuery: [] }],
        parameters: [ref('parameters/Handle'), ref('parameters/Platform')],
        responses: { '302': { description: 'Redirect.', headers: { location: { schema: { type: 'string' } }, 'cache-control': hdr('CacheControlPrivate') } }, ...keyErrors, '404': errRef('not_found') },
      },
    },
    '/img/{did}/{cid}/{sig}/{file}': {
      get: {
        summary: 'Signed resized image',
        description: 'Needs no key. Paths are issued by the avatar routes and signed; an edited path fails with invalid_signature. A non-canonical but signed path redirects (302) to the canonical one. The file is {size}[-q{quality}].{png|jpeg|webp}.',
        tags: ['Images'],
        parameters: [ref('parameters/Did'), ref('parameters/Cid'), ref('parameters/Sig'), ref('parameters/ImgFile')],
        responses: {
          '200': { description: 'Image bytes. Cache-Control public, max-age=31536000, immutable.', content: { 'image/png': { schema: { type: 'string', format: 'binary' } }, 'image/jpeg': { schema: { type: 'string', format: 'binary' } }, 'image/webp': { schema: { type: 'string', format: 'binary' } } } },
          '302': { description: 'Redirect to the canonical signed path.', headers: { location: { schema: { type: 'string' } } } },
          '403': errRef('invalid_signature, signature_expired, or access_denied.'),
          '404': errRef('not_found, invalid_size (size outside 1 to 2048), or invalid_quality (quality outside 1 to 100).'),
          '502': errRef('upstream_error'),
          '503': { ...errRef('overloaded: the resize queue is full. Retry after the delay in the retry-after header.'), headers: { 'retry-after': { schema: { type: 'integer' } } } },
          '500': errors['500'],
        },
      },
    },
    '/img/{path}': {
      get: {
        summary: 'Unsigned image path',
        description: 'Any other /img shape, such as a path with the signature stripped, is refused.',
        tags: ['Images'],
        parameters: [{ name: 'path', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '403': errRef('invalid_signature') },
      },
    },
    '/default/{style}/{file}': {
      get: {
        summary: 'Default avatar image',
        description: 'Unsigned and public. Target of the default redirect. The file is {size}.{png|jpeg|webp}.',
        tags: ['Images'],
        parameters: [
          { name: 'style', in: 'path', required: true, schema: { type: 'string', enum: DEFAULT_STYLES.filter((s) => s !== '404') } },
          { name: 'file', in: 'path', required: true, schema: { type: 'string', pattern: '^\\d{1,4}\\.(png|jpeg|webp)$' } },
          { name: 'seed', in: 'query', schema: { type: 'string' } },
          { name: 'initials', in: 'query', schema: { type: 'string' } },
        ],
        responses: {
          '200': { description: 'Image bytes. Cache-Control public, max-age=86400.', content: { 'image/png': { schema: { type: 'string', format: 'binary' } } } },
          '404': errRef('not_found'),
        },
      },
    },
  },
  components: {
    securitySchemes: {
      apiKeyHeader: { type: 'apiKey', in: 'header', name: 'x-api-key', description: 'Publishable or secret key. Secret keys are accepted only here.' },
      apiKeyQuery: { type: 'apiKey', in: 'query', name: 'token', description: 'Publishable key for browser use. Checked against the key\'s domain list using Origin or Referer.' },
    },
    parameters: {
      Hash: { name: 'hash', in: 'path', required: true, description: 'SHA-256 (64 hex) or MD5 (32 hex) of the trimmed, lowercased email. An optional .png, .jpg, .jpeg, or .webp suffix is ignored.', schema: { type: 'string', pattern: '^[0-9a-fA-F]{32}([0-9a-fA-F]{32})?(\\.(png|jpe?g|webp))?$' } },
      Id: { name: 'id', in: 'path', required: true, description: 'Handle or DID.', schema: { type: 'string' } },
      ProfileId: { name: 'id', in: 'path', required: true, description: 'SHA-256 hash, handle, or DID.', schema: { type: 'string' } },
      QrFile: { name: 'file', in: 'path', required: true, description: '{id}.svg or {id}.png, where id is a SHA-256 hash, handle, or DID.', schema: { type: 'string' } },
      Handle: { name: 'handle', in: 'path', required: true, schema: { type: 'string' } },
      Platform: { name: 'platform', in: 'path', required: true, description: 'Lowercase platform slug such as github or bluesky.', schema: { type: 'string', pattern: '^[a-z0-9-]+$' } },
      Did: { name: 'did', in: 'path', required: true, schema: { type: 'string' } },
      Cid: { name: 'cid', in: 'path', required: true, schema: { type: 'string', pattern: '^[a-z0-9]{10,100}$' } },
      Sig: { name: 'sig', in: 'path', required: true, schema: { type: 'string' } },
      ImgFile: { name: 'file', in: 'path', required: true, schema: { type: 'string', pattern: '^\\d{1,4}(-q\\d{1,3})?\\.(png|jpeg|webp)$' } },
      s: { name: 's', in: 'query', description: 'Square size in pixels, at least 1. Also accepted as size. Values above the tier maximum (Free 512, Plus 1024, Business and Enterprise 2048) are clamped and reported in x-adjusted-params.', schema: { type: 'integer', minimum: 1 } },
      d: { name: 'd', in: 'query', description: 'Fallback when no avatar is visible: a style, or an HTTPS URL on the service allowlist (Plus and higher; other tiers get the style default). Also accepted as default. Ignored when json=true.', schema: { oneOf: [{ type: 'string', enum: [...DEFAULT_STYLES] }, { type: 'string', format: 'uri' }] } },
      f: { name: 'f', in: 'query', description: 'y forces the default image. Also accepted as forcedefault.', schema: { type: 'string', enum: ['y'] } },
      r: { name: 'r', in: 'query', description: 'Maximum content rating. Also accepted as rating.', schema: { type: 'string', enum: ['g', 'pg', 'r', 'x'], default: 'g' } },
      fmt: { name: 'fmt', in: 'query', description: 'Output format. Free tier is PNG only and reports fmt in x-adjusted-params.', schema: { type: 'string', enum: ['png', 'jpeg', 'webp'], default: 'png' } },
      q: { name: 'q', in: 'query', description: 'Lossy quality. No effect on PNG. Free tier ignores it. Snaps to the cached qualities 60 and 85.', schema: { type: 'integer', minimum: 1, maximum: 100, default: 85 } },
      ttl: { name: 'ttl', in: 'query', description: 'Browser cache lifetime, 1h to 28d. Plus and higher only; other tiers get 24h.', schema: { type: 'string', pattern: '^[0-9]+[hd]$', default: '24h' } },
      json: { name: 'json', in: 'query', description: 'The exact value true returns JSON metadata instead of a redirect.', schema: { type: 'string', enum: ['true'] } },
      name: { name: 'name', in: 'query', description: 'With d=initials on /avatar/{hash}, the name to draw initials from.', schema: { type: 'string', maxLength: 100 } },
      To: { name: 'to', in: 'query', description: 'Platform slug. The QR then points at /go/{handle}/{to}.', schema: { type: 'string', pattern: '^[a-z0-9-]+$' } },
    },
    headers: {
      RateLimitLimit: { description: 'Requests allowed in the current window. Omitted for Enterprise.', schema: { type: 'integer' } },
      RateLimitRemaining: { description: 'Requests left. Never below 0.', schema: { type: 'integer', minimum: 0 } },
      RateLimitReset: { description: 'Unix time in seconds when the window resets.', schema: { type: 'integer' } },
      RetryAfter: { description: 'Whole seconds (at least 1) until the window resets.', schema: { type: 'integer', minimum: 1 } },
      Tier: { description: 'Tier that served the request.', schema: { type: 'string', enum: ['free', 'plus', 'business', 'enterprise'] } },
      UsageCost: { description: 'Metered units for a keyed request. Absent for anonymous requests.', schema: { type: 'string', const: '1' } },
      AdjustedParams: { description: 'Comma-separated names of parameters the tier clamped or ignored: s, d, fmt, q, ttl.', schema: { type: 'string' } },
      CacheControlPrivate: { description: 'private, max-age=<ttl>', schema: { type: 'string' } },
    },
    schemas: {
      Error: {
        type: 'object',
        required: ['error'],
        properties: {
          error: {
            type: 'object',
            required: ['code', 'message', 'docs'],
            properties: {
              code: { type: 'string', enum: [...ERROR_CODES], description: 'Stable. Branch on this and the HTTP status.' },
              message: { type: 'string', description: 'For people. May change.' },
              docs: { type: 'string', format: 'uri', description: 'Link to https://blueyvatar.com/docs/errors#<code>.' },
            },
          },
        },
      },
      Usage: {
        type: 'object',
        required: ['tier', 'period', 'included', 'total', 'meters', 'history'],
        properties: {
          tier: { type: 'string', enum: ['free', 'plus', 'business', 'enterprise'] },
          period: { type: 'object', required: ['start', 'end'], properties: { start: { type: 'string', format: 'date' }, end: { type: 'string', format: 'date' } } },
          included: { type: 'object', required: ['volume', 'per'], properties: { volume: { type: ['integer', 'null'] }, per: { type: ['string', 'null'], enum: ['month', 'day', null] } } },
          total: { type: 'integer', minimum: 0, description: 'Origin resolutions this period.' },
          meters: { type: 'object', required: ['origin_resolution', 'profile_json', 'transform'], properties: { origin_resolution: { type: 'integer' }, profile_json: { type: 'integer' }, transform: { type: 'integer' } } },
          history: {
            type: 'object',
            required: ['months', 'days'],
            properties: {
              months: { type: 'array', items: { type: 'object' } },
              days: { type: 'array', items: { type: 'object' } },
            },
          },
        },
      },
      AvatarJson: {
        type: 'object',
        required: ['did', 'handle', 'found', 'source', 'rating', 'url', 'updatedDate'],
        properties: {
          did: { type: ['string', 'null'] },
          handle: { type: ['string', 'null'] },
          found: { type: 'boolean' },
          source: { type: 'string', description: 'blueyvatar, adapter:<name>, blueyvatar-default, or default when found is false.' },
          rating: { type: ['string', 'null'], enum: ['g', 'pg', 'r', 'x', null] },
          url: { type: ['string', 'null'], description: 'Signed /img path relative to the base URL.' },
          updatedDate: { type: ['string', 'null'], format: 'date-time' },
        },
      },
      Profile: {
        type: 'object',
        required: ['did', 'handle', 'displayName', 'description', 'links', 'avatar', 'gallery', 'verifiedAccounts', 'profileUrl'],
        properties: {
          did: { type: 'string' },
          handle: { type: ['string', 'null'] },
          displayName: { type: ['string', 'null'] },
          description: { type: ['string', 'null'] },
          links: { type: 'array', items: { type: 'object' } },
          avatar: { type: ['object', 'null'], properties: { url: { type: 'string' }, source: { type: 'string' } } },
          jobTitle: { type: ['string', 'null'] },
          company: { type: ['string', 'null'] },
          location: { type: ['string', 'null'] },
          pronouns: { type: ['string', 'null'] },
          pronunciation: { type: ['string', 'null'] },
          timezone: { type: ['string', 'null'] },
          interests: { type: 'array', items: { type: 'string' } },
          languages: { type: 'array', maxItems: 10, description: 'BCP 47 tags in display order. At most one has primary true.', items: { type: 'object', required: ['tag', 'primary'], properties: { tag: { type: 'string' }, primary: { type: 'boolean' } } } },
          socialLinks: { type: 'array', maxItems: 10, description: 'https links the owner lists, in display order. Self-declared.', items: { type: 'object', required: ['label', 'url'], properties: { label: { type: 'string' }, url: { type: 'string' } } } },
          wallets: { type: 'array', maxItems: 10, description: 'Only wallets the owner chose to show. Self-declared, never verified.', items: { type: 'object', required: ['chain', 'address', 'label', 'verified'], properties: { chain: { type: 'string' }, address: { type: 'string' }, label: { type: ['string', 'null'] }, verified: { type: 'boolean', enum: [false] } } } },
          gallery: { type: 'array', maxItems: 12, description: 'Empty unless the owner is on Plus.', items: { type: 'object', required: ['url', 'caption'], properties: { url: { type: 'string' }, caption: { type: ['string', 'null'] } } } },
          verifiedAccounts: { type: 'array', description: 'Free keys see at most 4.', items: { type: 'object' } },
          profileUrl: { type: ['string', 'null'] },
        },
      },
    },
  },
} as const
