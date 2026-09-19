// Minimal, dependency-free server for the hosted family-chart instance.
// Serves the static frontend (server/public/) and a tiny JSON-file-backed
// /api/tree API. No auth here deliberately: Caddy's basic_auth in front of
// this container is the access control (see opti-stacks deploy notes).
import http from 'node:http'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))  // this file's own directory, used to anchor the public dir regardless of cwd
const PUBLIC_DIR = path.join(__dirname, 'public')  // static frontend files live here
const DATA_FILE = process.env.DATA_FILE || '/data/tree.json'  // persisted tree data; /data is the mounted volume in production
const PORT = process.env.PORT || 3000
const AUTH_USER_PERSON_IDS = {
  rodney: "rodney-lunt",
  pauline: "pauline-leask",
  georgia: "georgia-louise-brandi",
  auntyv: "vivienne-lunt",
}

function authenticatedUsername(req) {
  const forwarded = req.headers["x-authenticated-user"]
  if (typeof forwarded === "string" && forwarded) return forwarded.toLowerCase()
  const authorization = req.headers.authorization || ""
  if (!authorization.startsWith("Basic ")) return null
  try {
    return Buffer.from(authorization.slice(6), "base64").toString("utf8").split(":", 1)[0].toLowerCase()
  } catch {
    return null
  }
}

// seeded the first time the app runs, before anyone has added themselves
const DEFAULT_TREE = [{
  id: '0',
  data: { 'first name': 'New', 'last name': 'Person', gender: 'M' },
  rels: {},
}]

async function readTree() {
  try {
    const raw = await fs.readFile(DATA_FILE, 'utf8')  // load whatever was last saved
    return JSON.parse(raw)
  } catch (err) {
    if (err.code === 'ENOENT') return DEFAULT_TREE  // first run, nothing saved yet
    throw err
  }
}

async function writeTree(data) {
  await fs.mkdir(path.dirname(DATA_FILE), { recursive: true })  // don't assume the volume mount already created this; a missing dir must not lose an edit
  const tmp = `${DATA_FILE}.tmp`
  await fs.writeFile(tmp, JSON.stringify(data, null, 2))  // write to a temp file first
  await fs.rename(tmp, DATA_FILE)  // atomic on the same filesystem, so a crash mid-write can't corrupt the real file
}

const MIME = {  // just enough types for this app's own static files
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.map': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
}

async function serveStatic(req, res) {
  let reqPath = req.url === '/' ? '/index.html' : req.url  // default document
  reqPath = path.normalize(reqPath).replace(/^(\.\.[/\\])+/, '')  // strip any attempt to walk out of PUBLIC_DIR
  const full = path.join(PUBLIC_DIR, reqPath)
  if (!full.startsWith(PUBLIC_DIR)) { res.writeHead(403); res.end(); return }  // belt-and-braces on the normalize above
  const content = await fs.readFile(full)  // throws ENOENT for a missing file, caught by the caller
  res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream' })
  res.end(content)
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.url === '/healthz') {  // liveness probe target for the container healthcheck
      res.writeHead(200)
      res.end('ok')
      return
    }

    if (req.url === '/api/me' && req.method === 'GET') {
      const username = authenticatedUsername(req)
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
      res.end(JSON.stringify({ personId: AUTH_USER_PERSON_IDS[username] || null }))
      return
    }

    if (req.url === '/api/tree' && req.method === 'GET') {
      const data = await readTree()
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(data))
      return
    }

    if (req.url === '/api/tree' && req.method === 'PUT') {
      let body = ''
      req.on('data', (chunk) => {
        body += chunk
        if (body.length > 5_000_000) req.destroy()  // 5MB cap, this data set will never be that big; just a sanity limit
      })
      req.on('end', async () => {
        try {
          const data = JSON.parse(body)
          if (!Array.isArray(data)) throw new Error('expected a JSON array')  // the family-chart data shape is always an array of people
          await writeTree(data)
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: true }))
        } catch (err) {
          res.writeHead(400)
          res.end(`Bad request: ${err.message}`)
        }
      })
      return
    }

    await serveStatic(req, res)
  } catch (err) {
    if (err.code === 'ENOENT') {
      res.writeHead(404)
      res.end('Not found')
    } else {
      console.error(err)
      res.writeHead(500)
      res.end('Server error')
    }
  }
})

server.listen(PORT, () => console.log(`family-chart server listening on :${PORT}`))
