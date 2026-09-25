const base = 'http://127.0.0.1:9333'
const list = await (await fetch(base + '/json/list')).json()
const page = list.find((t) => t.type === 'page')
if (!page) { console.log('SAYFA HEDEFI YOK:', JSON.stringify(list).slice(0,300)); process.exit(1) }
const ws = new WebSocket(page.webSocketDebuggerUrl)
let id = 1
const pending = new Map()
const send = (method, params) => new Promise((res) => { const myId = id++; pending.set(myId, res); ws.send(JSON.stringify({ id: myId, method, params })) })
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) } }
await new Promise((r) => { ws.onopen = r })
await send('Runtime.enable', {})
const r = await send('Runtime.evaluate', { expression: 'document.body.innerText', returnByValue: true })
const txt = r.result?.result?.value ?? ''
console.log('--- DOM METNI (ilk 1800 karakter) ---')
console.log(txt.slice(0, 1800))
const checks = await send('Runtime.evaluate', { expression: `JSON.stringify({sidebar: !!document.querySelector('aside'), asideCount: document.querySelectorAll('aside').length, bubbles: document.querySelectorAll('p.rounded-2xl').length, buttons: document.querySelectorAll('button').length, cssLoaded: getComputedStyle(document.body).backgroundColor})`, returnByValue: true })
console.log('--- YAPISAL KONTROL ---')
console.log(checks.result?.result?.value ?? '(yok)')
ws.close()