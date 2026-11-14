// Usage: node .github/scripts/free-port.mjs NAME [NAME...]
// Finds one free TCP port per NAME and appends NAME=port to $GITHUB_ENV (or prints it when run locally).
import { appendFileSync } from 'node:fs'
import { createServer } from 'node:net'

const free = () =>
  new Promise((resolve, reject) => {
    const s = createServer()
    s.once('error', reject)
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address()
      s.close(() => resolve(port))
    })
  })

const taken = new Set()
for (const name of process.argv.slice(2)) {
  let port
  do port = await free()
  while (taken.has(port))
  taken.add(port)
  const line = `${name}=${port}`
  if (process.env.GITHUB_ENV) appendFileSync(process.env.GITHUB_ENV, line + '\n')
  console.log(line)
}
