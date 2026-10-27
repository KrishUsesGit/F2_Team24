// Minimal, dependency-free driver for the locally installed Chrome or Edge
// (DevTools protocol over Node's built-in WebSocket). Shared by the checks in
// scripts/. Set BROWSER_PATH to use a specific executable.

import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

export function findBrowser() {
  const candidates = [
    process.env.BROWSER_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ]
  return candidates.find((path) => path && existsSync(path))
}

/** Starts a headless browser and returns { send, onEvent, close }. Throws when none is installed. */
export async function launchBrowser(profilePrefix = 'hoptrace-browser-') {
  const browserPath = findBrowser()
  if (!browserPath) throw new Error('no Chrome or Edge found. Set BROWSER_PATH.')
  const profile = mkdtempSync(join(tmpdir(), profilePrefix))
  const child = spawn(
    browserPath,
    ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--disable-gpu', 'about:blank'],
    { stdio: 'ignore' },
  )

  let wsUrl = null
  for (let attempt = 0; attempt < 100 && wsUrl === null; attempt += 1) {
    const portFile = join(profile, 'DevToolsActivePort')
    if (existsSync(portFile)) {
      const [port] = readFileSync(portFile, 'utf-8').split('\n')
      const list = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json())
      wsUrl = list.find((entry) => entry.type === 'page')?.webSocketDebuggerUrl ?? null
    }
    if (wsUrl === null) await sleep(100)
  }
  if (wsUrl === null) {
    child.kill()
    throw new Error('browser did not expose a DevTools endpoint')
  }

  const socket = new WebSocket(wsUrl)
  await new Promise((done, fail) => {
    socket.addEventListener('open', done, { once: true })
    socket.addEventListener('error', fail, { once: true })
  })
  let nextId = 0
  const pending = new Map()
  const listeners = []
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    if (message.id !== undefined && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id)
      pending.delete(message.id)
      if (message.error) reject(new Error(message.error.message))
      else resolve(message.result)
    } else if (message.method) {
      for (const listener of listeners) listener(message.method, message.params)
    }
  })

  return {
    send: (method, params = {}) =>
      new Promise((resolve, reject) => {
        const id = (nextId += 1)
        pending.set(id, { resolve, reject })
        socket.send(JSON.stringify({ id, method, params }))
      }),
    onEvent: (listener) => listeners.push(listener),
    close: () => {
      socket.close()
      child.kill()
    },
  }
}
