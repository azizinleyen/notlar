#!/usr/bin/env node
/**
 * dev-shot.mjs — Uygulamanin EKRAN GORUNTUSUNU CDP uzerinden alir.
 * Pencere one getirme sorunu yasamaz; dogrudan renderer'i yakalar.
 * Kullanim: node scripts/dev-shot.mjs [cikti.png]
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
const PORT = 9333
const out = resolve(process.argv[2] ?? 'docs/ekran-goruntusu.png')
// Ikinci arg: hedef sayfa filtresi (or. 'notify' -> notify.html)
const target = process.argv[3] ?? ''

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
const pages = list.filter((t) => t.type === 'page')
const page = target ? pages.find((t) => t.url.includes(target)) : pages[0]
if (!page) {
  console.log('SAYFA YOK. Mevcut:', pages.map((t) => t.url.split('/').pop()).join(', '))
  process.exit(1)
}
const ws = new WebSocket(page.webSocketDebuggerUrl)
let id = 1
const pending = new Map()
const send = (m, p) => new Promise((r) => { const my = id++; pending.set(my, r); ws.send(JSON.stringify({ id: my, method: m, params: p })) })
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) } }
await new Promise((r) => { ws.onopen = r })
const res = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
const data = res.result?.data
if (!data) { console.log('Screenshot alinamadi:', JSON.stringify(res).slice(0, 300)); process.exit(1) }
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, Buffer.from(data, 'base64'))
console.log('Screenshot:', out, Buffer.from(data, 'base64').length, 'byte')
ws.close()