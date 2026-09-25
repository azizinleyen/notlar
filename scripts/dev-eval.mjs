#!/usr/bin/env node
/** dev-eval.mjs — CDP ile arayuzde JS calistirir ve sonucu yazdirir (gelistirme araci).
 *  Kullanim: node scripts/dev-eval.mjs "document.querySelectorAll('button').length" */
import { readFileSync } from 'node:fs'

const PORT = 9333
// Turbce karakter iceren ifadeler icin argv yerine UTF-8 dosyadan oku:
//   node scripts/dev-eval.mjs @ifade.js
let expr = process.argv[2]
if (!expr) { console.log('kullanim: node scripts/dev-eval.mjs "<js ifadesi>" | @dosya.js'); process.exit(1) }
if (expr.startsWith('@')) expr = readFileSync(expr.slice(1), 'utf8')
const target = process.argv[3] ?? ''
const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
const pages = list.filter((t) => t.type === 'page')
const page = target ? pages.find((t) => t.url.includes(target)) : pages[0]
if (!page) { console.log('SAYFA YOK:', pages.map((t)=>t.url.split('/').pop()).join(', ')); process.exit(1) }
const ws = new WebSocket(page.webSocketDebuggerUrl)
let id = 1
const pending = new Map()
const send = (m, p) => new Promise((r) => { const my = id++; pending.set(my, r); ws.send(JSON.stringify({ id: my, method: m, params: p })) })
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) } }
await new Promise((r) => { ws.onopen = r })
await send('Runtime.enable', {})
const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
if (r.result?.exceptionDetails) { console.log('HATA:', r.result.exceptionDetails.text); process.exit(1) }
console.log(JSON.stringify(r.result?.result?.value))
ws.close()