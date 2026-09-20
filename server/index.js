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
const UPLOADS_DIR = process.env.UPLOADS_DIR || '/data/uploads'  // sibling to DATA_FILE, under the same persistent volume - PUBLIC_DIR is part of the built frontend and doesn't survive a rebuild
const PORT = process.env.PORT || 3000

// Small private family archive, not a general uploader: home photos (avatar) and scanned
// documents/certificates (attachments). Maps the client-declared contentType to the ONE
// extension a file of that type is ever stored and served with - the client's own filename
// extension is never trusted for this. Without this, a request could declare
// contentType: "image/jpeg" (passing the allowlist below) but supply filename: "x.html" with
// arbitrary HTML/JS as the body; serving that back would need Content-Type to come from
// somewhere, and deriving it from the stored file's extension - which used to just be the
// client's own filename, unsanitised beyond stripping path separators - would serve attacker
// HTML/JS as text/html from this app's own origin. Forcing the extension from the validated
// contentType instead closes that off: the extension on disk can never disagree with the type
// that was actually allowlisted.
const ALLOWED_UPLOAD_TYPES = new Map([
  ['image/jpeg', '.jpg'], ['image/png', '.png'], ['image/gif', '.gif'], ['image/webp', '.webp'],
  ['application/pdf', '.pdf'], ['text/plain', '.txt'],
])
const MAX_UPLOAD_BYTES = 15 * 1024 * 1024  // decoded file size cap - photos and scanned certificates, never video
const MAX_UPLOAD_RAW_BODY_BYTES = 21_000_000  // base64 inflates the payload ~33% over the decoded cap; this is that plus headroom for the JSON wrapper (filename/contentType/personId)
const PERSON_ID_RE = /^[A-Za-z0-9-]{1,64}$/  // ids are UUIDv4-ish strings (see src/store/new-person.ts) or the short seed id "0" - never used to sanitise, only to accept or reject
// Maps each basic_auth username to the id of their own record in the tree data, so "Focus on
// me" knows who "me" is. Both sides of this mapping are real family members' names, so it's
// runtime config, not code - this repo is public and carries none of it. See .env.example.
const AUTH_USER_PERSON_IDS = JSON.parse(process.env.AUTH_USER_PERSON_IDS_JSON || '{}')

// /request-access and /api/request-access are the only paths Caddy leaves outside
// basic_auth (see the Caddyfile's @requestAccess matcher) - this is the ONE genuinely
// public, unauthenticated write surface this app exposes to the internet, so it gets its
// own input limits and rate limit rather than trusting Caddy alone.
const ACCESS_REQUEST_RATE_LIMIT = { windowMs: 60 * 60 * 1000, max: 5 }  // per IP, per hour
const accessRequestHits = new Map()  // ip -> timestamps[], pruned lazily on each check

function isRateLimited(ip) {
  const now = Date.now()
  const hits = (accessRequestHits.get(ip) || []).filter(t => now - t < ACCESS_REQUEST_RATE_LIMIT.windowMs)
  hits.push(now)
  accessRequestHits.set(ip, hits)
  return hits.length > ACCESS_REQUEST_RATE_LIMIT.max
}

// Rejects control characters (CR/LF above all - the classic header-injection vector for a
// field that ends up in an email subject/reply-to) rather than trying to strip and continue,
// since a request trying that is worth refusing outright, not quietly sanitising.
function hasControlChars(str) {
  return /[\x00-\x1f\x7f]/.test(str)
}

function isValidEmail(str) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(str)
}

async function sendAccessRequestEmail({ name, email, note }) {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) throw new Error('RESEND_API_KEY not configured')  // fail loudly, never pretend the email sent
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: process.env.MAIL_FROM || 'Tree Research <noreply@lunt.au>',
      to: process.env.MAIL_TO || 'rod@lunt.au',
      reply_to: email,
      subject: `Family tree access request from ${name}`,
      text: `${name} <${email}> asked for access to the Lunt family tree.\n\n${note || '(no note included)'}`,
    }),
  })
  if (!res.ok) throw new Error(`Resend API error: ${res.status} ${await res.text()}`)
}

// Caddy sits directly in front of this container on an internal Docker network - nothing
// else can reach it - so its X-Forwarded-For is trustworthy here the same way
// X-Authenticated-User already is below.
function clientIp(req) {
  const forwarded = req.headers['x-forwarded-for']
  if (typeof forwarded === 'string' && forwarded) return forwarded.split(',')[0].trim()
  return req.socket.remoteAddress || 'unknown'
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

const MIME = {  // just enough types for this app's own static files, plus what /uploads can hold
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.map': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.pdf': 'application/pdf',
}

// Only accepts an id that already matches the shape this app's ids take (see PERSON_ID_RE) -
// rejects outright rather than trying to strip it down to something safe, since a personId
// that doesn't already look like a real id has no legitimate reason to be one character off.
function assertValidPersonId(id) {
  if (typeof id !== 'string' || !PERSON_ID_RE.test(id)) throw new Error('invalid personId')
  return id
}

// Strips path separators, control characters and any extension (the extension used on disk
// always comes from the validated contentType - see ALLOWED_UPLOAD_TYPES above - never from
// this label), caps length, and falls back to a generic name if nothing safe is left. This is
// purely a display label baked into the stored filename now, not something that has to match
// anything else.
function sanitizeFilename(name) {
  const stripped = String(name ?? '')
    .replace(/[\x00-\x1f\x7f]/g, '')
    .replace(/[/\\]/g, '_')
    .replace(/^\.+/, '')
    .replace(/\.[^.]*$/, '')  // drop the client-supplied extension entirely - never trusted
    .trim()
  const safe = stripped.replace(/[^A-Za-z0-9._ -]/g, '_').slice(0, 150)
  return safe || 'file'
}

async function serveStatic(req, res) {
  let reqPath = req.url === '/' ? '/index.html'
    : req.url === '/request-access' ? '/request-access.html'
    : req.url  // default documents
  reqPath = path.normalize(reqPath).replace(/^(\.\.[/\\])+/, '')  // strip any attempt to walk out of PUBLIC_DIR
  const full = path.join(PUBLIC_DIR, reqPath)
  if (!full.startsWith(PUBLIC_DIR)) { res.writeHead(403); res.end(); return }  // belt-and-braces on the normalize above
  const content = await fs.readFile(full)  // throws ENOENT for a missing file, caught by the caller
  res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream' })
  res.end(content)
}

// Reverse of ALLOWED_UPLOAD_TYPES, used only to look up the Content-Type an uploaded file is
// served with - by extension, never by re-reading or trusting anything about the request. Since
// every stored file's extension was itself forced from this same map at upload time (never from
// a client-supplied filename), this lookup can't disagree with what was actually allowlisted.
const UPLOAD_CONTENT_TYPE_BY_EXT = new Map([...ALLOWED_UPLOAD_TYPES].map(([type, ext]) => [ext, type]))

// Same path-traversal guard as serveStatic above, just rooted at UPLOADS_DIR instead of
// PUBLIC_DIR - this directory lives outside PUBLIC_DIR specifically because it must survive a
// container rebuild (it's on the /data volume) while PUBLIC_DIR is rebuilt from source.
async function serveUpload(req, res) {
  const reqUrl = req.url.split('?')[0]
  let reqPath = decodeURIComponent(reqUrl.slice('/uploads'.length))
  reqPath = path.normalize(reqPath).replace(/^(\.\.[/\\])+/, '')
  const full = path.join(UPLOADS_DIR, reqPath)
  if (!full.startsWith(UPLOADS_DIR)) { res.writeHead(403); res.end(); return }  // belt-and-braces on the normalize above
  // Every file this endpoint ever wrote has one of these extensions (see ALLOWED_UPLOAD_TYPES);
  // anything else requested here isn't a file this app created, so refuse it rather than
  // guessing at a Content-Type for it.
  const contentType = UPLOAD_CONTENT_TYPE_BY_EXT.get(path.extname(full).toLowerCase())
  if (!contentType) { res.writeHead(404); res.end('Not found'); return }
  const content = await fs.readFile(full)  // throws ENOENT for a missing file, caught by the caller
  res.writeHead(200, { 'Content-Type': contentType, 'X-Content-Type-Options': 'nosniff' })
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

    if (req.url === '/api/upload' && req.method === 'POST') {
      let body = ''
      let tooLarge = false
      req.on('data', (chunk) => {
        body += chunk
        if (body.length > MAX_UPLOAD_RAW_BODY_BYTES) { tooLarge = true; req.destroy() }  // destroy early; base64 headroom is accounted for above the decoded MAX_UPLOAD_BYTES cap
      })
      req.on('end', async () => {
        if (tooLarge) return  // connection already dropped, nothing to respond to
        try {
          const { filename, contentType, dataBase64, personId } = JSON.parse(body)
          const ext = ALLOWED_UPLOAD_TYPES.get(contentType)
          if (!ext) throw new Error('unsupported contentType')
          if (typeof dataBase64 !== 'string' || !dataBase64) throw new Error('dataBase64 is required')
          const safePersonId = assertValidPersonId(personId)
          const buffer = Buffer.from(dataBase64, 'base64')
          if (buffer.length === 0) throw new Error('empty file')
          if (buffer.length > MAX_UPLOAD_BYTES) throw new Error('file too large (15MB max)')

          const personDir = path.join(UPLOADS_DIR, safePersonId)
          await fs.mkdir(personDir, { recursive: true })  // don't assume the volume mount already created this
          // The extension always comes from `ext` (derived from the validated contentType),
          // never from the client's own filename - see ALLOWED_UPLOAD_TYPES's comment above.
          const storedName = `${Date.now()}-${sanitizeFilename(filename)}${ext}`
          const dest = path.join(personDir, storedName)
          // Written directly rather than via writeTree's tmp-then-rename pattern: every
          // upload gets a fresh timestamped name, so there's no existing file at `dest` this
          // could partially overwrite - a failed write just leaves nothing there, never a
          // corrupted "real" file the way an in-place overwrite of tree.json could.
          await fs.writeFile(dest, buffer)

          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ url: `/uploads/${safePersonId}/${storedName}` }))
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: err.message }))
        }
      })
      return
    }

    if (req.url.startsWith('/uploads/')) {
      await serveUpload(req, res)
      return
    }

    if (req.url === '/api/request-access' && req.method === 'POST') {
      if (isRateLimited(clientIp(req))) {
        res.writeHead(429, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Too many requests - try again later, or email rod@lunt.au directly.' }))
        return
      }
      let body = ''
      req.on('data', (chunk) => {
        body += chunk
        if (body.length > 10_000) req.destroy()  // this is a name/email/short note, never legitimately large
      })
      req.on('end', async () => {
        try {
          const { name, email, note } = JSON.parse(body)
          if (typeof name !== 'string' || typeof email !== 'string' || typeof (note ?? '') !== 'string') {
            throw new Error('name and email are required')
          }
          const trimmedName = name.trim()
          const trimmedEmail = email.trim()
          const trimmedNote = (note || '').trim()
          if (!trimmedName || trimmedName.length > 200) throw new Error('name must be 1-200 characters')
          if (!isValidEmail(trimmedEmail) || trimmedEmail.length > 200) throw new Error('a valid email is required')
          if (trimmedNote.length > 1000) throw new Error('note must be 1000 characters or fewer')
          if (hasControlChars(trimmedName) || hasControlChars(trimmedEmail)) throw new Error('invalid characters in name or email')
          try {
            await sendAccessRequestEmail({ name: trimmedName, email: trimmedEmail, note: trimmedNote })
          } catch (sendErr) {
            console.error(sendErr)
            res.writeHead(500, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'Could not send the request right now - please email rod@lunt.au directly.' }))
            return
          }
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: true }))
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: err.message }))
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
