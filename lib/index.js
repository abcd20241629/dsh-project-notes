/**
 * Host half of dsh-project-notes.
 *
 * Owns the on-disk store under `$DSH_HOME/project-notes/<id>/` and a small
 * same-origin HTTP bridge that client.js calls with fetch(). Layout:
 *
 *   project-notes/
 *     <id>/project.json
 *     <id>/attachments/<stored-name>
 *     _trash/<id>-<ts>/...
 *
 * Every route answers `{ ok: true, value }` or `{ ok: false, code, message }`.
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'

const PREFIX = '/api/dsh-project-notes'
const MAX_JSON_BYTES = 8 * 1024 * 1024
const MAX_ATTACH_BYTES = 50 * 1024 * 1024
const ID_RE = /^[A-Za-z0-9_-]{1,80}$/
const STORED_RE = /^[A-Za-z0-9._-]{1,200}$/

export const name = 'project-notes'
export const inject = ['webServer']

// ── storage helpers ─────────────────────────────────────────────────────────

function notesRoot() {
  const home = typeof process.env.DSH_HOME === 'string' ? process.env.DSH_HOME.trim() : ''
  const base = home !== '' ? path.resolve(home) : path.join(process.env.USERPROFILE || '.', '.dsh')
  return path.join(base, 'project-notes')
}

function safeId(value) {
  const id = String(value ?? '')
  if (!ID_RE.test(id) || id === '.' || id === '..') {
    throw Object.assign(new Error('invalid project id'), { code: 'bad-id' })
  }
  return id
}

function safeStored(value) {
  const stored = String(value ?? '')
  if (!STORED_RE.test(stored) || stored === '.' || stored === '..') {
    throw Object.assign(new Error('invalid attachment name'), { code: 'bad-name' })
  }
  return stored
}

function cleanName(value, fallback = '未命名项目') {
  const raw = String(value ?? '').replace(/[\r\n\t]/g, ' ').trim()
  const name = raw === '' ? fallback : raw
  return name.slice(0, 120)
}

function projectDir(id) {
  return path.join(notesRoot(), safeId(id))
}

/** A name that is safe to drop into an exported file name on Windows. */
function safeFileName(value, fallback) {
  const raw = cleanName(value, fallback).replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim()
  return raw === '' ? fallback : raw
}

function htmlToPlain(html) {
  return String(html ?? '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(div|p|li)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n')
}

function docToMarkdown(doc) {
  const cards = Array.isArray(doc.cards) ? doc.cards : []
  const groups = Array.isArray(doc.groups) ? doc.groups : []
  const links = Array.isArray(doc.links) ? doc.links : []
  const byId = new Map(cards.map((card) => [card.id, card]))
  const groupOf = new Map()
  for (const group of groups) {
    for (const id of group.cardIds || []) groupOf.set(id, group.title)
  }
  const out = [`# ${doc.name || '项目笔记'}`, '', `> 更新于 ${doc.updatedAt || ''}`, '']
  cards.forEach((card, index) => {
    const group = groupOf.get(card.id)
    out.push(`## ${group ? `[${group}] ` : ''}卡片 ${index + 1}`, '')
    const text = htmlToPlain(card.html)
    out.push(text === '' ? '_（空卡片）_' : text, '')
    if (Array.isArray(card.attachments) && card.attachments.length > 0) {
      out.push(...card.attachments.map((file) => `- 附件：${file.name}`), '')
    }
  })
  const labelled = links.filter((link) => String(link.label || '').trim() !== '')
  if (labelled.length > 0) {
    out.push('## 连线', '')
    for (const link of labelled) {
      const from = byId.get(link.from)
      const to = byId.get(link.to)
      const head = (card) => {
        const text = htmlToPlain(card && card.html)
        return text === '' ? '（空卡片）' : text.split('\n')[0].slice(0, 40)
      }
      out.push(`- ${head(from)} → ${head(to)}：${link.label}`)
    }
    out.push('')
  }
  return `${out.join('\n').trimEnd()}\n`
}

async function ensureRoot() {
  await fs.mkdir(notesRoot(), { recursive: true })
}

async function readJsonFile(file, fallback) {
  try {
    const text = await fs.readFile(file, 'utf8')
    return JSON.parse(text)
  } catch (error) {
    if (error && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) return fallback
    throw error
  }
}

async function writeJsonAtomic(file, value) {
  const tmp = `${file}.${process.pid}.tmp`
  await fs.writeFile(tmp, JSON.stringify(value, null, 2), 'utf8')
  await fs.rename(tmp, file)
}

function nowIso() {
  return new Date().toISOString()
}

function newId() {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`
  const rand = Math.random().toString(36).slice(2, 6)
  return `${stamp}-${rand}`
}

function emptyDoc(id, name) {
  const at = nowIso()
  return {
    version: 1,
    id,
    name,
    createdAt: at,
    updatedAt: at,
    viewport: { x: 0, y: 0, zoom: 1 },
    cards: [],
    links: [],
    groups: [],
  }
}

function asArray(value) {
  return Array.isArray(value) ? value : []
}

/** Accept anything the client sends, but never persist a structurally broken doc. */
function normalizeDoc(input, fallback) {
  const doc = input !== null && typeof input === 'object' && !Array.isArray(input) ? input : {}
  const base = fallback !== null && typeof fallback === 'object' ? fallback : {}
  const viewport = doc.viewport !== null && typeof doc.viewport === 'object' ? doc.viewport : {}
  return {
    version: 1,
    id: String(base.id ?? doc.id ?? ''),
    name: cleanName(doc.name ?? base.name),
    createdAt: String(base.createdAt ?? doc.createdAt ?? nowIso()),
    updatedAt: nowIso(),
    viewport: {
      x: Number.isFinite(viewport.x) ? viewport.x : Number(base.viewport?.x) || 0,
      y: Number.isFinite(viewport.y) ? viewport.y : Number(base.viewport?.y) || 0,
      zoom: Number.isFinite(viewport.zoom) ? Math.min(2.5, Math.max(0.25, viewport.zoom)) : 1,
    },
    cards: asArray(doc.cards).filter((card) => card && typeof card === 'object' && typeof card.id === 'string'),
    links: asArray(doc.links).filter((link) => link && typeof link === 'object' && link.from && link.to),
    groups: asArray(doc.groups).filter((group) => group && typeof group === 'object' && typeof group.id === 'string'),
  }
}

async function readProject(id) {
  const dir = projectDir(id)
  const doc = await readJsonFile(path.join(dir, 'project.json'), null)
  if (doc === null) return null
  return normalizeDoc(doc, doc)
}

// Appends " (2)", " (3)"… when a project with the same display name already exists.
async function uniqueName(base) {
  const wanted = cleanName(base)
  const used = new Set()
  try {
    const entries = await fs.readdir(notesRoot(), { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('_') || entry.name.startsWith('.')) continue
      const doc = await readProject(entry.name)
      if (doc) used.add(doc.name)
    }
  } catch {
    // A missing root simply means nothing to compare against.
  }
  if (!used.has(wanted)) return wanted
  let index = 2
  while (used.has(`${wanted} (${index})`)) index += 1
  return `${wanted} (${index})`
}

// ── http helpers ────────────────────────────────────────────────────────────

function writeJson(res, status, body) {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'referrer-policy': 'no-referrer',
  })
  res.end(payload)
}

function ok(res, value) {
  writeJson(res, 200, { ok: true, value })
}

function fail(res, status, code, message) {
  writeJson(res, status, { ok: false, code, message })
}

function requestAllowed(req) {
  if (req.headers['sec-fetch-site'] === 'cross-site') return false
  const host = req.headers.host
  const origin = req.headers.origin
  if (typeof origin === 'string' && origin !== '') {
    try {
      if (new URL(origin).host !== host) return false
    } catch {
      return false
    }
  }
  return true
}

async function readBody(req, limit) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > limit) return null
    chunks.push(buffer)
  }
  return Buffer.concat(chunks)
}

async function readJsonBody(req) {
  const buffer = await readBody(req, MAX_JSON_BYTES)
  if (buffer === null) return undefined
  try {
    return JSON.parse(buffer.toString('utf8'))
  } catch {
    return undefined
  }
}

function queryOf(req) {
  try {
    return new URL(String(req.url ?? '/'), 'http://localhost').searchParams
  } catch {
    return new URLSearchParams()
  }
}

const MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
}

function openWithShell(filePath) {
  return new Promise((resolve, reject) => {
    execFile('rundll32.exe', ['url.dll,FileProtocolHandler', filePath], { windowsHide: true }, (error) => {
      if (error) reject(error)
      else resolve()
    })
  })
}

function revealInExplorer(filePath) {
  return new Promise((resolve, reject) => {
    execFile('explorer.exe', [`/select,${filePath}`], { windowsHide: true }, (error) => {
      // explorer returns a non-zero exit code even when it works; only a spawn failure matters.
      if (error && error.code !== 1) reject(error)
      else resolve()
    })
  })
}

// ── routes ──────────────────────────────────────────────────────────────────

function makeRoutes() {
  const guarded = (handler) => async (req, res) => {
    try {
      if (!requestAllowed(req)) return fail(res, 403, 'forbidden', 'cross-site requests are not allowed')
      if (req.method !== 'POST') return fail(res, 405, 'bad-method', `method not allowed: ${req.method}`)
      return await handler(req, res)
    } catch (error) {
      const code = (error && error.code) || 'internal'
      return fail(res, 500, String(code), error instanceof Error ? error.message : String(error))
    }
  }

  return [
    {
      kind: 'exact',
      path: `${PREFIX}/list`,
      handler: guarded(async (req, res) => {
        await ensureRoot()
        const entries = await fs.readdir(notesRoot(), { withFileTypes: true })
        const projects = []
        for (const entry of entries) {
          if (!entry.isDirectory() || entry.name.startsWith('_') || entry.name.startsWith('.')) continue
          try {
            const doc = await readProject(entry.name)
            if (doc === null) continue
            projects.push({
              id: doc.id || entry.name,
              name: doc.name,
              cards: doc.cards.length,
              starred: doc.cards.filter((card) => card.starred === true).length,
              createdAt: doc.createdAt,
              updatedAt: doc.updatedAt,
            })
          } catch {
            // Skip a broken project directory instead of failing the whole list.
          }
        }
        projects.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
        return ok(res, { projects })
      }),
    },
    {
      kind: 'exact',
      path: `${PREFIX}/create`,
      handler: guarded(async (req, res) => {
        const body = await readJsonBody(req)
        if (body === undefined) return fail(res, 400, 'bad-body', 'malformed JSON body')
        await ensureRoot()
        const id = newId()
        const name = cleanName(body?.name)
        const dir = projectDir(id)
        await fs.mkdir(path.join(dir, 'attachments'), { recursive: true })
        const doc = emptyDoc(id, name)
        await writeJsonAtomic(path.join(dir, 'project.json'), doc)
        return ok(res, { id, doc })
      }),
    },
    {
      kind: 'exact',
      path: `${PREFIX}/load`,
      handler: guarded(async (req, res) => {
        const body = await readJsonBody(req)
        if (body === undefined) return fail(res, 400, 'bad-body', 'malformed JSON body')
        const doc = await readProject(body?.id)
        if (doc === null) return fail(res, 404, 'not-found', 'project not found')
        return ok(res, { doc })
      }),
    },
    {
      kind: 'exact',
      path: `${PREFIX}/save`,
      handler: guarded(async (req, res) => {
        const body = await readJsonBody(req)
        if (body === undefined) return fail(res, 400, 'bad-body', 'malformed JSON body')
        const id = safeId(body?.id)
        const dir = projectDir(id)
        const existing = await readJsonFile(path.join(dir, 'project.json'), null)
        if (existing === null) return fail(res, 404, 'not-found', 'project not found')
        const doc = normalizeDoc(body?.doc, { ...existing, id })
        doc.id = id
        await writeJsonAtomic(path.join(dir, 'project.json'), doc)
        return ok(res, { id, updatedAt: doc.updatedAt })
      }),
    },
    {
      kind: 'exact',
      path: `${PREFIX}/export`,
      handler: guarded(async (req, res) => {
        const body = await readJsonBody(req)
        if (body === undefined) return fail(res, 400, 'bad-body', 'malformed JSON body')
        const id = safeId(body?.id)
        const dir = projectDir(id)
        const doc = await readJsonFile(path.join(dir, 'project.json'), null)
        if (doc === null) return fail(res, 404, 'not-found', 'project not found')
        const format = body?.format === 'md' ? 'md' : 'json'
        const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
        const file = path.join(dir, `${safeFileName(doc.name, id)}-${stamp}.${format}`)
        const content = format === 'json' ? JSON.stringify(doc, null, 2) : docToMarkdown(doc)
        await fs.writeFile(file, content, 'utf8')
        return ok(res, { path: file, format })
      }),
    },
    {
      kind: 'exact',
      path: `${PREFIX}/rename`,
      handler: guarded(async (req, res) => {
        const body = await readJsonBody(req)
        if (body === undefined) return fail(res, 400, 'bad-body', 'malformed JSON body')
        const id = safeId(body?.id)
        const dir = projectDir(id)
        const doc = await readJsonFile(path.join(dir, 'project.json'), null)
        if (doc === null) return fail(res, 404, 'not-found', 'project not found')
        doc.name = cleanName(body?.name, doc.name)
        doc.updatedAt = nowIso()
        await writeJsonAtomic(path.join(dir, 'project.json'), doc)
        return ok(res, { id, name: doc.name })
      }),
    },
    {
      kind: 'exact',
      path: `${PREFIX}/duplicate`,
      handler: guarded(async (req, res) => {
        const body = await readJsonBody(req)
        if (body === undefined) return fail(res, 400, 'bad-body', 'malformed JSON body')
        const sourceId = safeId(body?.id)
        const sourceDir = projectDir(sourceId)
        const sourceDoc = await readJsonFile(path.join(sourceDir, 'project.json'), null)
        if (sourceDoc === null) return fail(res, 404, 'not-found', 'project not found')
        const id = newId()
        const dir = projectDir(id)
        await fs.cp(sourceDir, dir, { recursive: true })
        const doc = normalizeDoc(
          { ...sourceDoc, id, name: `${cleanName(sourceDoc.name)} 副本`, createdAt: nowIso() },
          { ...sourceDoc, id },
        )
        await writeJsonAtomic(path.join(dir, 'project.json'), doc)
        return ok(res, { id, doc })
      }),
    },
    {
      kind: 'exact',
      path: `${PREFIX}/remove`,
      handler: guarded(async (req, res) => {
        const body = await readJsonBody(req)
        if (body === undefined) return fail(res, 400, 'bad-body', 'malformed JSON body')
        const id = safeId(body?.id)
        const dir = projectDir(id)
        try {
          await fs.access(dir)
        } catch {
          return fail(res, 404, 'not-found', 'project not found')
        }
        await ensureRoot()
        const trash = path.join(notesRoot(), '_trash')
        await fs.mkdir(trash, { recursive: true })
        const target = path.join(trash, `${id}-${Date.now()}`)
        await fs.rename(dir, target)
        return ok(res, { movedTo: path.basename(target) })
      }),
    },
    {
      kind: 'exact',
      path: `${PREFIX}/import`,
      handler: guarded(async (req, res) => {
        const body = await readJsonBody(req)
        if (body === undefined) return fail(res, 400, 'bad-body', 'malformed JSON body')
        const incoming = body?.doc
        if (incoming === null || typeof incoming !== 'object') return fail(res, 400, 'bad-doc', 'doc is required')
        await ensureRoot()
        const id = newId()
        const dir = projectDir(id)
        await fs.mkdir(path.join(dir, 'attachments'), { recursive: true })
        const doc = normalizeDoc({ ...incoming, id, name: await uniqueName(body?.name ?? incoming.name) }, { id })
        doc.id = id
        await writeJsonAtomic(path.join(dir, 'project.json'), doc)
        return ok(res, { id, doc })
      }),
    },
    {
      kind: 'exact',
      path: `${PREFIX}/upload`,
      handler: guarded(async (req, res) => {
        const query = queryOf(req)
        const id = safeId(query.get('id'))
        const displayName = cleanName(query.get('name'), 'attachment')
        const buffer = await readBody(req, MAX_ATTACH_BYTES)
        if (buffer === null) return fail(res, 413, 'too-large', `attachment exceeds ${MAX_ATTACH_BYTES} bytes`)
        if (buffer.length === 0) return fail(res, 400, 'empty', 'empty attachment body')
        const dir = projectDir(id)
        await fs.access(path.join(dir, 'project.json'))
        const attachDir = path.join(dir, 'attachments')
        await fs.mkdir(attachDir, { recursive: true })
        const safeName = displayName.replace(/[\\/:*?"<>|]/g, '_').slice(0, 80)
        const stamp = Date.now().toString(36)
        const rand = Math.random().toString(36).slice(2, 6)
        const stored = `a${stamp}${rand}-${safeName}`
        await fs.writeFile(path.join(attachDir, stored), buffer)
        return ok(res, { stored, name: displayName, size: buffer.length })
      }),
    },
    {
      kind: 'exact',
      path: `${PREFIX}/open`,
      handler: guarded(async (req, res) => {
        const body = await readJsonBody(req)
        if (body === undefined) return fail(res, 400, 'bad-body', 'malformed JSON body')
        const dir = projectDir(body?.id)
        const file = path.join(dir, 'attachments', safeStored(body?.stored))
        await fs.access(file)
        await openWithShell(file)
        return ok(res, { opened: true })
      }),
    },
    {
      kind: 'exact',
      path: `${PREFIX}/attach-path`,
      handler: guarded(async (req, res) => {
        const body = await readJsonBody(req)
        if (body === undefined) return fail(res, 400, 'bad-body', 'malformed JSON body')
        const dir = projectDir(body?.id)
        const file = path.join(dir, 'attachments', safeStored(body?.stored))
        await fs.access(file)
        return ok(res, { path: file })
      }),
    },
    {
      kind: 'exact',
      path: `${PREFIX}/remove-attachment`,
      handler: guarded(async (req, res) => {
        const body = await readJsonBody(req)
        if (body === undefined) return fail(res, 400, 'bad-body', 'malformed JSON body')
        const dir = projectDir(body?.id)
        const file = path.join(dir, 'attachments', safeStored(body?.stored))
        try {
          await fs.unlink(file)
        } catch (error) {
          if (!error || error.code !== 'ENOENT') throw error
        }
        return ok(res, { removed: true })
      }),
    },
    {
      kind: 'exact',
      path: `${PREFIX}/reveal`,
      handler: guarded(async (req, res) => {
        const body = await readJsonBody(req)
        if (body === undefined) return fail(res, 400, 'bad-body', 'malformed JSON body')
        const dir = projectDir(body?.id)
        const file = path.join(dir, 'attachments', safeStored(body?.stored))
        await fs.access(file)
        await revealInExplorer(file)
        return ok(res, { revealed: true })
      }),
    },
    {
      kind: 'exact',
      path: `${PREFIX}/attachment`,
      handler: async (req, res) => {
        try {
          if (!requestAllowed(req)) return fail(res, 403, 'forbidden', 'cross-site requests are not allowed')
          if (req.method !== 'GET') return fail(res, 405, 'bad-method', 'method not allowed')
          const query = queryOf(req)
          const dir = projectDir(query.get('id'))
          const file = path.join(dir, 'attachments', safeStored(query.get('stored')))
          const buffer = await fs.readFile(file)
          const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream'
          res.writeHead(200, {
            'content-type': type,
            'content-length': buffer.length,
            'cache-control': 'private, max-age=300',
          })
          res.end(buffer)
        } catch (error) {
          const status = error && error.code === 'ENOENT' ? 404 : 500
          return fail(res, status, 'attachment-failed', error instanceof Error ? error.message : String(error))
        }
      },
    },
  ]
}

// ── plugin entry ────────────────────────────────────────────────────────────

export function apply(ctx) {
  ctx.inject(['webServer'], (scope) => {
    const routes = makeRoutes()
    scope.effect(() => {
      const disposers = routes.map((route) => scope.webServer.register(route))
      return () => {
        for (const dispose of disposers) {
          try {
            if (typeof dispose === 'function') dispose()
          } catch {
            // A route already removed by teardown is not an error.
          }
        }
      }
    }, 'project-notes: bridge routes')
  })
}
