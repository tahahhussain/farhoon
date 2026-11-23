// End-to-end check of Farhoon tracking: a headless Edge visitor opens an article, scrolls to the download box,
// clicks it, and the script lists the events sent to Google Analytics (region/collect requests).
// Usage: node test-tracking.mjs [url]
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const url = process.argv[2] || 'https://farhoon.com/blog/qibla-direction-phone/';
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const port = 9355;
const br = spawn(EDGE, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${join(tmpdir(), 'fb-track-' + Date.now())}`, '--no-first-run', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let t; for (let i = 0; i < 60; i++) { try { t = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (t.find((x) => x.type === 'page')) break; } catch {} await sleep(300); }
const ws = new WebSocket(t.find((x) => x.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0; const pend = new Map(); const hits = [];
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && pend.has(msg.id)) { pend.get(msg.id)(msg); pend.delete(msg.id); }
  if (msg.method === 'Network.requestWillBeSent') {
    const u = msg.params.request.url;
    if (/google-analytics\.com\/(g|.*)\/collect/.test(u)) {
      const q = new URL(u).searchParams; const body = msg.params.request.postData || '';
      const evs = [q.get('en'), ...body.split('\n').map((l) => new URLSearchParams(l).get('en'))].filter(Boolean);
      hits.push({ tid: q.get('tid'), events: evs, gcs: q.get('gcs'), ep: [...q.keys()].filter((k) => k.startsWith('ep.')).map((k) => k + '=' + q.get(k)).join(' ') });
    }
  }
};
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
await send('Network.enable'); await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 412, height: 900, deviceScaleFactor: 1, mobile: true });
await send('Page.navigate', { url }); await sleep(6000);
await send('Runtime.evaluate', { expression: "document.querySelector('.f-cta').scrollIntoView({block:'center'})" }); await sleep(2500);
await send('Runtime.evaluate', { expression: "(() => { const a = document.querySelector('.f-cta a'); a.addEventListener('click', e => e.preventDefault(), {once:true}); a.click(); return a.href; })()" });
await sleep(3000);
const dl = await send('Runtime.evaluate', { expression: "JSON.stringify(dataLayer.filter(e => e.event && !String(e.event).startsWith('gtm')).map(e => e.event))", returnByValue: true });
await sleep(6000); await send("Page.navigate", { url: "about:blank" }); await sleep(3000);
console.log('dataLayer events:', dl.result.result.value);
for (const h of hits) console.log('GA hit', h.tid, h.events.join(','), 'consent', h.gcs, h.ep);
ws.close(); br.kill();
