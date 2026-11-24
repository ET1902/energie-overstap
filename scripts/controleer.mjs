// Dagelijkse persoonlijke check in GitHub Actions.
// Leest jouw profiel uit het GitHub-geheim PROFIEL_JSON (nooit uit de repository), rekent de vergelijking door
// en stuurt alleen bij iets nieuws een melding via ntfy.sh (push naar je iPhone, optioneel doorgestuurd per e-mail).
// Let op: de logboeken van een openbare repository zijn openbaar. Dit script logt daarom GEEN bedragen of verbruik.
import fs from 'node:fs';
import { analyse, waarschuwingen } from '../calc.js';
import { STANDAARD_INSTELLINGEN } from '../standaard.js';

const lees = (p) => JSON.parse(fs.readFileSync(new URL(p, import.meta.url)));
const STAAT = '.staat/laatste.json';
const vandaag = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Amsterdam' });

if (!process.env.PROFIEL_JSON) { console.log('Geen PROFIEL_JSON ingesteld; persoonlijke check overgeslagen.'); process.exit(0); }
let invoer;
try { invoer = JSON.parse(process.env.PROFIEL_JSON); } catch { console.log('PROFIEL_JSON is geen geldige JSON. Kopieer hem opnieuw uit de app.'); process.exit(1); }

const tarieven = lees('../data/tarieven.json');
const prijzen = (() => { try { return lees('../data/prijzen.json'); } catch { return null; } })();
const basisAanbod = lees('../data/aanbiedingen.json').aanbiedingen;
const verborgen = new Set(invoer.verborgen || []);
const aanbiedingen = [...basisAanbod.filter((a) => !verborgen.has(a.id)), ...(invoer.eigenAanbiedingen || [])];
const instellingen = { ...STANDAARD_INSTELLINGEN, ...(invoer.instellingen || {}) };
if (instellingen.meldingen === false) { console.log('Meldingen staan uit in je profiel.'); process.exit(0); }

const res = analyse({ profiel: invoer.profiel, huidig: invoer.huidig, aanbiedingen, prijzen, tarieven, instellingen, vandaagISO: vandaag });
if (res.fout) { console.log('Profiel onvolledig: ' + res.fout); process.exit(1); }
const w = waarschuwingen({ huidig: invoer.huidig, aanbiedingen, prijzen, instellingen, vandaagISO: vandaag, analyseResultaat: res });

const staat = (() => { try { return JSON.parse(fs.readFileSync(STAAT)); } catch { return { gemeld: {} }; } })();
const berichten = [];

// 1. Betere overstapmogelijkheid: alleen melden als het nieuw is of de besparing duidelijk is gestegen.
if (res.advies.soort === 'overstappen') {
  const b = res.beste, sleutel = 'kans:' + b.contract.id;
  const vorige = staat.gemeld[sleutel];
  if (!vorige || b.besparing - vorige.besparing >= 25 || dagenSinds(vorige.datum) >= 30) {
    berichten.push({ titel: `Overstappen kan ~€${Math.round(b.besparing)} besparen`, tekst: `${res.advies.tekst}\nZekerheid: ${b.zekerheid.niveau}. ${res.advies.wanneer || ''}\nOpen de app voor de berekening.`, prioriteit: 4, tags: 'zap' });
    staat.gemeld[sleutel] = { besparing: b.besparing, datum: vandaag };
  }
}
// 2. Contract loopt af / aanbieding verloopt: één keer per waarschuwing.
for (const x of w.filter((x) => x.soort === 'contract' || x.soort === 'aanbod')) {
  const sleutel = 'w:' + x.tekst.replace(/\d+ dagen/, '');
  if (staat.gemeld[sleutel]) continue;
  berichten.push({ titel: x.soort === 'contract' ? 'Contract loopt af' : 'Aanbieding verloopt', tekst: x.tekst, prioriteit: x.ernst === 'hoog' ? 4 : 3, tags: 'calendar' });
  staat.gemeld[sleutel] = { datum: vandaag };
}
// 3. Wekelijks overzicht (maandag), als je dat wilt.
if (instellingen.weekoverzicht && new Date().getUTCDay() === 1) {
  berichten.push({ titel: 'Weekoverzicht energie', tekst: `${res.advies.tekst}\nHuidig contract komende 12 mnd: ~€${Math.round(res.basis.totaal)}.`, prioriteit: 2, tags: 'bar_chart' });
}

// 4. Maandelijkse herinnering om de stand uit de ANWB-app bij te werken (op de 1e).
const dagVanMaand = Number(vandaag.slice(8, 10));
if (instellingen.standHerinnering !== false && dagVanMaand === 1 && !staat.gemeld['stand:' + vandaag.slice(0, 7)]) {
  berichten.push({ titel: 'Tijd om je stand bij te werken', tekst: 'Neem de kosten en het verbruik van dit jaar over uit de ANWB-app. Tik hier om de app te openen. Daarna: Meldingen → Kopieer gegevens voor GitHub.', prioriteit: 3, tags: 'memo', pad: '#stand' });
  staat.gemeld['stand:' + vandaag.slice(0, 7)] = { datum: vandaag };
}
// 5. Testmelding op verzoek (Run workflow → 'Stuur een testmelding')
if (process.env.TESTMELDING === 'true') {
  berichten.push({ titel: 'Testmelding energie-app', tekst: `De meldingen werken.\nHuidig advies: ${res.advies.tekst}`, prioriteit: 3, tags: 'white_check_mark' });
}
if (!berichten.length) console.log(`Geen melding nodig (advies: ${res.advies.soort}; drempel wordt niet gehaald of er is niets nieuws).`);

const onderwerp = process.env.NTFY_TOPIC;
let verstuurd = 0;
for (const m of berichten) {
  if (!onderwerp) break;
  // Parameters via de URL (ntfy ondersteunt dat), zodat tekens als € geen probleem geven in HTTP-headers.
  const q = new URLSearchParams({ title: m.titel, priority: String(m.prioriteit), tags: m.tags });
  if (process.env.APP_URL) q.set('click', process.env.APP_URL + (m.pad || ''));
  if (process.env.MELDING_EMAIL) q.set('email', process.env.MELDING_EMAIL);
  const r = await fetch(`https://ntfy.sh/${encodeURIComponent(onderwerp)}?${q}`, { method: 'POST', body: m.tekst });
  if (r.ok) verstuurd++; else console.log(`ntfy gaf HTTP ${r.status}: controleer het geheim NTFY_TOPIC.`);
}
fs.mkdirSync('.staat', { recursive: true });
fs.writeFileSync(STAAT, JSON.stringify(staat));
console.log(`Check uitgevoerd op ${vandaag}. Nieuwe meldingen: ${berichten.length}, verstuurd: ${verstuurd}${onderwerp ? '' : ' (geen NTFY_TOPIC ingesteld)'}.`);

function dagenSinds(d) { return (new Date(vandaag) - new Date(d)) / 86400000; }
