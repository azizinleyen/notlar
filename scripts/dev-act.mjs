#!/usr/bin/env node
/** dev-act.mjs — CDP ile arayuzdeki bir butonu metnine gore tiklar (gelistirme araci).
 *  Kullanim: node scripts/dev-act.mjs "Buton metni"   */
const PORT = 9333
const text = process.argv[2]
if (!text) { console.log('kullanim: node scripts/dev-act.mjs "Buton metni"'); process.exit(1) }
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
const r = await send('Runtime.evaluate', {
  expression: `(() => {
    const TXT = ${JSON.stringify(text)};
    const b = [...document.querySelectorAll('button')].find(el => {
      const t = (el.textContent || '').trim();
      const ti = el.getAttribute('title') || '';
      const ar = el.getAttribute('aria-label') || '';
      return t.includes(TXT) || ti.includes(TXT) || ar.includes(TXT);
    });
    if (!b) return 'BUTON_YOK';
    if (b.disabled) return 'DEVRE_DISI';
    b.click(); return 'OK';
  })()`,
  returnByValue: true
})
console.log(text, '->', r.result?.result?.value)
ws.close()