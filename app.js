import { analyse, waarschuwingen, zekerheid, jaarSchatting } from './calc.js';
import { LEEG_PROFIEL, ANWB_DYNAMISCH, STANDAARD_INSTELLINGEN } from './standaard.js';

{
const SLEUTEL = 'energie-overstap:v1';
const $ = (s, el = document) => el.querySelector(s);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const euro = (x, d = 0) => (x < 0 ? '−' : '') + '€ ' + Math.abs(x).toLocaleString('nl-NL', { minimumFractionDigits: d, maximumFractionDigits: d });
const plusmin = (x) => (x >= 0 ? '+' : '−') + '€ ' + Math.round(Math.abs(x)).toLocaleString('nl-NL');
const getal = (x, d = 0) => Number(x).toLocaleString('nl-NL', { minimumFractionDigits: d, maximumFractionDigits: d });
const vandaag = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Amsterdam' });
const datumNL = (iso, tijd) => iso ? new Date(iso.length > 10 ? iso : iso + 'T12:00:00').toLocaleString('nl-NL', { day: 'numeric', month: 'short', year: 'numeric', ...(tijd && iso.length > 10 ? { hour: '2-digit', minute: '2-digit' } : {}) }) : 'onbekend';
const kloon = (x) => JSON.parse(JSON.stringify(x));

// ---------- uitleg bij vaktermen
const UITLEG = {
  dynamisch: ['Dynamisch contract', 'Je betaalt per kwartier of uur de beursprijs van dat moment, plus een kleine opslag van de leverancier. ’s Nachts en bij veel zon is stroom vaak goedkoop. Bij ANWB kun je elke dag zonder kosten opzeggen.'],
  opslag: ['Opslag (inkoopvergoeding)', 'Het bedrag dat de leverancier per kWh of m³ bovenop de beursprijs rekent. Samen met de vaste kosten is dit het enige waarin dynamische leveranciers van elkaar verschillen.'],
  saldering: ['Salderen', 'Tot en met 2026 mag je teruggeleverde stroom wegstrepen tegen je verbruik, inclusief energiebelasting. Vanaf 1 januari 2027 stopt dat: je krijgt dan alleen nog de terugleververgoeding, bij dynamisch de beursprijs van dat moment.'],
  teruglevering: ['Teruglevering', 'Stroom van je zonnepanelen die je niet zelf gebruikt en die naar het net gaat. Vanaf 2027 verschilt per leverancier wat je daarvoor krijgt (vergoeding, bonus) of moet betalen (terugleverkosten).'],
  ijken: ['IJken', 'De app vergelijkt zijn berekening met wat je leverancier zegt dat je dit jaar tot nu toe hebt betaald. Zo rekent hij met jouw werkelijke prijsniveau in plaats van met een landelijk gemiddelde.'],
  zekerheid: ['Zekerheid', 'Hoog: tarieven komen van de leverancier zelf en zijn recent. Middel of laag: tarieven komen van een vergelijkingssite, zijn ouder of nog niet bekend voor 2027. Controleer die altijd voordat je overstapt.'],
  vast: ['Vaste leveringskosten', 'Een vast bedrag per maand per aansluiting (stroom en gas apart) dat de leverancier rekent, ongeacht je verbruik.'],
  overheid: ['Belasting en netbeheer', 'Energiebelasting, de vermindering daarop en de kosten van netbeheerder Enexis. Die zijn bij elke leverancier gelijk.'],
  beurs: ['Beursprijs', 'De groothandelsprijs van stroom (per kwartier of uur) en gas (per dag) op de Europese energiebeurs. De app haalt die elke ochtend op.'],
  laden: ['Laden ’s nachts', 'Bij een dynamisch contract rekent de app het laden van je auto tegen de gemiddelde nachtprijs (0–6 uur), bij een vast contract tegen het daltarief. De vergoeding van je werkgever is bij elk contract gelijk.'],
  drempel: ['Melddrempel', 'Je krijgt pas een melding als overstappen in de komende 12 maanden naar schatting minstens dit bedrag oplevert.'],
  ntfy: ['ntfy', 'Een gratis app voor pushmeldingen. De dagelijkse taak op GitHub stuurt een bericht naar jouw geheime onderwerp; de ntfy-app op je iPhone laat het zien.'],
};
const i = (term) => `<button type="button" class="i" data-uitleg="${term}" aria-label="Uitleg: ${esc(UITLEG[term][0])}">i</button>`;

// ---------- opslag (alleen op dit toestel)
function nieuweStaat() {
  return { profiel: kloon(LEEG_PROFIEL), huidig: kloon(ANWB_DYNAMISCH), instellingen: { ...STANDAARD_INSTELLINGEN }, eigenAanbiedingen: [], verborgen: [], historie: [] };
}
function laadStaat() {
  try {
    const s = JSON.parse(localStorage.getItem(SLEUTEL));
    if (s && s.profiel) {
      const st = { ...nieuweStaat(), ...s, instellingen: { ...STANDAARD_INSTELLINGEN, ...s.instellingen } };
      if (st.huidig?.naam) st.huidig.naam = st.huidig.naam.replace(/\s*\(huidig\)$/, '');
      return st;
    }
  } catch {}
  return nieuweStaat();
}
let staat = laadStaat();
function bewaar(stil) {
  try { localStorage.setItem(SLEUTEL, JSON.stringify(staat)); if (!stil) toast('Opgeslagen'); }
  catch { toast('Opslaan lukt niet in deze browser. Maak een back-up.'); }
}

// ---------- gegevens van de server (openbaar, geen persoonsgegevens)
const data = { tarieven: null, basisAanbod: [], prijzen: null, geladen: null, fout: null };
async function laadData(handmatig) {
  const haal = async (p) => { const r = await fetch(p, { cache: 'no-store' }); if (!r.ok) throw new Error(p + ': HTTP ' + r.status); return r.json(); };
  try {
    const [t, a, p] = await Promise.all([haal('data/tarieven.json'), haal('data/aanbiedingen.json'), haal('data/prijzen.json').catch(() => null)]);
    data.tarieven = t; data.basisAanbod = a.aanbiedingen || []; data.prijzen = p && p.bijgewerkt ? p : null; data.prijsFouten = p?.fouten || [];
    data.geladen = new Date().toISOString(); data.fout = null;
    if (standBijStart && profielCompleet()) { standBijStart = false; try { history.replaceState(null, '', '#overzicht'); } catch {} setTimeout(openStand, 300); }
    if (handmatig) toast(data.prijzen ? 'Bijgewerkt: beursprijzen van ' + datumNL(data.prijzen.bijgewerkt, true) : 'Bijgewerkt. Nog geen beursprijzen beschikbaar.');
  } catch (e) {
    data.fout = 'Nieuwe gegevens laden lukte niet (' + e.message + '). Je ziet de laatst bewaarde versie.';
    if (handmatig) toast('Bijwerken mislukt. Geen verbinding?');
  }
  render();
}

const aanbiedingen = () => [...data.basisAanbod.map((a) => ({ ...a, verborgen: staat.verborgen.includes(a.id) })), ...staat.eigenAanbiedingen];
const profielCompleet = () => staat.profiel.stroomAfname > 0;
function bereken() {
  if (!data.tarieven || !profielCompleet()) return null;
  try {
    const A = analyse({ profiel: staat.profiel, huidig: staat.huidig, aanbiedingen: aanbiedingen(), prijzen: data.prijzen, tarieven: data.tarieven, instellingen: staat.instellingen, vandaagISO: vandaag() });
    if (!A.fout) bewaarHistorie(A);
    return A;
  } catch (e) { console.error(e); return { fout: 'Rekenfout: ' + e.message }; }
}
function bewaarHistorie(A) {
  const d = vandaag(), h = staat.historie || (staat.historie = []);
  const punt = { d, besparing: Math.round(A.beste?.besparing ?? 0), naam: A.beste?.contract.naam || '', huidig: Math.round(A.basis.totaal) };
  const laatste = h[h.length - 1];
  if (laatste && laatste.d === d) { if (laatste.besparing === punt.besparing && laatste.huidig === punt.huidig) return; h[h.length - 1] = punt; }
  else h.push(punt);
  if (h.length > 400) h.splice(0, h.length - 400);
  bewaar(true);
}

// ---------- weergave
let laatste = null, openOptie = null;
function render() {
  laatste = bereken();
  $('#netStip').classList.toggle('uit', !navigator.onLine);
  $('#statusTekst').textContent = navigator.onLine ? (data.prijzen ? 'Prijzen van ' + datumNL(data.prijzen.bijgewerkt) : 'Online') : 'Offline';
  renderOverzicht(); renderVergelijken(); renderGegevens(); renderAanbod(); renderMeer();
}

function redenTekst(r, n = 2) {
  return r.verschil.slice(0, n).map((v) => `${v.label.toLowerCase()} ${plusmin(v.bedrag)}`).join(' · ');
}

function renderOverzicht() {
  const el = $('#overzicht');
  if (!data.tarieven && data.fout) { el.innerHTML = `<div class="kaart"><h2>Geen gegevens</h2><p>${esc(data.fout)}</p><button class="knop" id="opnieuw">Opnieuw proberen</button></div>`; $('#opnieuw').onclick = () => laadData(true); return; }
  if (!data.tarieven) { el.innerHTML = '<p class="klein">Laden…</p>'; return; }
  if (!profielCompleet()) {
    el.innerHTML = `<h2>Welkom</h2><div class="kaart"><p>Deze app rekent uit of overstappen naar een andere energieleverancier loont. Begin met je eigen gegevens. Die blijven op dit toestel.</p>
      <div class="knoppen"><label class="knop accent" for="snelImport">Profielbestand openen</label><input type="file" id="snelImport" accept=".json,application/json" hidden>
      <button class="knop licht" data-ga="gegevens">Zelf invullen</button></div></div>`;
    $('#snelImport').onchange = (e) => importeerBestand(e.target.files[0]);
    el.querySelector('[data-ga]').onclick = () => { ga('gegevens'); const d = $('#blok-verbruik'); if (d) d.open = true; };
    return;
  }
  const A = laatste;
  if (!A || A.fout) { el.innerHTML = `<div class="kaart"><h2>Even aanvullen</h2><p>${esc(A?.fout || 'Berekenen lukt niet.')}</p><button class="knop" data-ga="gegevens">Naar Gegevens</button></div>`; el.querySelector('[data-ga]').onclick = () => ga('gegevens'); return; }
  const b = A.beste, adv = A.advies;
  const label = { overstappen: 'Overstappen loont', twijfel: 'Kleine winst mogelijk', blijven: 'Blijf bij je huidige contract', geen: 'Nog niets te vergelijken' }[adv.soort];
  const w = waarschuwingen({ huidig: staat.huidig, aanbiedingen: aanbiedingen(), prijzen: data.prijzen, instellingen: staat.instellingen, vandaagISO: vandaag(), analyseResultaat: A }).filter((x) => x.soort !== 'kans');
  const top = A.rijen.slice(0, 3);
  const nu = prijsNu();
  el.innerHTML = `
  <div class="raster twee">
   <div>
    <div class="kaart oordeel ${adv.soort}">
      <div class="label">${esc(label)}</div>
      <div class="groot">${b && b.besparing > 0 ? euro(b.besparing) : euro(0)}<small> per jaar</small></div>
      <p>${esc(adv.tekst)}</p>
      ${b ? `<p class="regel">Zekerheid <span class="badge b-${b.zekerheid.niveau}">${b.zekerheid.niveau}</span> ${i('zekerheid')}</p>` : ''}
      ${adv.noot ? `<p class="klein">${esc(adv.noot)}</p>` : ''}
      ${adv.wanneer ? `<p class="klein">${esc(adv.wanneer)}</p>` : ''}
    </div>
    <div class="kaart"><h3>Beste opties ${i('zekerheid')}</h3>
      <p class="klein">Vergeleken met je huidige contract (${esc(staat.huidig.naam)}, ${euro(A.basis.totaal)} netto in de komende 12 maanden).</p>
      ${top.map((r) => `<button class="rij" data-open="${esc(r.contract.id)}"><span><b>${esc(r.contract.naam)}</b> <span class="badge b-${r.zekerheid.niveau}">${r.zekerheid.niveau}</span><span class="uitleg">${esc(redenTekst(r)) || 'vrijwel gelijk'}</span></span><span class="bedrag ${r.besparing >= 0 ? 'pos' : 'neg'}">${plusmin(r.besparing)}</span></button>`).join('') || '<p>Nog geen aanbiedingen.</p>'}
      <div class="knoppen"><button class="knop licht" data-ga="vergelijken">Alle opties en berekening</button></div>
    </div>
    ${verloopKaart()}
   </div>
   <div>
    ${standKaart()}
    ${w.length ? `<div class="kaart"><h3>Aandachtspunten</h3><ul class="melding">${w.map((x) => `<li class="${esc(x.ernst)}">${esc(x.tekst)}</li>`).join('')}</ul></div>` : ''}
    <div class="kaart"><h3>Beursprijs ${i('beurs')}</h3>
      ${nu ? `<p>Nu <b>${euro(nu.p * 1.21, 3)}</b> per kWh <span class="klein">(incl. btw, zonder opslag en belasting)</span></p><div class="fig" id="koers"></div>` : '<p class="klein">Geen actuele uurprijzen beschikbaar.</p>'}
      <p class="klein">Bijgewerkt: ${data.prijzen ? datumNL(data.prijzen.bijgewerkt, true) + ' · ' + (data.prijzen.bronnen || []).map((x) => esc(x.naam.split(',')[0].split(' (')[0])).join(' + ') : 'nog niet'}</p>
      ${data.fout ? `<p class="klein" style="color:var(--fout)">${esc(data.fout)}</p>` : ''}
      <div class="knoppen"><button class="knop" id="vernieuw">Vernieuwen</button>${repoUrl() ? `<a class="knop licht" href="${esc(repoUrl())}/actions/workflows/dagelijks.yml" target="_blank" rel="noopener">Nu ophalen op GitHub</a>` : ''}</div>
      <details><summary>Hoe is er gerekend?</summary>
        <p class="klein">${esc(A.markt.methode)}</p>
        <p class="klein">Periode: 12 maanden vanaf ${datumNL(A.start)} (aangenomen ingangsdatum bij overstap). Vanaf 1 januari 2027 zonder saldering ${i('saldering')}.</p>
        <p class="klein">‘Vernieuwen’ laadt wat de dagelijkse taak heeft opgehaald. Wil je het nú laten ophalen: ‘Nu ophalen op GitHub’ → ‘Run workflow’, en na ±2 minuten vernieuwen.</p>
      </details>
    </div>
   </div>
  </div>`;
  $('#vernieuw').onclick = () => laadData(true);
  el.querySelectorAll('[data-stand]').forEach((k) => (k.onclick = openStand));
  el.querySelectorAll('[data-ga]').forEach((k) => (k.onclick = () => ga(k.dataset.ga)));
  el.querySelectorAll('[data-open]').forEach((k) => (k.onclick = () => { openOptie = k.dataset.open; renderVergelijken(); ga('vergelijken'); $('#vergelijken .optie.open')?.scrollIntoView({ block: 'start' }); }));
  if (nu) tekenKoers($('#koers'));
  if ($('#verloop')) tekenVerloop($('#verloop'));
}

function standDagen() {
  const d = staat.profiel.ijking?.datum; if (!d) return null;
  return Math.round((Date.parse(vandaag()) - Date.parse(d)) / 86400000);
}
function standKaart() {
  const ij = staat.profiel.ijking || {}, dg = standDagen(), oud = dg == null || dg > 35;
  return `<div class="kaart stand ${oud ? 'oud' : ''}"><div class="regel" style="justify-content:space-between"><span><b>Stand uit de ANWB-app</b> ${i('ijken')}<span class="uitleg">${dg == null ? 'Nog niet ingevuld' : `Laatst bijgewerkt ${dg === 0 ? 'vandaag' : dg === 1 ? 'gisteren' : dg + ' dagen geleden'} (${datumNL(ij.datum)}, ${euro(ij.kosten || 0)})`}${oud ? ' · tijd om bij te werken' : ''}</span></span>
    <button class="knop ${oud ? 'accent' : 'licht'}" data-stand>Stand bijwerken</button></div></div>`;
}

// ---------- venster: stand bijwerken
let standConcept = null;
function openStand() {
  const ij = staat.profiel.ijking || {};
  standConcept = { datum: vandaag(), kosten: null, stroomAfname: null, teruglevering: null, gas: null, jaarOok: true };
  const v = $('#standVenster');
  v.querySelector('.blad').innerHTML = `<h3>Stand bijwerken</h3>
    <p class="klein">Open de ANWB-app en neem de cijfers van <b>dit jaar tot nu toe</b> over (sinds 1 januari). Grijze getallen zijn je vorige stand${ij.datum ? ' van ' + datumNL(ij.datum) : ''}.</p>
    <form id="standForm" onsubmit="return false"><div class="velden">
      ${sveld('datum', 'Stand op datum', 'datum')}
      ${sveld('kosten', 'Kosten tot nu toe', 'getal', { voor: '€', ph: ij.kosten })}
      ${sveld('stroomAfname', 'Stroom van het net', 'getal', { na: 'kWh', ph: ij.stroomAfname })}
      ${sveld('teruglevering', 'Teruglevering', 'getal', { na: 'kWh', ph: ij.teruglevering })}
      ${staat.profiel.gas > 0 ? sveld('gas', 'Gas', 'getal', { na: 'm³', ph: ij.gas }) : ''}
    </div><div id="standVoorbeeld" class="klein"></div>
    <div class="knoppen"><button class="knop accent" id="standOpslaan" type="button">Opslaan</button><button class="knop licht" id="standAnnuleer" type="button">Annuleren</button></div></form>`;
  v.hidden = false;
  koppelVelden($('#standForm'), standConcept, standVoorbeeld);
  v.querySelectorAll('input[data-soort=getal]').forEach((x) => (x.oninput = () => { const w = leesGetal(x.value, x.dataset.groot === '1'); if (!Number.isNaN(w)) { zetPad(standConcept, x.dataset.pad, w); standVoorbeeld(); } }));
  $('#standAnnuleer').onclick = () => (v.hidden = true);
  $('#standOpslaan').onclick = bewaarStand;
  standVoorbeeld();
  setTimeout(() => $('#s-kosten')?.focus(), 50);
}
function sveld(pad, label, soort, extra = {}) {
  const id = 's-' + pad, w = standConcept[pad];
  return `<div class="veld"><label for="${id}">${esc(label)}</label><div class="invoer">${extra.voor ? `<span>${esc(extra.voor)}</span>` : ''}<input id="${id}" type="${soort === 'datum' ? 'date' : 'text'}" ${soort === 'getal' ? 'inputmode="decimal" autocomplete="off"' : ''} data-pad="${pad}" data-soort="${soort}" data-groot="${isGroot(extra) ? 1 : 0}" value="${esc(soort === 'getal' ? toonGetal(w) : w ?? '')}" ${extra.ph != null ? `placeholder="${esc(getal(extra.ph))}"` : ''}>${extra.na ? `<span>${esc(extra.na)}</span>` : ''}</div></div>`;
}
function standCompleet() { const c = standConcept; return c.datum && c.kosten > 0 && c.stroomAfname > 0 && c.teruglevering != null && (staat.profiel.gas > 0 ? c.gas != null : true); }
function standVoorbeeld() {
  const el = $('#standVoorbeeld'); if (!el) return;
  if (!standCompleet()) { el.innerHTML = '<p>Vul alle velden in om je verwachte jaarverbruik te zien.</p>'; return; }
  const p = staat.profiel, js = jaarSchatting(standConcept, p);
  const rij = (l, oud, nieuw, e) => `<tr><td>${l}</td><td class="bedrag">${getal(oud || 0)} ${e}</td><td class="bedrag"><b>${getal(nieuw)} ${e}</b></td></tr>`;
  el.innerHTML = `<p><b>Verwacht jaarverbruik</b> (met een seizoenspatroon doorgetrokken naar 31 december):</p>
    <table><thead><tr><th></th><th class="bedrag">nu</th><th class="bedrag">nieuw</th></tr></thead><tbody>
    ${rij('Stroom van het net', p.stroomAfname, js.stroomAfname, 'kWh')}${rij('Teruglevering', p.teruglevering, js.teruglevering, 'kWh')}${p.gas > 0 ? rij('Gas', p.gas, js.gas, 'm³') : ''}</tbody></table>
    <p>Laden van de auto tot nu toe geschat op ${getal(js.laadTotNu)} kWh (${getal(p.laadKwh || 0)} kWh per jaar, gelijkmatig verdeeld).</p>
    <div class="schakel"><input type="checkbox" id="s-jaarOok" ${js.betrouwbaar && standConcept.jaarOok ? 'checked' : ''}><label for="s-jaarOok">Jaarverbruik hiermee bijwerken</label></div>
    ${js.betrouwbaar ? '' : '<p>Het is nog vroeg in het jaar: deze schatting is grof. Advies: laat je huidige jaarverbruik staan.</p>'}`;
  standConcept.jaarOok = js.betrouwbaar && standConcept.jaarOok;
  $('#s-jaarOok').onchange = (e) => (standConcept.jaarOok = e.target.checked);
}
function bewaarStand() {
  $('#standForm').querySelectorAll('[data-pad]').forEach((x) => x.onchange());
  if (!standCompleet()) return toast('Vul alle velden in');
  if (standConcept.datum > vandaag()) return toast('De datum ligt in de toekomst');
  const p = staat.profiel, c = standConcept, js = jaarSchatting(c, p);
  p.ijking = { datum: c.datum, vanaf: c.datum.slice(0, 4) + '-01-01', kosten: c.kosten, stroomAfname: c.stroomAfname, teruglevering: c.teruglevering, gas: c.gas ?? 0, laadKwh: js.laadTotNu };
  if (c.jaarOok) { p.stroomAfname = js.stroomAfname; p.teruglevering = js.teruglevering; if (p.gas > 0) p.gas = js.gas; }
  (staat.standen ||= []).push({ ...p.ijking });
  bewaar(true); render();
  $('#standVenster .blad').innerHTML = `<h3>Stand opgeslagen</h3><p>De vergelijking is opnieuw berekend${c.jaarOok ? ' met je nieuwe jaarverbruik' : ''}.</p>
    <p class="klein">Laat de dagelijkse melding ook met deze cijfers rekenen: kopieer je gegevens en plak ze in GitHub als geheim <code>PROFIEL_JSON</code>.</p>
    <div class="knoppen"><button class="knop accent" id="standKop" type="button">Kopieer gegevens voor GitHub</button>${repoUrl() ? `<a class="knop licht" href="${esc(repoUrl())}/settings/secrets/actions" target="_blank" rel="noopener">Open GitHub-geheimen</a>` : ''}<button class="knop licht" id="standKlaar" type="button">Klaar</button></div>`;
  $('#standKop').onclick = () => kopieer(JSON.stringify(exportObject()), 'Gekopieerd. Plak het in GitHub als PROFIEL_JSON.');
  $('#standKlaar').onclick = () => ($('#standVenster').hidden = true);
}

function verloopKaart() {
  const h = staat.historie || [];
  if (h.length < 2) return `<div class="kaart"><h3>Verloop</h3><p class="klein">Vanaf vandaag houdt de app elke dag bij hoeveel de beste optie zou besparen. Na een paar dagen zie je hier een grafiek.</p></div>`;
  const eerste = h[0], nu = h[h.length - 1];
  return `<div class="kaart"><h3>Verloop besparing beste optie</h3><div class="fig" id="verloop" style="height:110px"></div>
    <p class="klein">Sinds ${datumNL(eerste.d)}: van ${plusmin(eerste.besparing)} naar ${plusmin(nu.besparing)} per jaar. Dit wordt bijgehouden als je de app opent.</p></div>`;
}
function tekenVerloop(box) {
  const h = staat.historie;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); box.appendChild(svg);
  const drempel = staat.instellingen.drempel ?? 100;
  const draw = () => {
    const W = box.clientWidth, H = box.clientHeight; if (!W) return;
    const t0 = Date.parse(h[0].d), t1 = Math.max(Date.parse(h[h.length - 1].d), t0 + 86400000);
    const vs = h.map((x) => x.besparing), mn = Math.min(0, ...vs), mx = Math.max(drempel * 1.1, ...vs);
    const x = (d) => 6 + (Date.parse(d) - t0) / (t1 - t0) * (W - 12), y = (v) => H - 16 - (v - mn) / (mx - mn) * (H - 26);
    svg.innerHTML = `<line x1="0" x2="${W}" y1="${y(drempel)}" y2="${y(drempel)}" stroke="var(--accent)" stroke-dasharray="4 4"/>
      <text x="6" y="${y(drempel) - 4}" font-size="11" fill="var(--accent)">drempel ${euro(drempel)}</text>
      <path d="${h.map((p, k) => `${k ? 'L' : 'M'}${x(p.d).toFixed(1)},${y(p.besparing).toFixed(1)}`).join('')}" fill="none" stroke="var(--ink)" stroke-width="2"/>
      <circle cx="${x(h[h.length - 1].d)}" cy="${y(h[h.length - 1].besparing)}" r="4" fill="var(--ink)"/>`;
  };
  new ResizeObserver(draw).observe(box);
}
function prijsNu() {
  const k = data.prijzen?.stroom?.komend; if (!k?.length) return null;
  const t = Date.now(); let best = null;
  for (const x of k) if (Date.parse(x.t) <= t) best = x;
  return best || k[0];
}
function tekenKoers(box) {
  const k = data.prijzen.stroom.komend.filter((x) => x.p != null);
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); box.appendChild(svg);
  const draw = () => {
    const W = box.clientWidth, H = box.clientHeight; if (!W) return;
    const ps = k.map((x) => x.p * 1.21), mn = Math.min(0, ...ps), mx = Math.max(...ps, 0.01);
    const x = (j) => 4 + (j / Math.max(1, ps.length - 1)) * (W - 8), y = (p) => H - 18 - ((p - mn) / (mx - mn)) * (H - 30);
    const nuI = Math.max(0, k.findIndex((v) => Date.parse(v.t) > Date.now()) - 1);
    const uur = (t) => new Date(t).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
    svg.innerHTML = `<line x1="0" x2="${W}" y1="${y(0)}" y2="${y(0)}" stroke="var(--lijn)"/><path d="${ps.map((p, j) => `${j ? 'L' : 'M'}${x(j).toFixed(1)},${y(p).toFixed(1)}`).join('')}" fill="none" stroke="var(--ink)" stroke-width="1.6"/>
      <circle cx="${x(nuI)}" cy="${y(ps[nuI])}" r="4" fill="var(--accent)"/>
      <text x="4" y="${H - 3}" font-size="11" fill="var(--zacht)">${uur(k[0].t)}</text><text x="${W - 4}" y="${H - 3}" font-size="11" fill="var(--zacht)" text-anchor="end">t/m ${esc(datumNL(k[k.length - 1].t))} ${uur(k[k.length - 1].t)} · max ${euro(mx, 2)}</text>`;
  };
  new ResizeObserver(draw).observe(box);
}

function regelsTabel(v) {
  const rows = v.delen.map((d) => `<tr><th colspan="3">${datumNL(d.van)} – ${datumNL(d.tot)} ${d.tarieven.saldering ? '(met saldering)' : '(zonder saldering)'}</th></tr>` +
    d.regels.map((r) => `<tr><td>${esc(r.label)}<span class="uitleg">${esc(r.uitleg || '')}</span></td><td><span class="badge b-${r.soort}">${r.soort}</span></td><td class="bedrag">${euro(r.bedrag, 2)}</td></tr>`).join('')).join('') +
    v.eenmalig.map((r) => `<tr><td>${esc(r.label)}</td><td><span class="badge b-${r.soort}">${r.soort}</span></td><td class="bedrag">${euro(r.bedrag, 2)}</td></tr>`).join('');
  return `<table><tbody>${rows}<tr><th colspan="2">Totaal komende 12 maanden</th><th class="bedrag">${euro(v.totaal, 2)}</th></tr></tbody></table>
    <p class="klein">${Math.round(v.schattingAandeel * 100)}% van de bedragen is een schatting, vooral de beursprijzen. ‘Bevestigd’ = vastgestelde of door de leverancier gepubliceerde tarieven.</p>`;
}
function bronTekst(c) {
  const b = c.bron || {};
  return b.url ? `<p class="klein">Bron: <a href="${esc(b.url)}" target="_blank" rel="noopener">${esc(b.naam || b.url)}</a> · peildatum ${datumNL(b.datum)}</p>` : b.naam ? `<p class="klein">Bron: ${esc(b.naam)}</p>` : '';
}
function contractInfo(c) {
  return `${c.toelichting ? `<p class="klein">${esc(c.toelichting)}</p>` : ''}${bronTekst(c)}
    ${c.onzeker?.length ? `<ul class="klein onzeker">${c.onzeker.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}`;
}
function verschilBalken(r) {
  const max = Math.max(20, ...r.verschil.map((v) => Math.abs(v.bedrag)));
  return r.verschil.map((v) => `<div class="balk"><span class="naam">${esc(v.label)} ${i(v.cat === 'stroom' || v.cat === 'gas' ? 'opslag' : v.cat === 'terug' ? 'teruglevering' : v.cat === 'laden' ? 'laden' : v.cat === 'overheid' ? 'overheid' : 'vast')}</span><span class="spoor div"><span class="vul ${v.bedrag >= 0 ? 'plus' : 'min'}" style="width:${(Math.abs(v.bedrag) / max * 50).toFixed(1)}%;${v.bedrag >= 0 ? 'left:50%' : 'right:50%'}"></span></span><span class="bedrag ${v.bedrag >= 0 ? 'pos' : 'neg'}">${plusmin(v.bedrag)}</span></div>`).join('')
    || '<p class="klein">Geen noemenswaardige verschillen.</p>';
}
function renderVergelijken() {
  const el = $('#vergelijken'), A = laatste;
  if (!A || A.fout) { el.innerHTML = `<h2>Vergelijken</h2><p>${esc(A?.fout || 'Vul eerst je gegevens in.')}</p>`; return; }
  el.innerHTML = `<h2>Alle opties</h2>
   <p class="klein">Netto kosten in de komende 12 maanden, vergeleken met ${esc(staat.huidig.naam)} (${euro(A.basis.totaal)}). Tik op een optie voor de uitsplitsing. Groen = goedkoper dan nu.</p>
   <div class="kaart">${A.rijen.map((r) => `<div class="optie ${openOptie === r.contract.id ? 'open' : ''}" data-id="${esc(r.contract.id)}"><button aria-expanded="${openOptie === r.contract.id}">
       <span><b>${esc(r.contract.naam)}</b><span class="uitleg">${esc(r.contract.type)} · zekerheid <span class="badge b-${r.zekerheid.niveau}">${r.zekerheid.niveau}</span> · ${euro(r.totaal)}</span></span>
       <span class="bedrag verschil ${r.besparing >= 0 ? 'pos' : 'neg'}">${plusmin(r.besparing)}<span class="uitleg">${r.besparing >= 0 ? 'goedkoper' : 'duurder'}</span></span></button>
     <div class="detail"><h4>Waar zit het verschil?</h4>${verschilBalken(r)}${contractInfo(r.contract)}
       <details><summary>Waarom deze zekerheid?</summary><ul class="klein">${r.zekerheid.redenen.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></details>
       <details><summary>Volledige berekening</summary>${regelsTabel(r)}</details></div></div>`).join('') || '<p>Geen aanbiedingen. Voeg er een toe onder ‘Aanbod’.</p>'}</div>
   ${A.onvolledig?.length ? `<p class="klein">Niet meegerekend wegens ontbrekende tarieven: ${A.onvolledig.map((o) => esc(o.naam) + ' (' + esc(o.mist.join(', ')) + ')').join('; ')}.</p>` : ''}
   <details class="kaart"><summary>Berekening huidig contract (${euro(A.basis.totaal)})</summary>${regelsTabel(A.basis)}${contractInfo(staat.huidig)}</details>
   <details class="kaart"><summary>Aannames</summary><ul class="klein">
     <li>${esc(A.markt.methode)}</li>
     <li>Gemiddelde beursprijs incl. btw: afname ${euro(A.markt.afname * 1.21, 4)}, teruglevering ${euro(A.markt.terug * 1.21, 4)}, nacht (laden) ${euro(A.markt.nacht * 1.21, 4)}${A.markt.nachtGeschat ? ' (geschat)' : ''}, gas ${euro(A.markt.gas * 1.21, 4)}/m³.</li>
     <li>Periode ${datumNL(A.start)} + 12 maanden (overstap duurt ±${staat.instellingen.overstapDagen} dagen). Verbruik naar rato over de dagen verdeeld.</li>
     <li>Dynamische leveranciers rekenen allemaal dezelfde beursprijs; het verschil zit in opslag, vaste kosten en de terugleverregeling.</li>
     <li>Netbeheer en energiebelasting zijn bij elke leverancier gelijk. Netbeheer 2027 is nog een voorstel.</li>
     <li>Vaste/variabele contracten: ${Math.round((staat.profiel.aandeelDal ?? 0.5) * 100)}% van het verbruik in daltarief; laden tegen daltarief.</li>
     ${A.basis.delen.flatMap((d) => d.tarieven.bronnen || []).filter((b, k, s) => s.findIndex((x) => x.url === b.url) === k).map((b) => `<li><a href="${esc(b.url)}" target="_blank" rel="noopener">${esc(b.naam)}</a></li>`).join('')}
   </ul></details>`;
  el.querySelectorAll('.optie > button').forEach((k) => (k.onclick = () => { const o = k.parentElement; const nu = !o.classList.contains('open'); o.classList.toggle('open', nu); k.setAttribute('aria-expanded', nu); openOptie = nu ? o.dataset.id : null; }));
}

// Na een wijziging: het scherm waarin je typt níet opnieuw opbouwen (anders sluit het toetsenbord op de iPhone).
function naWijzigingStaat(inp) {
  const sec = inp?.closest('section.scherm')?.id;
  if (!sec || inp.tagName === 'SELECT' || inp.type === 'checkbox' && sec !== 'meer') return render();
  laatste = bereken();
  const R = { overzicht: renderOverzicht, vergelijken: renderVergelijken, gegevens: renderGegevens, aanbod: renderAanbod, meer: renderMeer };
  for (const [id, f] of Object.entries(R)) if (id !== sec) f();
  if (sec === 'gegevens') { const z = $('#samenvatting'); if (z) { z.innerHTML = samenvatting(); z.querySelectorAll('[data-stand]').forEach((k) => (k.onclick = openStand)); } }
}

// ---------- formulieren
const isGroot = (extra) => ['kWh', 'm³', 'dagen', 'mnd', '/jaar'].includes(extra.na) || (extra.voor === '€' && !extra.na);
const pakPad = (obj, pad) => pad.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
function zetPad(obj, pad, w) { const d = pad.split('.'); const l = d.pop(); let o = obj; for (const k of d) o = o[k] ??= {}; o[l] = w; }
// groot = hoeveelheden en bedragen (kWh, m³, €): een punt is daar een duizendtal-scheiding (1.575 = 1575).
function leesGetal(t, groot) {
  const s = String(t).trim().replace(/[€\s]/g, '');
  if (s === '') return null;
  const n = Number(s.includes(',') || (groot && /^\d{1,3}(\.\d{3})+$/.test(s)) ? s.replace(/\./g, '').replace(',', '.') : s);
  return Number.isFinite(n) ? n : NaN;
}
function toonGetal(w, soort) {
  if (w == null || w === '') return '';
  return soort === 'pct' ? String(Math.round(w * 1000) / 10).replace('.', ',') : String(w).replace('.', ',');
}
function veld(pad, label, soort = 'getal', extra = {}) {
  const w = pakPad(staat, pad), id = 'v-' + pad.replace(/\./g, '-');
  const info = extra.info ? ' ' + i(extra.info) : '';
  if (soort === 'aan') return `<div class="schakel"><input type="checkbox" id="${id}" data-pad="${pad}" data-soort="aan" ${w ? 'checked' : ''}><label for="${id}">${esc(label)}</label>${info}</div>`;
  let input;
  if (soort === 'keuze') input = `<select id="${id}" data-pad="${pad}" data-soort="tekst">${extra.opties.map(([v, t]) => `<option value="${esc(v)}" ${v === w ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>`;
  else if (soort === 'lang') input = `<textarea id="${id}" data-pad="${pad}" data-soort="tekst" rows="3">${esc(w)}</textarea>`;
  else {
    const type = soort === 'datum' ? 'date' : 'text';
    const num = soort === 'getal' || soort === 'pct';
    input = `<div class="invoer">${extra.voor ? `<span>${esc(extra.voor)}</span>` : ''}<input id="${id}" type="${type}" ${num ? 'inputmode="decimal" autocomplete="off"' : ''} data-pad="${pad}" data-soort="${soort}" data-groot="${isGroot(extra) ? 1 : 0}" value="${esc(num ? toonGetal(w, soort) : w ?? '')}" ${extra.ph ? `placeholder="${esc(extra.ph)}"` : ''}>${extra.na ? `<span>${esc(extra.na)}</span>` : ''}</div>`;
  }
  return `<div class="veld"><label for="${id}">${esc(label)}${info}</label>${input}${extra.hint ? `<span class="klein">${esc(extra.hint)}</span>` : ''}</div>`;
}
function koppelVelden(root, doel = staat, naWijziging = naWijzigingStaat) {
  root.querySelectorAll('[data-pad]').forEach((inp) => {
    inp.onchange = () => {
      const s = inp.dataset.soort; let w;
      if (s === 'aan') w = inp.checked;
      else if (s === 'tekst' || s === 'datum') w = inp.value.trim() || null;
      else {
        w = leesGetal(inp.value, inp.dataset.groot === '1');
        if (Number.isNaN(w)) { toast('Dat is geen getal. Gebruik bijvoorbeeld 0,018'); inp.value = toonGetal(pakPad(doel, inp.dataset.pad), s); return; }
        if (s === 'pct' && w != null) w = w / 100;
      }
      zetPad(doel, inp.dataset.pad, w);
      if (doel === staat) bewaar();
      naWijziging(inp);
    };
  });
}
function samenvatting() {
  const p = staat.profiel, h = staat.huidig, ij = p.ijking || {};
  return `${kern('Stroom van het net', getal(p.stroomAfname || 0) + ' kWh/jaar')}${kern('waarvan laden auto', getal(p.laadKwh || 0) + ' kWh')}
    ${kern('Teruglevering', getal(p.teruglevering || 0) + ' kWh/jaar')}${kern('Gas', getal(p.gas || 0) + ' m³/jaar')}
    ${kern('Contract', esc(h.naam))}${kern('Geijkt op', ij.kosten ? euro(ij.kosten) + ' t/m ' + datumNL(ij.datum) : 'nee')}
    <div class="knoppen"><button class="knop licht" data-stand type="button">Stand bijwerken</button></div>
    <p class="klein">Alles staat alleen op dit toestel en wordt direct bewaard. Pas je iets aan? Kopieer dan ook je gegevens opnieuw naar GitHub (zie Meldingen).</p>`;
}
const kern = (label, waarde) => `<div class="kern"><span>${esc(label)}</span><b>${waarde}</b></div>`;
function renderGegevens() {
  const el = $('#gegevens'), h = staat.huidig, p = staat.profiel, dyn = h.type === 'dynamisch';
  const open = [...el.querySelectorAll('details[id]')].filter((d) => d.open).map((d) => d.id);
  el.innerHTML = `<h2>Mijn gegevens</h2>
  <div class="kaart samenvatting" id="samenvatting">${samenvatting()}</div>
  <details class="kaart blok" id="blok-verbruik"><summary>Verbruik per jaar</summary><form onsubmit="return false"><div class="velden">
    ${veld('profiel.stroomAfname', 'Stroom van het net', 'getal', { na: 'kWh', hint: 'Inclusief het laden van de auto.' })}
    ${veld('profiel.teruglevering', 'Teruglevering', 'getal', { na: 'kWh', info: 'teruglevering' })}
    ${veld('profiel.gas', 'Gas', 'getal', { na: 'm³', hint: '0 = zonder gasaansluiting rekenen.' })}
    ${veld('profiel.laadKwh', 'Laden auto ’s nachts', 'getal', { na: 'kWh', info: 'laden', hint: 'Bijv. 5 nachten × 12,5 kWh × 45 weken = 2.813 kWh.' })}
    ${veld('profiel.laadVergoeding', 'Vergoeding werkgever', 'getal', { voor: '€', na: '/kWh' })}
    ${veld('profiel.aandeelDal', 'Aandeel daltarief', 'pct', { na: '%', hint: 'Alleen voor vaste/variabele contracten.' })}
  </div>${veld('profiel.toelichting', 'Notities', 'lang')}</form></details>

  <details class="kaart blok" id="blok-contract"><summary>Huidig contract: ${esc(h.naam)}</summary><form onsubmit="return false"><div class="velden">
    ${veld('huidig.naam', 'Naam', 'tekst')}${veld('huidig.leverancier', 'Leverancier', 'tekst')}
    ${veld('huidig.type', 'Soort contract', 'keuze', { info: 'dynamisch', opties: [['dynamisch', 'Dynamisch'], ['vast', 'Vast'], ['variabel', 'Variabel']] })}
    ${dyn ? veld('huidig.stroom.opslag', 'Opslag stroom', 'getal', { voor: '€', na: '/kWh', info: 'opslag' }) + veld('huidig.gas.opslag', 'Opslag gas', 'getal', { voor: '€', na: '/m³' })
          : veld('huidig.stroom.tarief', 'Stroom normaal (zonder energiebelasting)', 'getal', { voor: '€', na: '/kWh' }) + veld('huidig.stroom.tariefDal', 'Stroom dal', 'getal', { voor: '€', na: '/kWh' }) + veld('huidig.gas.tarief', 'Gas (zonder energiebelasting)', 'getal', { voor: '€', na: '/m³' })}
    ${veld('huidig.stroom.vast', 'Vaste kosten stroom', 'getal', { voor: '€', na: '/mnd', info: 'vast' })}${veld('huidig.gas.vast', 'Vaste kosten gas', 'getal', { voor: '€', na: '/mnd' })}
    ${veld('huidig.stroom.terugVergoeding', 'Extra vergoeding teruglevering', 'getal', { voor: '€', na: '/kWh' })}${veld('huidig.stroom.terugKosten', 'Terugleverkosten', 'getal', { voor: '€', na: '/kWh' })}
    ${veld('huidig.einddatum', 'Einddatum (leeg = onbepaalde tijd)', 'datum')}
    ${veld('huidig.opzegtermijn', 'Opzegtermijn', 'tekst')}${veld('huidig.opzegvergoeding', 'Opzegvergoeding bij overstap', 'getal', { voor: '€' })}
  </div>${contractInfo(h)}</form></details>

  <details class="kaart blok" id="blok-ijken"><summary>IJken op je kosten tot nu toe ${i('ijken')}</summary><form onsubmit="return false">
  <p class="klein">Neem over uit de app van je leverancier. Laat ‘Kosten’ leeg om niet te ijken.</p><div class="velden">
    ${veld('profiel.ijking.datum', 'Stand op datum', 'datum')}
    ${veld('profiel.ijking.kosten', 'Kosten tot nu toe', 'getal', { voor: '€' })}
    ${veld('profiel.ijking.stroomAfname', 'Stroom van het net tot nu', 'getal', { na: 'kWh' })}
    ${veld('profiel.ijking.teruglevering', 'Teruglevering tot nu', 'getal', { na: 'kWh' })}
    ${veld('profiel.ijking.gas', 'Gas tot nu', 'getal', { na: 'm³' })}
    ${veld('profiel.ijking.laadKwh', 'Waarvan laden auto', 'getal', { na: 'kWh' })}
  </div>${laatste?.markt?.ijkFactor ? `<p class="klein">Uitkomst: je prijsniveau is ${getal(laatste.markt.ijkFactor, 2)} × dat van je jaarafrekening.</p>` : ''}</form></details>

  <details class="kaart blok" id="blok-prijzen"><summary>Beursprijzen uit je jaarafrekening</summary><form onsubmit="return false">
  <p class="klein">Staan op de jaarafrekening van een dynamisch contract als ‘gemiddelde beursprijs’ (incl. btw).</p><div class="velden">
    ${veld('profiel.gerealiseerd.jaar', 'Jaar', 'getal')}
    ${veld('profiel.gerealiseerd.stroomAfnamePrijs', 'Stroom afname', 'getal', { voor: '€', na: '/kWh' })}
    ${veld('profiel.gerealiseerd.stroomTerugPrijs', 'Teruglevering', 'getal', { voor: '€', na: '/kWh' })}
    ${veld('profiel.gerealiseerd.gasPrijs', 'Gas', 'getal', { voor: '€', na: '/m³' })}
  </div></form></details>

  <details class="kaart blok" id="blok-backup"><summary>Back-up en overzetten</summary>
    <div class="knoppen"><label class="knop" for="impBestand">Bestand importeren</label><input type="file" id="impBestand" accept=".json,application/json" hidden>
    <button class="knop licht" id="deel">Back-up bewaren</button><button class="knop licht" id="kopieer">Kopieer als tekst</button></div>
    <details><summary>Plak een back-up</summary><textarea id="plakJson" rows="5" placeholder='{"type":"energie-overstap-profiel", ...}'></textarea><div class="knoppen"><button class="knop" id="plakKnop">Importeren</button></div></details>
    <details><summary>Alles wissen op dit toestel</summary><p class="klein">Maak eerst een back-up.</p><button class="knop gevaar" id="wis">Wis mijn gegevens</button></details>
  </details>`;
  for (const id of open) { const d = el.querySelector('#' + id); if (d) d.open = true; }
  koppelVelden(el);
  el.querySelectorAll('[data-stand]').forEach((k) => (k.onclick = openStand));
  $('#impBestand').onchange = (e) => importeerBestand(e.target.files[0]);
  $('#kopieer').onclick = () => kopieer(JSON.stringify(exportObject(), null, 1), 'Back-up gekopieerd');
  $('#deel').onclick = () => deelBackup();
  $('#plakKnop').onclick = () => importeerTekst($('#plakJson').value);
  $('#wis').onclick = () => { if ($('#wis').dataset.zeker) { try { localStorage.removeItem(SLEUTEL); } catch {} staat = nieuweStaat(); render(); ga('overzicht'); toast('Gewist'); } else { $('#wis').dataset.zeker = 1; $('#wis').textContent = 'Tik nogmaals om te bevestigen'; } };
}

// ---------- aanbiedingen
const LEEG_AANBOD = { naam: '', leverancier: '', type: 'dynamisch', stroom: { opslag: null, tarief: null, tariefDal: null, vast: null, terugVergoeding: 0, terugKosten: 0, terugBtw: true }, gas: { opslag: null, tarief: null, vast: null }, korting: 0, looptijdMnd: 0, geldigTot: null, bron: { naam: '', url: '', soort: 'handmatig', datum: null }, onzeker: [] };
let concept = null, openAanbod = null;
function cveld(pad, label, soort = 'getal', extra = {}) {
  const w = pakPad(concept, pad), id = 'c-' + pad.replace(/\./g, '-');
  if (soort === 'keuze') return `<div class="veld"><label for="${id}">${esc(label)}</label><select id="${id}" data-pad="${pad}" data-soort="tekst">${extra.opties.map(([v, t]) => `<option value="${esc(v)}" ${v === w ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></div>`;
  const num = soort === 'getal';
  return `<div class="veld"><label for="${id}">${esc(label)}</label><div class="invoer">${extra.voor ? `<span>${esc(extra.voor)}</span>` : ''}<input id="${id}" type="${soort === 'datum' ? 'date' : 'text'}" ${num ? 'inputmode="decimal" autocomplete="off"' : ''} data-pad="${pad}" data-soort="${soort}" data-groot="${isGroot(extra) ? 1 : 0}" value="${esc(num ? toonGetal(w) : w ?? '')}">${extra.na ? `<span>${esc(extra.na)}</span>` : ''}</div></div>`;
}
function renderAanbod() {
  const el = $('#aanbod'), lijst = aanbiedingen(), m = laatste?.markt;
  const perId = Object.fromEntries((laatste?.rijen || []).map((r) => [r.contract.id, r]));
  const rij = (a) => {
    const z = m ? zekerheid(a, m, vandaag()) : null, r = perId[a.id], eigen = String(a.id).startsWith('eigen-'), open = openAanbod === a.id;
    const tarief = a.type === 'dynamisch' ? `opslag ${euro(a.stroom.opslag ?? 0, 4)}/kWh, gas ${euro(a.gas?.opslag ?? 0, 4)}/m³` : `stroom ${euro(a.stroom.tarief ?? 0, 4)}/kWh, gas ${euro(a.gas?.tarief ?? 0, 4)}/m³`;
    const terug = [a.stroom.terugVergoeding ? '+' + euro(a.stroom.terugVergoeding, 4) : '', a.stroom.terugBonusPct ? '+' + Math.round(a.stroom.terugBonusPct * 100) + '% bonus' : '', a.stroom.terugKosten ? '−' + euro(a.stroom.terugKosten, 4) + ' kosten' : ''].filter(Boolean).join(', ') || (a.type === 'dynamisch' ? 'alleen beursprijs' : 'geen vergoeding');
    return `<div class="optie ${open ? 'open' : ''} ${a.verborgen ? 'uitgezet' : ''}" data-id="${esc(a.id)}"><button aria-expanded="${open}">
        <span><b>${esc(a.naam)}</b>${z ? ` <span class="badge b-${z.niveau}">${z.niveau}</span>` : ''}${a.verborgen ? ' <span class="badge b-laag">niet meegenomen</span>' : ''}<span class="uitleg">${esc(a.type)}${eigen ? ' · eigen invoer' : ''}${a.geldigTot ? ' · geldig t/m ' + datumNL(a.geldigTot) : ''}</span></span>
        <span class="bedrag">${r ? `<span class="${r.besparing >= 0 ? 'pos' : 'neg'}">${plusmin(r.besparing)}</span><span class="uitleg">${euro(r.totaal)}/jaar</span>` : '<span class="uitleg">—</span>'}</span></button>
      <div class="detail">
        <dl class="feiten"><dt>Tarief</dt><dd>${tarief}</dd><dt>Vaste kosten</dt><dd>${euro((a.stroom.vast || 0) + (a.gas?.vast || 0), 2)}/mnd</dd><dt>Teruglevering</dt><dd>${terug}</dd>${a.korting ? `<dt>Korting</dt><dd>${euro(a.korting)}</dd>` : ''}</dl>
        ${contractInfo(a)}
        <div class="knoppen klein-knoppen">${eigen ? `<button class="knop licht" data-bewerk="${esc(a.id)}">Bewerken</button><button class="knop licht" data-weg="${esc(a.id)}">Verwijderen</button>` : `<button class="knop licht" data-kopie="${esc(a.id)}">Kopiëren en aanpassen</button>`}<button class="knop licht" data-verberg="${esc(a.id)}">${a.verborgen ? 'Weer meenemen' : 'Niet meenemen'}</button></div>
      </div></div>`;
  };
  const c = concept, cd = c && c.type === 'dynamisch';
  el.innerHTML = `<h2>Aanbiedingen</h2>
  <p class="klein">Bedrag = verschil met je huidige contract per jaar. Tik voor tarieven en bron. Aanbiedingen worden niet automatisch opgehaald: er is geen openbare, toegestane bron voor.</p>
  <div class="knoppen"><button class="knop accent" id="nieuw">+ Aanbieding toevoegen</button></div>
  ${c ? `<form class="kaart" id="conceptForm" onsubmit="return false"><h3>${c.id ? 'Aanbieding bewerken' : 'Nieuwe aanbieding'}</h3><div class="velden">
    ${cveld('naam', 'Naam', 'tekst')}${cveld('leverancier', 'Leverancier', 'tekst')}
    ${cveld('type', 'Soort', 'keuze', { opties: [['dynamisch', 'Dynamisch'], ['vast', 'Vast'], ['variabel', 'Variabel']] })}
    ${cd ? cveld('stroom.opslag', 'Opslag stroom', 'getal', { voor: '€', na: '/kWh' }) + cveld('gas.opslag', 'Opslag gas', 'getal', { voor: '€', na: '/m³' })
         : cveld('stroom.tarief', 'Stroom normaal (zonder energiebelasting)', 'getal', { voor: '€', na: '/kWh' }) + cveld('stroom.tariefDal', 'Stroom dal (leeg = enkel)', 'getal', { voor: '€', na: '/kWh' }) + cveld('gas.tarief', 'Gas (zonder energiebelasting)', 'getal', { voor: '€', na: '/m³' })}
    ${cveld('stroom.vast', 'Vaste kosten stroom', 'getal', { voor: '€', na: '/mnd' })}${cveld('gas.vast', 'Vaste kosten gas', 'getal', { voor: '€', na: '/mnd' })}
    ${cveld('stroom.terugVergoeding', cd ? 'Extra vergoeding teruglevering' : 'Terugleververgoeding', 'getal', { voor: '€', na: '/kWh' })}${cveld('stroom.terugKosten', 'Terugleverkosten', 'getal', { voor: '€', na: '/kWh' })}
    ${cveld('korting', 'Welkomstkorting (eenmalig)', 'getal', { voor: '€' })}${cveld('looptijdMnd', 'Looptijd (0 = onbepaald)', 'getal', { na: 'mnd' })}
    ${cveld('geldigTot', 'Aanbod geldig tot', 'datum')}${cveld('bron.url', 'Link naar het aanbod', 'tekst')}
    ${cveld('bron.datum', 'Peildatum tarieven', 'datum')}
    ${cveld('bron.soort', 'Waar komt het vandaan?', 'keuze', { opties: [['leverancier', 'Website van de leverancier'], ['handmatig', 'Vergelijkingssite / eigen invoer']] })}
  </div><p class="klein">Bedragen incl. btw, zoals de leverancier ze toont. Bij vast en variabel: tarief zónder energiebelasting (trek voor 2027 €0,1065/kWh en €0,7457/m³ af als die erin zit).</p>
  <div class="knoppen"><button class="knop" id="bewaarConcept">Opslaan</button><button class="knop licht" id="annuleer">Annuleren</button></div></form>` : ''}
  <div class="kaart">${lijst.map(rij).join('') || '<p>Nog geen aanbiedingen.</p>'}</div>
  <details class="kaart"><summary>Aanbiedingen importeren (JSON)</summary><p class="klein">Plak een lijst in het formaat van <code>data/aanbiedingen.json</code>.</p><textarea id="aanbodJson" rows="4"></textarea><div class="knoppen"><button class="knop" id="aanbodImp">Importeren</button></div></details>`;
  const naarForm = () => $('#conceptForm')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  $('#nieuw').onclick = () => { concept = kloon(LEEG_AANBOD); concept.bron.datum = vandaag(); renderAanbod(); naarForm(); };
  el.querySelectorAll('.optie > button').forEach((k) => (k.onclick = () => { const o = k.parentElement; const nu = !o.classList.contains('open'); o.classList.toggle('open', nu); k.setAttribute('aria-expanded', nu); openAanbod = nu ? o.dataset.id : null; }));
  el.querySelectorAll('[data-verberg]').forEach((k) => (k.onclick = () => { const id = k.dataset.verberg; staat.verborgen = staat.verborgen.includes(id) ? staat.verborgen.filter((x) => x !== id) : [...staat.verborgen, id]; bewaar(); render(); }));
  el.querySelectorAll('[data-kopie]').forEach((k) => (k.onclick = () => { const a = lijst.find((x) => x.id === k.dataset.kopie); concept = { ...kloon(a), id: null, naam: a.naam + ' (eigen)', bron: { ...a.bron, soort: 'handmatig', datum: vandaag() } }; delete concept.verborgen; renderAanbod(); naarForm(); }));
  el.querySelectorAll('[data-bewerk]').forEach((k) => (k.onclick = () => { concept = kloon(staat.eigenAanbiedingen.find((x) => x.id === k.dataset.bewerk)); renderAanbod(); naarForm(); }));
  el.querySelectorAll('[data-weg]').forEach((k) => (k.onclick = () => { staat.eigenAanbiedingen = staat.eigenAanbiedingen.filter((x) => x.id !== k.dataset.weg); bewaar(); render(); }));
  if (c) {
    koppelVelden($('#conceptForm'), concept, (inp) => { if (inp?.dataset.pad === 'type') renderAanbod(); });
    $('#annuleer').onclick = () => { concept = null; renderAanbod(); };
    $('#bewaarConcept').onclick = () => {
      $('#conceptForm').querySelectorAll('[data-pad]').forEach((x) => x.onchange());
      const k = concept, dy = k.type === 'dynamisch';
      if (!k.naam) return toast('Geef de aanbieding een naam');
      if (dy ? k.stroom.opslag == null : k.stroom.tarief == null) return toast(dy ? 'Vul de opslag stroom in' : 'Vul het stroomtarief in');
      if (staat.profiel.gas > 0 && (dy ? k.gas.opslag == null : k.gas.tarief == null)) return toast('Vul ook de gasprijs in');
      if (!k.bron.naam) k.bron.naam = k.bron.url ? 'Aanbod ' + (k.leverancier || k.naam) : 'Eigen invoer';
      k.onzeker = k.onzeker || [];
      if (k.id) staat.eigenAanbiedingen = staat.eigenAanbiedingen.map((x) => (x.id === k.id ? k : x));
      else { k.id = 'eigen-' + Date.now(); staat.eigenAanbiedingen.push(k); }
      openAanbod = k.id; concept = null; bewaar(true); render(); toast('Aanbieding opgeslagen');
    };
  }
  $('#aanbodImp').onclick = () => {
    try {
      const j = JSON.parse($('#aanbodJson').value), l = Array.isArray(j) ? j : j.aanbiedingen;
      if (!Array.isArray(l) || l.some((a) => !a.naam || !a.stroom)) throw new Error();
      l.forEach((a, k) => staat.eigenAanbiedingen.push({ ...a, id: 'eigen-' + Date.now() + '-' + k }));
      bewaar(true); render(); toast(l.length === 1 ? '1 aanbieding geïmporteerd' : l.length + ' aanbiedingen geïmporteerd');
    } catch { toast('Dit is geen geldige lijst met aanbiedingen'); }
  };
}

// ---------- meldingen en info
function renderMeer() {
  const el = $('#meer'), s = staat.instellingen;
  el.innerHTML = `<h2>Meldingen</h2>
  <form class="kaart" onsubmit="return false"><div class="velden">
    ${veld('instellingen.meldingen', 'Meldingen aan', 'aan')}${veld('instellingen.weekoverzicht', 'Elke maandag een kort overzicht', 'aan')}${veld('instellingen.standHerinnering', 'Op de 1e van de maand: herinnering om je stand bij te werken', 'aan')}
    ${veld('instellingen.drempel', 'Melden vanaf besparing', 'getal', { voor: '€', na: '/jaar', info: 'drempel' })}
    ${veld('instellingen.dagenVoorEinde', 'Waarschuwen voor einde contract', 'getal', { na: 'dagen' })}
  </div></form>
  <div class="kaart"><h3>Pushmeldingen op je iPhone ${i('ntfy')}</h3>
    <ol class="stappen">
      <li><span>Geheim onderwerp:</span> <code>${esc(s.ntfyOnderwerp || 'nog niet aangemaakt')}</code>
        <div class="knoppen klein-knoppen"><button class="knop licht" id="maakNtfy" type="button">${s.ntfyOnderwerp ? 'Nieuw onderwerp' : 'Maak aan'}</button>${s.ntfyOnderwerp ? '<button class="knop licht" id="kopNtfy" type="button">Kopieer</button>' : ''}</div></li>
      <li>Abonneer je in de ntfy-app op dit onderwerp en zet het in GitHub als geheim <code>NTFY_TOPIC</code>.</li>
      <li>Zet je gegevens in GitHub als geheim <code>PROFIEL_JSON</code>: <button class="knop accent" id="kopProfiel" type="button">Kopieer gegevens voor GitHub</button></li>
      <li>Test het: GitHub → Actions → Dagelijkse energiecheck → Run workflow → vink <i>Stuur een testmelding</i> aan.${repoUrl() ? ` <a href="${esc(repoUrl())}/actions/workflows/dagelijks.yml" target="_blank" rel="noopener">Open op GitHub</a>` : ''}</li>
    </ol>
    <p class="klein">Op de 1e van de maand krijg je (als dat aanstaat) een herinnering om je stand bij te werken. Verder alleen bij iets nieuws: een overstapkans boven je drempel (opnieuw bij €25 meer of na 30 dagen), een contract dat bijna afloopt of een aanbieding die bijna verloopt. Onder de drempel blijft het stil. Er worden nooit berichten namens jou verstuurd.</p>
    <details><summary>Andere kanalen</summary><table class="stack"><thead><tr><th>Kanaal</th><th>Kosten</th><th>Privacy</th></tr></thead><tbody>
      <tr><td><b>In de app</b></td><td>gratis</td><td>blijft op je toestel</td></tr>
      <tr><td><b>Push via ntfy</b></td><td>gratis</td><td>meldingstekst gaat via ntfy.sh</td></tr>
      <tr><td><b>E-mail via ntfy</b></td><td>gratis (beperkt per dag)</td><td>geheim <code>MELDING_EMAIL</code>; adres gaat naar ntfy.sh</td></tr>
      <tr><td><b>Sms / WhatsApp</b></td><td>betaald per bericht</td><td>niet ingebouwd</td></tr></tbody></table></details>
  </div>
  <details class="kaart"><summary>Instellingen voor gevorderden</summary><form onsubmit="return false"><div class="velden">
    ${veld('instellingen.overstapDagen', 'Duur van een overstap', 'getal', { na: 'dagen' })}
    ${veld('instellingen.repo', 'GitHub-repository', 'tekst', { ph: 'et1902/energie-overstap', hint: 'Wordt automatisch herkend op github.io.' })}
  </div></form></details>
  <details class="kaart"><summary>Privacy en werking</summary><div class="klein">
   <p><b>Je gegevens</b> (verbruik, contract) staan alleen in deze browser op dit toestel. Voor de dagelijkse check zet je zelf een kopie zonder naam, adres, EAN of rekeningnummer als versleuteld geheim in je GitHub-repository.</p>
   <p><b>Externe diensten:</b> GitHub (app en versleuteld geheim), Energy-Charts en EnergyZero (alleen datums, vanaf GitHub), ntfy.sh (alleen de meldingstekst).</p>
   <p><b>De repository is openbaar</b> en bevat alleen de app, tarieven en beursprijzen. De logboeken tonen geen bedragen.</p>
   <p><b>Zonder internet</b> werkt alles met de laatst geladen gegevens. Online nodig: nieuwe prijzen, tarieven, aanbiedingen en meldingen.</p>
   <p><b>Beursprijzen:</b> ${(data.prijzen?.bronnen || []).map((b) => `${esc(b.naam)} (${esc(b.licentie || '')})`).join('; ') || 'nog niet opgehaald'}.</p>
   <p>Geen financieel advies. Controleer een aanbod altijd bij de leverancier voordat je overstapt.</p></div></details>`;
  koppelVelden(el);
  $('#maakNtfy').onclick = () => { const b = new Uint8Array(12); crypto.getRandomValues(b); staat.instellingen.ntfyOnderwerp = 'energie-' + Array.from(b, (x) => x.toString(36).padStart(2, '0')).join('').slice(0, 20); bewaar(); render(); toast('Nieuw onderwerp. Zet het ook in ntfy en GitHub.'); };
  $('#kopProfiel').onclick = () => kopieer(JSON.stringify(exportObject()), 'Gekopieerd. Plak het in GitHub als geheim PROFIEL_JSON.');
  if ($('#kopNtfy')) $('#kopNtfy').onclick = () => kopieer(s.ntfyOnderwerp, 'Onderwerp gekopieerd');
}

// ---------- import/export
function exportObject() {
  const { ntfyOnderwerp, ...inst } = staat.instellingen;
  return { type: 'energie-overstap-profiel', versie: 1, gemaakt: new Date().toISOString(), profiel: staat.profiel, huidig: staat.huidig, instellingen: inst, eigenAanbiedingen: staat.eigenAanbiedingen, verborgen: staat.verborgen };
}
function importeerTekst(t) {
  try {
    const j = JSON.parse(t);
    if (j.type !== 'energie-overstap-profiel' || !j.profiel) throw new Error();
    staat.profiel = { ...kloon(LEEG_PROFIEL), ...j.profiel, gerealiseerd: { ...LEEG_PROFIEL.gerealiseerd, ...j.profiel.gerealiseerd } };
    if (j.huidig) staat.huidig = j.huidig;
    if (j.instellingen) staat.instellingen = { ...staat.instellingen, ...j.instellingen };
    if (j.eigenAanbiedingen) staat.eigenAanbiedingen = j.eigenAanbiedingen;
    if (j.verborgen) staat.verborgen = j.verborgen;
    bewaar(true); render(); ga('overzicht'); toast('Gegevens geïmporteerd');
  } catch { toast('Dit bestand is geen geldig profiel voor deze app'); }
}
function importeerBestand(f) { if (!f) return; const r = new FileReader(); r.onload = () => importeerTekst(r.result); r.readAsText(f); }
async function kopieer(tekst, melding) {
  try { await navigator.clipboard.writeText(tekst); toast(melding); }
  catch { const t = document.createElement('textarea'); t.value = tekst; document.body.appendChild(t); t.select(); try { document.execCommand('copy'); toast(melding); } catch { toast('Kopiëren lukt niet. Gebruik ‘Back-up bewaren’.'); } t.remove(); }
}
async function deelBackup() {
  const naam = 'energie-overstap-backup-' + vandaag() + '.json';
  const tekst = JSON.stringify(exportObject(), null, 1);
  try {
    const f = new File([tekst], naam, { type: 'application/json' });
    if (navigator.canShare && navigator.canShare({ files: [f] })) { await navigator.share({ files: [f], title: 'Back-up energie-app' }); return; }
  } catch (e) { if (e.name === 'AbortError') return; }
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([tekst], { type: 'application/json' })); a.download = naam;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
function repoUrl() {
  const r = staat.instellingen.repo;
  if (r && /^[\w.-]+\/[\w.-]+$/.test(r)) return 'https://github.com/' + r;
  const m = location.hostname.match(/^([\w-]+)\.github\.io$/), pad = location.pathname.split('/').filter(Boolean)[0];
  return m && pad ? `https://github.com/${m[1]}/${pad}` : null;
}

// ---------- uitlegvenster, navigatie, meldingen
const venster = $('#uitlegVenster');
document.addEventListener('click', (e) => {
  const k = e.target.closest('[data-uitleg]'); if (!k) return;
  e.preventDefault(); e.stopPropagation();
  const [t, u] = UITLEG[k.dataset.uitleg];
  $('#uitlegTitel').textContent = t; $('#uitlegTekst').textContent = u;
  venster.hidden = false; $('#uitlegSluit').focus();
});
$('#uitlegSluit').onclick = () => (venster.hidden = true);
venster.addEventListener('click', (e) => { if (e.target === venster) venster.hidden = true; });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { venster.hidden = true; $('#standVenster').hidden = true; } });
$('#standVenster').addEventListener('click', (e) => { if (e.target.id === 'standVenster') e.target.hidden = true; });

function ga(tab) {
  document.querySelectorAll('section.scherm').forEach((s) => s.classList.toggle('actief', s.id === tab));
  document.querySelectorAll('nav.tabs button').forEach((b) => b.setAttribute('aria-current', b.dataset.tab === tab));
  try { history.replaceState(null, '', '#' + tab); } catch {}
  window.scrollTo(0, 0);
}
let toastTimer;
function toast(t) { const el = $('#toast'); el.textContent = t; el.classList.add('zicht'); clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('zicht'), 2800); }

document.querySelectorAll('nav.tabs button').forEach((b) => (b.onclick = () => ga(b.dataset.tab)));
addEventListener('online', () => laadData()); addEventListener('offline', render);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && data.geladen && Date.now() - Date.parse(data.geladen) > 3600e3) laadData(); });
const start = location.hash.slice(1);
if (['overzicht', 'vergelijken', 'gegevens', 'aanbod', 'meer'].includes(start)) ga(start);
let standBijStart = start === 'stand';
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
render();
laadData();
}
