#!/usr/bin/env node
/**
 * dev-live-capture-test.mjs — GERCEK yakalama yolunu (mikrofon + sistem loopback)
 * CDP uzerinden surer. Simulasyonu degil, kullanicinin gordugu akisi test eder:
 *   "Canli kayit baslat" -> diyalog -> "Kaydi baslat" -> bekle -> "Durdur"
 *
 * Kullanim: node scripts/dev-live-capture-test.mjs [beklemeSaniye]
 */
const PORT = 9333
const WAIT_S = Number(process.argv[2] ?? 18)

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
const page = list.find((t) => t.type === 'page')
if (!page) {
  console.log('SAYFA YOK')
  process.exit(1)
}
const ws = new WebSocket(page.webSocketDebuggerUrl)
let id = 1
const pending = new Map()
const send = (method, params) => new Promise((res) => { const my = id++; pending.set(my, res); ws.send(JSON.stringify({ id: my, method, params })) })
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) } }
await new Promise((r) => { ws.onopen = r })
await send('Runtime.enable', {})

const evalJs = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
  if (r.result?.exceptionDetails) return { error: r.result.exceptionDetails.text + ' ' + (r.result.exceptionDetails.exception?.description ?? '') }
  return { value: r.result?.result?.value }
}
const click = (text) => evalJs(`(() => {
  const b = [...document.querySelectorAll('button')].find(el => (el.textContent||'').trim().includes(${JSON.stringify(text)}));
  if (!b) return 'BUTON_YOK';
  if (b.disabled) return 'DEVRE_DISI';
  b.click(); return 'OK';
})()`)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

console.log('1) Cihaz envanteri + ham akis testi')
console.log('   mikrofon:', JSON.stringify(await evalJs(`(async () => {
  try {
    const s = await navigator.mediaDevices.getUserMedia({ audio: true });
    const t = s.getAudioTracks()[0];
    const info = { tracks: s.getAudioTracks().length, state: t?.readyState, label: t?.label };
    s.getTracks().forEach(x => x.stop());
    return info;
  } catch (e) { return { error: String(e) } }
})()`)))

console.log('2) Sistem sesi (loopback) ham akis testi')
console.log('   system:', JSON.stringify(await evalJs(`(async () => {
  try {
    const s = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    const a = s.getAudioTracks()[0];
    const info = { audioTracks: s.getAudioTracks().length, videoTracks: s.getVideoTracks().length, state: a?.readyState, label: a?.label };
    s.getTracks().forEach(x => x.stop());
    return info;
  } catch (e) { return { error: String(e) } }
})()`)))

console.log('3) Kayit diyalogu aciliyor')
console.log('   tiklama:', await click('Canlı kayıt başlat'))
await sleep(2500)

const deviceCount = await evalJs(`document.querySelectorAll('select option').length`)
console.log('   secenek sayisi (cihaz+dil):', JSON.stringify(deviceCount))

console.log('4) Kayit baslatiliyor')
console.log('   tiklama:', await click('Kaydı başlat'))

// Kayit cubugu gorunene kadar bekle
for (let i = 0; i < 20; i++) {
  await sleep(500)
  const bar = await evalJs(`(() => {
    const el = [...document.querySelectorAll('div')].find(d => /Duraklat|Harici kayıt/.test(d.textContent||'') && d.querySelector('button'));
    return el ? (el.textContent||'').replace(/\\s+/g,' ').trim().slice(0,120) : null;
  })()`)
  if (bar.value) {
    console.log('   kayit cubugu:', bar.value)
    break
  }
}

console.log(`5) ${WAIT_S} sn kayit (ses akisi bekleniyor)`)
await sleep(WAIT_S * 1000)

const live = await evalJs(`(() => {
  const t = document.body.innerText;
  const m = t.match(/Transkript\\n([\\s\\S]{0,600})/);
  return { bubbles: document.querySelectorAll('p.rounded-2xl').length, parca: m ? m[1].replace(/\\s+/g,' ').slice(0,300) : 'yok' };
})()`)
console.log('   canli durum:', JSON.stringify(live.value))

console.log('6) Durduruluyor')
console.log('   tiklama:', await click('Durdur'))
await sleep(4000)

const final = await evalJs(`(() => ({
  bubbles: document.querySelectorAll('p.rounded-2xl').length,
  metin: (document.body.innerText.match(/Transkript\\n([\\s\\S]{0,800})/)||[])[1]?.replace(/\\s+/g,' ').slice(0,400) || 'yok'
}))()`)
console.log('   son durum:', JSON.stringify(final.value))

ws.close()