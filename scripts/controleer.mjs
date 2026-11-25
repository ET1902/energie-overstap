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

// Geheimen worden vaak met een spatie of regeleinde geplakt: die halen we weg.
const onderwerp = (process.env.NTFY_TOPIC || '').trim();
const email = (process.env.MELDING_EMAIL || '').trim();
const profielTekst = (process.env.PROFIEL_JSON || '').trim();
const test = process.env.TESTMELDING === 'true';
// Diagnose zonder geheimen te tonen:
console.log(`Instellingen: NTFY_TOPIC ${onderwerp ? `ingesteld (${onderwerp.length} tekens${onderwerp.startsWith('energie-') ? ', gemaakt in de app' : ''})` : 'ONTBREEKT'}; PROFIEL_JSON ${profielTekst ? 'ingesteld' : 'ONTBREEKT'}; MELDING_EMAIL ${email ? 'ingesteld' : 'niet ingesteld'}; testmelding ${test ? 'ja' : 'nee'}.`);

async function stuur(m) {
  if (!onderwerp) return false;
  // Parameters via de URL (ntfy ondersteunt dat), zodat tekens als € geen probleem geven in HTTP-headers.
  const q = new URLSearchParams({ title: m.titel, priority: String(m.prioriteit), tags: m.tags });
  if (process.env.APP_URL) q.set('click', process.env.APP_URL + (m.pad || ''));
  if (email) q.set('email', email);
  try {
    const r = await fetch(`https://ntfy.sh/${encodeURIComponent(onderwerp)}?${q}`, { method: 'POST', body: m.tekst });
    if (!r.ok) console.log(`ntfy gaf HTTP ${r.status}. Controleer het geheim NTFY_TOPIC.`);
    return r.ok;
  } catch (e) { console.log('ntfy niet bereikbaar: ' + e.message); return false; }
}

if (!profielTekst) {
  if (test) console.log(`Testmelding zonder profiel: ${(await stuur({ titel: 'Testmelding energie-app', tekst: 'De verbinding met je telefoon werkt. Zet nog het geheim PROFIEL_JSON in GitHub voor de persoonlijke check.', prioriteit: 3, tags: 'white_check_mark' })) ? 'verstuurd' : 'NIET verstuurd'}.`);
  console.log('Geen PROFIEL_JSON ingesteld; persoonlijke check overgeslagen.'); process.exit(0);
}
let invoer;
try { invoer = JSON.parse(profielTekst); } catch { console.log('PROFIEL_JSON is geen geldige JSON. Kopieer hem opnieuw uit de app (Meldingen → Kopieer gegevens voor GitHub).'); if (test) await stuur({ titel: 'Testmelding energie-app', tekst: 'Je telefoon is bereikbaar, maar PROFIEL_JSON in GitHub is ongeldig. Kopieer hem opnieuw uit de app.', prioriteit: 3, tags: 'warning' }); process.exit(1); }

const tarieven = lees('../data/tarieven.json');
const prijzen = (() => { try { return lees('../data/prijzen.json'); } catch { return null; } })();
const basisAanbod = lees('../data/aanbiedingen.json').aanbiedingen;
const verborgen = new Set(invoer.verborgen || []);
const aanbiedingen = [...basisAanbod.filter((a) => !verborgen.has(a.id)), ...(invoer.eigenAanbiedingen || [])];
const instellingen = { ...STANDAARD_INSTELLINGEN, ...(invoer.instellingen || {}) };
if (instellingen.meldingen === false && !test) { console.log('Meldingen staan uit in je profiel.'); process.exit(0); }

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
if (test) {
  berichten.push({ titel: 'Testmelding energie-app', tekst: `De meldingen werken.\nHuidig advies: ${res.advies.tekst}`, prioriteit: 3, tags: 'white_check_mark' });
}
if (!berichten.length) console.log(`Geen melding nodig (advies: ${res.advies.soort}; drempel wordt niet gehaald of er is niets nieuws).`);

let verstuurd = 0;
for (const m of berichten) if (await stuur(m)) verstuurd++;
fs.mkdirSync('.staat', { recursive: true });
fs.writeFileSync(STAAT, JSON.stringify(staat));
console.log(`Check uitgevoerd op ${vandaag}. Nieuwe meldingen: ${berichten.length}, verstuurd: ${verstuurd}${onderwerp ? '' : ' (geen NTFY_TOPIC ingesteld)'}.`);

function dagenSinds(d) { return (new Date(vandaag) - new Date(d)) / 86400000; }
