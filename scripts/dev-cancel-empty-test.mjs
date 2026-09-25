#!/usr/bin/env node
/**
 * dev-cancel-empty-test.mjs — Bos kaydin iptalinde notun SILINMESINI dogrular.
 * Kayit baslatilir, ilk parca gonderilmeden (~1.5 sn) hemen iptal edilir.
 */
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'

const PORT = 9333
const dbPath = join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'notlar', 'db', 'notlar.db')
const countNotes = () => {
  const db = new DatabaseSync(dbPath, { readOnly: true })
  const r = { notes: db.prepare('select count(*) c from notes').get().c, recording: db.prepare("select count(*) c from notes where status='recording'").get().c }
  db.close()
  return r
}
const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
const page = list.find((t) => t.type === 'page')
const ws = new WebSocket(page.webSocketDebuggerUrl)
let id = 1
const pending = new Map()
const send = (m, p) => new Promise((r) => { const my = id++; pending.set(my, r); ws.send(JSON.stringify({ id: my, method: m, params: p })) })
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) } }
await new Promise((r) => { ws.onopen = r })
await send('Runtime.enable', {})
const ev = async (x) => {
  const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true })
  return r.result?.exceptionDetails ? 'HATA:' + r.result.exceptionDetails.text : r.result?.result?.value
}
const clickText = (t) => ev(`(() => { const b=[...document.querySelectorAll('button')].find(e=>(e.textContent||'').trim().includes(${JSON.stringify(t)})); if(!b) return 'BUTON_YOK'; if(b.disabled) return 'DEVRE_DISI'; b.click(); return 'OK'; })()`)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const base = countNotes()
console.log('DB baslangic:', JSON.stringify(base))

console.log('1) Diyalog:', await clickText('Canlı kayıt başlat'))
await sleep(2500)
console.log('2) Kaydi baslat:', await clickText('Kaydı başlat'))
await sleep(900) // ilk parca (>=1500 ms) gonderilmeden iptal
console.log('   DB kayit surerken:', JSON.stringify(countNotes()))
console.log('3) Iptal (X):', await ev(`(() => { const b=document.querySelector('button[title^="Kaydı iptal"]'); if(!b) return 'X_YOK'; b.click(); return 'OK' })()`))
await sleep(700)
console.log('4) Onayla:', await clickText('İptal et'))
await sleep(3500)

const after = countNotes()
console.log('   toast:', await ev(`(document.body.innerText.match(/Kayıt iptal edildi[^\\n]*/)||['yok'])[0]`))
console.log('DB sonuc:', JSON.stringify(after))
console.log(after.notes === base.notes && after.recording === 0
  ? 'SONUC: BOS NOT SILINDI ✅ (not sayisi degismedi, recording=0)'
  : 'SONUC: beklenmeyen durum ❌')
ws.close()