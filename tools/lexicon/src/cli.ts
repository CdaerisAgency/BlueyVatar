import { resolveTxt } from 'node:dns/promises'
import { fileURLToPath } from 'node:url'
import { checkPlan, dnsLines, dryRunLines, planRecords, publishRecords, verifyPublication } from './publish.js'
import { loadLexiconFiles, validateLexicons } from './validate.js'

// Usage:
//   validate                     validate every lexicon file
//   publish --dry-run            validate, then print the records and the DNS TXT values
//   publish                      validate, then write the records (needs credentials in env)
//   verify                       check DNS (and, with LEXICON_PUBLISH_PDS_URL, the served records)
//
// Environment (never committed; see docs/deploy.md):
//   LEXICON_PUBLISH_IDENTIFIER    handle or DID of the publishing account
//   LEXICON_PUBLISH_APP_PASSWORD  an app password for that account
//   LEXICON_PUBLISH_SERVICE       https URL of the account's PDS (or its login server)
//   LEXICON_PUBLISH_DID           DID to print in dry-run output and to check in verify
//   LEXICON_PUBLISH_PDS_URL       verify only: PDS to fetch the published records from
//   LEXICONS_DIR                  default: <repo>/lexicons

const dir = process.env.LEXICONS_DIR ?? fileURLToPath(new URL('../../../lexicons', import.meta.url))
const [command, ...flags] = process.argv.slice(2)
const dryRun = flags.includes('--dry-run')

function fail(message: string): never {
  console.error(message)
  process.exit(1)
}

const files = loadLexiconFiles(dir)
const result = validateLexicons(files)
if (result.issues.length > 0) {
  for (const i of result.issues) console.error(`${i.file}${i.path ? ` ${i.path}` : ''}: ${i.message}`)
  fail(`${result.issues.length} lexicon problem(s)`)
}
const planned = planRecords(files, result)
const planProblems = checkPlan(planned)
if (planProblems.length > 0) {
  for (const p of planProblems) console.error(p)
  fail(`${planProblems.length} publish plan problem(s)`)
}
console.log(`validated ${files.length} lexicon file(s); ${planned.length} to publish, ${files.length - planned.length} vendored`)

switch (command) {
  case 'validate':
    break
  case 'publish': {
    if (dryRun) {
      console.log('\n' + dryRunLines(planned, process.env.LEXICON_PUBLISH_DID).join('\n'))
      break
    }
    const identifier = process.env.LEXICON_PUBLISH_IDENTIFIER
    const appPassword = process.env.LEXICON_PUBLISH_APP_PASSWORD
    if (!identifier || !appPassword) fail('Set LEXICON_PUBLISH_IDENTIFIER and LEXICON_PUBLISH_APP_PASSWORD, or pass --dry-run')
    const service = process.env.LEXICON_PUBLISH_SERVICE
    if (!service) fail('Set LEXICON_PUBLISH_SERVICE to the https URL of the account PDS')
    try {
      const out = await publishRecords({ identifier, appPassword, service }, planned, { log: console.log })
      console.log('\n' + dnsLines(planned, out.did).join('\n'))
      console.log('\nAfter DNS propagates: LEXICON_PUBLISH_DID=' + out.did + ' pnpm lexicons:verify')
    } catch (err) {
      fail(err instanceof Error ? err.message : 'publish failed')
    }
    break
  }
  case 'verify': {
    const did = process.env.LEXICON_PUBLISH_DID
    if (!did) fail('Set LEXICON_PUBLISH_DID to the DID the TXT records should name')
    const report = await verifyPublication(planned, did, { resolveTxt, pds: process.env.LEXICON_PUBLISH_PDS_URL })
    for (const d of report.dns) console.log(`${d.ok ? 'ok  ' : 'FAIL'} ${d.name}: ${d.detail}`)
    for (const r of report.records) console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.nsid}: ${r.detail}`)
    if (!process.env.LEXICON_PUBLISH_PDS_URL) console.log('record check skipped (set LEXICON_PUBLISH_PDS_URL to enable)')
    if ([...report.dns, ...report.records].some((x) => !x.ok)) process.exitCode = 1
    break
  }
  default:
    fail('Usage: cli.js validate | publish [--dry-run] | verify')
}
