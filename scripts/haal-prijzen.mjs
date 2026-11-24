// Haalt dagelijks beursprijzen op en schrijft data/prijzen.json.
// Bronnen: Energy-Charts (Fraunhofer ISE) voor stroom (day-ahead NL), EnergyZero voor gas (en als reserve voor stroom).
// Er gaan GEEN persoonsgegevens naar deze diensten: alleen datums.
import fs from 'node:fs';

const UIT = new URL('../data/prijzen.json', import.meta.url);
const TZ = 'Europe/Amsterdam';
const nu = new Date();
const fouten = [];
const wacht = (ms) => new Promise((r) => setTimeout(r, ms));
const iso = (d) => d.toISOString().slice(0, 10);

async function getJson(url, pogingen = 3) {
  for (let i = 1; i <= pogingen; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'energie-overstap (prive, 1x per dag)' } });
      if (res.status === 429) { // te veel verzoeken: rustig wachten en opnieuw
        const na = Number(res.headers.get('retry-after')) || 15 * i;
        if (i === pogingen) throw new Error('HTTP 429 (te veel verzoeken)');
        await wacht(Math.min(na, 60) * 1000); continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      if (i === pogingen) throw new Error(`${new URL(url).host}: ${e.message}`);
      await wacht(2000 * i);
    }
  }
}

// ---------- tijd- en profielhulpjes
const fmt = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: 'numeric', minute: 'numeric', month: 'numeric', hourCycle: 'h23' });
function lokaal(ms) {
  const p = Object.fromEntries(fmt.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { uur: Number(p.hour) + Number(p.minute) / 60, maand: Number(p.month) - 1 };
}
const DAGLENGTE = [8, 9.8, 11.8, 13.8, 15.6, 16.6, 16.2, 14.6, 12.6, 10.6, 8.7, 7.7];
const ZONKRACHT = [0.25, 0.45, 0.8, 1.2, 1.5, 1.6, 1.55, 1.3, 0.95, 0.6, 0.3, 0.2];
const WARMTE = [1.5, 1.4, 1.2, 0.9, 0.8, 0.75, 0.75, 0.75, 0.8, 1.0, 1.3, 1.5];
function zonGewicht(ms) {
  const { uur, maand } = lokaal(ms);
  const zomertijd = maand >= 3 && maand <= 9 ? 1 : 0; // benadering; maart/oktober grof
  const middag = 12.67 + zomertijd, half = DAGLENGTE[maand] / 2;
  const x = (uur - (middag - half)) / (2 * half);
  return x <= 0 || x >= 1 ? 0 : Math.sin(Math.PI * x) * ZONKRACHT[maand];
}
function verbruikGewicht(ms) {
  const { uur, maand } = lokaal(ms);
  let h = 0.45;
  if (uur >= 7 && uur < 9) h = 0.8; else if (uur >= 17 && uur < 22) h = 1.0; else if (uur >= 9 && uur < 17) h = 0.55;
  return h * WARMTE[maand];
}
const isNacht = (ms) => lokaal(ms).uur < 6;

function gemiddelden(reeks) { // reeks: [{t: ms, p: €/kWh excl. btw}]
  let n = 0, s = 0, zw = 0, zs = 0, vw = 0, vs = 0, nn = 0, ns = 0;
  for (const { t, p } of reeks) {
    if (p == null || Number.isNaN(p)) continue;
    n++; s += p;
    const z = zonGewicht(t); zw += z; zs += z * p;
    const v = verbruikGewicht(t); vw += v; vs += v * p;
    if (isNacht(t)) { nn++; ns += p; }
  }
  if (!n) return null;
  const r = (x) => Math.round(x * 100000) / 100000;
  return { basis: r(s / n), zon: r(zs / zw), verbruik: r(vs / vw), nacht: r(ns / nn), punten: n };
}

// ---------- bronnen
const maanden = (van, tot, stap = 1) => { const out = []; let d = new Date(Date.UTC(van.getUTCFullYear(), van.getUTCMonth(), 1)); while (d < tot) { const e = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + stap, 1)); out.push([d, e < tot ? e : tot]); d = e; } return out; };
let stroomLicentie = null;

async function stroomEnergyCharts(van, tot) {
  const reeks = [];
  for (const [a, b] of maanden(van, tot, 3)) { // per kwartaal: weinig verzoeken
    const j = await getJson(`https://api.energy-charts.info/price?bzn=NL&start=${iso(a)}&end=${iso(new Date(b - 86400000))}`, 4);
    stroomLicentie = j.license_info || stroomLicentie;
    (j.unix_seconds || []).forEach((s, i) => { if (s * 1000 >= a && s * 1000 < b) reeks.push({ t: s * 1000, p: j.price[i] == null ? null : j.price[i] / 1000 }); });
    await wacht(+(process.env.EC_WACHT ?? 3000));
  }
  return reeks;
}
async function energyZero(van, tot, usageType) {
  const reeks = [];
  for (const [a, b] of maanden(van, tot)) {
    const j = await getJson(`https://api.energyzero.nl/v1/energyprices?fromDate=${a.toISOString()}&tillDate=${new Date(b - 1).toISOString()}&interval=4&usageType=${usageType}&inclBtw=false`);
    for (const x of j.Prices || []) reeks.push({ t: Date.parse(x.readingDate), p: x.price });
    await wacht(400);
  }
  return reeks;
}
async function stroomReeks(van, tot) {
  try { return { reeks: await stroomEnergyCharts(van, tot), bron: 'energycharts' }; }
  catch (e) { fouten.push('Energy-Charts: ' + e.message); }
  try { return { reeks: await energyZero(van, tot, 1), bron: 'energyzero' }; }
  catch (e) { fouten.push('EnergyZero stroom: ' + e.message); }
  return { reeks: [], bron: null };
}

// ---------- hoofdprogramma
const oud = (() => { try { return JSON.parse(fs.readFileSync(UIT)); } catch { return {}; } })();
const jaar12 = new Date(nu); jaar12.setUTCFullYear(jaar12.getUTCFullYear() - 1);
const morgenEind = new Date(Date.UTC(nu.getUTCFullYear(), nu.getUTCMonth(), nu.getUTCDate() + 2));

const uit = { bijgewerkt: nu.toISOString(), bronnen: [], fouten, stroom: { jaren: { ...(oud.stroom?.jaren || {}) } }, gas: { jaren: { ...(oud.gas?.jaren || {}) } } };
const gebruikteBronnen = new Set();

// Stroom: laatste 12 maanden + komende dag(en)
const s12 = await stroomReeks(jaar12, morgenEind);
if (s12.bron) gebruikteBronnen.add(s12.bron);
const verleden = s12.reeks.filter((x) => x.t <= nu.getTime());
const g12 = gemiddelden(verleden);
if (g12) uit.stroom.gem12m = g12;
uit.stroom.komend = s12.reeks.filter((x) => x.t >= nu.getTime() - 3600e3).slice(0, 48 * 4).map((x) => ({ t: new Date(x.t).toISOString(), p: x.p }));

// Referentiejaren (alleen ophalen als ze nog ontbreken) — nodig om jouw jaarafrekening te schalen
for (let j = nu.getUTCFullYear() - 2; j < nu.getUTCFullYear(); j++) {
  if (uit.stroom.jaren[j]) continue;
  const r = await stroomReeks(new Date(Date.UTC(j, 0, 1)), new Date(Date.UTC(j + 1, 0, 1)));
  if (r.bron) gebruikteBronnen.add(r.bron);
  const g = gemiddelden(r.reeks);
  if (g) uit.stroom.jaren[j] = g;
}

// Gas (dagprijs)
try {
  const gr = await energyZero(jaar12, morgenEind, 3);
  const gv = gr.filter((x) => x.t <= nu.getTime() && x.p != null);
  if (gv.length) { uit.gas.gem12m = Math.round(gv.reduce((a, x) => a + x.p, 0) / gv.length * 100000) / 100000; uit.gas.vandaag = gv[gv.length - 1].p; gebruikteBronnen.add('energyzero'); }
  for (let j = nu.getUTCFullYear() - 2; j < nu.getUTCFullYear(); j++) {
    if (uit.gas.jaren[j]) continue;
    const r = (await energyZero(new Date(Date.UTC(j, 0, 1)), new Date(Date.UTC(j + 1, 0, 1)), 3)).filter((x) => x.p != null);
    if (r.length) uit.gas.jaren[j] = { gem: Math.round(r.reduce((a, x) => a + x.p, 0) / r.length * 100000) / 100000 };
  }
} catch (e) { fouten.push('EnergyZero gas: ' + e.message); }

if (gebruikteBronnen.has('energycharts')) uit.bronnen.push({ naam: 'Energy-Charts (Fraunhofer ISE), day-ahead NL', url: 'https://www.energy-charts.info', licentie: stroomLicentie || 'zie energy-charts.info' });
if (gebruikteBronnen.has('energyzero')) uit.bronnen.push({ naam: 'EnergyZero (prijsbron van o.a. ANWB Energie)', url: 'https://www.energyzero.nl', licentie: 'Openbare API zonder gepubliceerde voorwaarden; spaarzaam gebruikt (1x per dag).' });

if (!uit.stroom.gem12m && oud.stroom?.gem12m) { // niets nieuws: oude data houden, maar eerlijk melden
  uit.stroom = oud.stroom; uit.gas = oud.gas || uit.gas; uit.bijgewerkt = oud.bijgewerkt; uit.bronnen = oud.bronnen || [];
  fouten.push('Geen nieuwe prijzen ontvangen; de vorige gegevens zijn behouden.');
}
fs.writeFileSync(UIT, JSON.stringify(uit, null, 1));
console.log(`prijzen.json geschreven. Bronnen: ${[...gebruikteBronnen].join(', ') || 'geen'}. Fouten: ${fouten.length}`);
for (const f of fouten) console.log(' - ' + f);
if (!uit.stroom.gem12m) process.exitCode = 1;
