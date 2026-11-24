import { analyse, waarschuwingen, zekerheid } from './calc.js';
import { LEEG_PROFIEL, ANWB_DYNAMISCH, STANDAARD_INSTELLINGEN } from './standaard.js';

{
const SLEUTEL = 'energie-overstap:v1';
const $ = (s, el = document) => el.querySelector(s);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const euro = (x, d = 0) => (x < 0 ? '−' : '') + '€ ' + Math.abs(x).toLocaleString('nl-NL', { minimumFractionDigits: d, maximumFractionDigits: d });
const vandaag = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Amsterdam' });
const datumNL = (iso) => iso ? new Date(iso.length > 10 ? iso : iso + 'T12:00:00').toLocaleString('nl-NL', { day: 'numeric', month: 'short', year: 'numeric', ...(iso.length > 10 ? { hour: '2-digit', minute: '2-digit' } : {}) }) : 'onbekend';
const kloon = (x) => JSON.parse(JSON.stringify(x));

// ---------- opslag (alleen op dit toestel)
function nieuweStaat() {
  return { profiel: kloon(LEEG_PROFIEL), huidig: kloon(ANWB_DYNAMISCH), instellingen: { ...STANDAARD_INSTELLINGEN }, eigenAanbiedingen: [], verborgen: [] };
}
function laadStaat() {
  try { const s = JSON.parse(localStorage.getItem(SLEUTEL)); if (s && s.profiel) return { ...nieuweStaat(), ...s, instellingen: { ...STANDAARD_INSTELLINGEN, ...s.instellingen } }; } catch {}
  return nieuweStaat();
}
let staat = laadStaat();
function bewaar(stil) {
  try { localStorage.setItem(SLEUTEL, JSON.stringify(staat)); if (!stil) toast('Opgeslagen op dit toestel'); }
  catch { toast('Opslaan lukt niet in deze browser. Exporteer je gegevens als back-up.'); }
}

// ---------- gegevens van de server (openbaar, geen persoonsgegevens)
const data = { tarieven: null, basisAanbod: [], prijzen: null, geladen: null, fout: null, offline: !navigator.onLine };
async function laadData(handmatig) {
  const haal = async (p) => { const r = await fetch(p, { cache: 'no-store' }); if (!r.ok) throw new Error(p + ': HTTP ' + r.status); return r.json(); };
  try {
    const [t, a, p] = await Promise.all([haal('data/tarieven.json'), haal('data/aanbiedingen.json'), haal('data/prijzen.json').catch(() => null)]);
    data.tarieven = t; data.basisAanbod = a.aanbiedingen || []; data.prijzen = p && p.bijgewerkt ? p : null; data.prijsFouten = p?.fouten || [];
    data.geladen = new Date().toISOString(); data.fout = null;
    if (handmatig) toast(data.prijzen ? 'Bijgewerkt. Beursprijzen van ' + datumNL(data.prijzen.bijgewerkt) : 'Bijgewerkt. Er zijn nog geen beursprijzen opgehaald.');
  } catch (e) {
    data.fout = 'Gegevens konden niet worden geladen (' + e.message + '). Je ziet de laatst opgeslagen versie, als die er is.';
    if (handmatig) toast('Bijwerken mislukt: geen verbinding?');
  }
  render();
}

function aanbiedingen() {
  return [...data.basisAanbod.map((a) => ({ ...a, verborgen: staat.verborgen.includes(a.id) })), ...staat.eigenAanbiedingen];
}
function profielCompleet() { return staat.profiel.stroomAfname > 0; }
function bereken() {
  if (!data.tarieven || !profielCompleet()) return null;
  try {
    return analyse({ profiel: staat.profiel, huidig: staat.huidig, aanbiedingen: aanbiedingen(), prijzen: data.prijzen, tarieven: data.tarieven, instellingen: staat.instellingen, vandaagISO: vandaag() });
  } catch (e) { console.error(e); return { fout: e.message }; }
}

// ---------- weergave
let laatste = null;
function render() {
  laatste = bereken();
  $('#netStip').classList.toggle('uit', !navigator.onLine);
  $('#statusTekst').textContent = navigator.onLine ? (data.prijzen ? 'Prijzen ' + datumNL(data.prijzen.bijgewerkt) : 'Online') : 'Offline';
  renderOverzicht(); renderVergelijken(); renderGegevens(); renderAanbod(); renderMeer();
}

function renderOverzicht() {
  const el = $('#overzicht');
  if (!data.tarieven && data.fout) { el.innerHTML = `<div class="kaart"><h2>Geen gegevens</h2><p>${esc(data.fout)}</p><button class="knop" id="opnieuw">Opnieuw proberen</button></div>`; $('#opnieuw').onclick = () => laadData(true); return; }
  if (!profielCompleet()) {
    el.innerHTML = `<h2>Welkom</h2><div class="kaart"><p>Vul eerst je verbruik in, of open het profielbestand dat je hebt gekregen. Je gegevens blijven op dit toestel.</p>
      <div class="knoppen"><label class="knop accent" for="snelImport" style="display:inline-flex;align-items:center">Profielbestand openen</label><input type="file" id="snelImport" accept=".json,application/json" hidden>
      <button class="knop licht" data-ga="gegevens">Zelf invullen</button></div></div>`;
    $('#snelImport').onchange = (e) => importeerBestand(e.target.files[0]);
    el.querySelector('[data-ga]').onclick = () => ga('gegevens');
    return;
  }
  const A = laatste;
  if (!A || A.fout) { el.innerHTML = `<div class="kaart"><p>Berekenen lukt niet: ${esc(A?.fout || 'tarieven ontbreken')}</p></div>`; return; }
  const b = A.beste, adv = A.advies;
  const label = { overstappen: 'Overstappen loont', twijfel: 'Kleine winst mogelijk', blijven: 'Blijven', geen: 'Nog niets te vergelijken' }[adv.soort];
  const groot = b ? Math.max(0, b.besparing) : 0;
  const w = waarschuwingen({ huidig: staat.huidig, aanbiedingen: aanbiedingen(), prijzen: data.prijzen, instellingen: staat.instellingen, vandaagISO: vandaag(), analyseResultaat: A });
  const maxV = Math.max(50, ...A.rijen.slice(0, 7).map((r) => Math.abs(r.besparing)).filter((x) => x < 500));
  const nu = prijsNu();
  el.innerHTML = `
  <div class="raster twee">
   <div>
    <div class="kaart oordeel">
      <div class="label">${esc(label)} · komende 12 maanden vanaf ${datumNL(A.start)}</div>
      <div class="groot">${euro(groot)}<small> ${b && b.besparing > 0 ? 'besparing' : 'verschil'}</small></div>
      <p>${esc(adv.tekst)}</p>
      ${adv.wanneer ? `<p class="klein">${esc(adv.wanneer)}</p>` : ''}
      ${b ? `<p>Zekerheid: <span class="badge b-${b.zekerheid.niveau}">${b.zekerheid.niveau}</span></p><details><summary>Waarom deze zekerheid?</summary><ul>${b.zekerheid.redenen.map((r) => `<li>${esc(r)}</li>`).join('')}</ul></details>` : ''}
      <div class="knoppen"><button class="knop" data-ga="vergelijken">Bekijk de berekening</button></div>
    </div>
    <div class="kaart"><h3 style="margin-top:0">Verschil met je huidige contract</h3>
      <p class="klein">Huidig (${esc(staat.huidig.naam)}): ${euro(A.basis.totaal)} netto in 12 maanden. Naar rechts = goedkoper.</p>
      ${A.rijen.slice(0, 7).map((r) => { const w = Math.min(50, Math.abs(r.besparing) / maxV * 50); return `<div class="balk ${r === b ? 'beste' : ''}"><span class="naam" title="${esc(r.contract.naam)}">${esc(r.contract.naam)}</span><span class="spoor div"><span class="vul ${r.besparing >= 0 ? 'plus' : 'min'}" style="width:${w.toFixed(1)}%;${r.besparing >= 0 ? 'left:50%' : 'right:50%'}"></span></span><span class="bedrag ${r.besparing >= 0 ? 'pos' : 'neg'}">${r.besparing >= 0 ? '+' : '−'}${euro(Math.abs(r.besparing)).replace('−', '')}</span></div>`; }).join('')}
      <p class="klein">Totale jaarkosten per optie staan onder ‘Vergelijk’. Balken boven €${Math.round(maxV)} zijn afgekapt.</p>
    </div>
   </div>
   <div>
    <div class="kaart"><h3 style="margin-top:0">Aandachtspunten</h3>
      ${w.length ? `<ul class="melding">${w.map((x) => `<li class="${esc(x.ernst)}">${esc(x.tekst)}</li>`).join('')}</ul>` : '<p>Geen bijzonderheden.</p>'}
    </div>
    <div class="kaart"><h3 style="margin-top:0">Actuele gegevens</h3>
      ${nu ? `<p>Beursprijs stroom nu: <b>${euro(nu.p * 1.21, 3)}</b>/kWh incl. btw <span class="klein">(excl. opslag en belasting, ${datumNL(nu.t)})</span></p><div class="fig" id="koers"></div>` : '<p>Geen actuele uurprijzen beschikbaar.</p>'}
      <p class="klein"><b>Rekenmethode:</b> ${esc(A.markt.methode)}</p>
      <p class="klein"><b>Beursprijzen bijgewerkt:</b> ${data.prijzen ? datumNL(data.prijzen.bijgewerkt) + ' — ' + (data.prijzen.bronnen || []).map((x) => esc(x.naam)).join(', ') : 'nog niet (de dagelijkse GitHub-taak vult dit)'}</p>
      ${data.prijsFouten?.length && data.prijzen ? `<p class="klein">Meldingen van de laatste update: ${data.prijsFouten.map(esc).join('; ')}</p>` : ''}
      <p class="klein"><b>Tarieven overheid/netbeheer:</b> peildatum ${datumNL(data.tarieven.peildatum)}. <b>App-gegevens geladen:</b> ${data.geladen ? datumNL(data.geladen) : 'uit cache (offline)'}</p>
      ${data.fout ? `<p class="klein" style="color:var(--fout)">${esc(data.fout)}</p>` : ''}
      <div class="knoppen"><button class="knop" id="vernieuw">Vernieuwen</button>${repoUrl() ? `<a class="knop licht" href="${esc(repoUrl())}/actions/workflows/dagelijks.yml" target="_blank" rel="noopener">Nu prijzen ophalen (GitHub)</a>` : ''}</div>
      <p class="klein">‘Vernieuwen’ laadt de nieuwste gegevens die de dagelijkse taak heeft opgehaald. Wil je het nú opnieuw laten ophalen, start de taak op GitHub met ‘Run workflow’ en vernieuw na ±2 minuten.</p>
    </div>
   </div>
  </div>`;
  $('#vernieuw').onclick = () => laadData(true);
  el.querySelectorAll('[data-ga]').forEach((k) => (k.onclick = () => ga(k.dataset.ga)));
  if (nu) tekenKoers($('#koers'));
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
    const x = (i) => 4 + (i / Math.max(1, ps.length - 1)) * (W - 8), y = (p) => H - 18 - ((p - mn) / (mx - mn)) * (H - 30);
    const nuI = k.findIndex((v) => Date.parse(v.t) > Date.now()) - 1;
    const pad = ps.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p).toFixed(1)}`).join('');
    svg.innerHTML = `<line x1="0" x2="${W}" y1="${y(0)}" y2="${y(0)}" stroke="var(--lijn)"/><path d="${pad}" fill="none" stroke="var(--ink)" stroke-width="1.6"/>
      ${nuI >= 0 ? `<circle cx="${x(nuI)}" cy="${y(ps[nuI])}" r="4" fill="var(--accent)"/>` : ''}
      <text x="4" y="${H - 3}" font-size="11" fill="var(--zacht)">${esc(datumNL(k[0].t))}</text><text x="${W - 4}" y="${H - 3}" font-size="11" fill="var(--zacht)" text-anchor="end">max ${euro(mx, 2)}</text>`;
  };
  const ro = new ResizeObserver(draw); ro.observe(box);
}

function regelsTabel(v) {
  const rows = v.delen.map((d) => `<tr><th colspan="3">${d.jaar}: ${datumNL(d.van)} – ${datumNL(d.tot)} ${d.tarieven.saldering ? '(met saldering)' : '(zonder saldering)'}</th></tr>` +
    d.regels.map((r) => `<tr><td>${esc(r.label)}<span class="uitleg">${esc(r.uitleg || '')}</span></td><td><span class="badge b-${r.soort}">${r.soort}</span></td><td class="bedrag">${euro(r.bedrag, 2)}</td></tr>`).join('')).join('') +
    v.eenmalig.map((r) => `<tr><td>${esc(r.label)}</td><td><span class="badge b-${r.soort}">${r.soort}</span></td><td class="bedrag">${euro(r.bedrag, 2)}</td></tr>`).join('');
  return `<table><tbody>${rows}<tr><th colspan="2">Totaal komende 12 maanden</th><th class="bedrag">${euro(v.totaal, 2)}</th></tr></tbody></table>
    <p class="klein">${Math.round(v.schattingAandeel * 100)}% van de bedragen is een schatting (vooral de beursprijzen). ‘Bevestigd’ = vastgestelde tarieven of door de leverancier gepubliceerd.</p>`;
}
function contractInfo(c) {
  const b = c.bron || {};
  return `${b.url ? `<p class="klein">Bron: <a href="${esc(b.url)}" target="_blank" rel="noopener">${esc(b.naam || b.url)}</a> (${esc(b.soort || 'handmatig')}, peildatum ${datumNL(b.datum)})</p>` : b.naam ? `<p class="klein">Bron: ${esc(b.naam)}</p>` : ''}
    ${c.onzeker?.length ? `<details><summary>Onzekerheden</summary><ul>${c.onzeker.map((x) => `<li class="klein">${esc(x)}</li>`).join('')}</ul></details>` : ''}
    ${c.toelichting ? `<p class="klein">${esc(c.toelichting)}</p>` : ''}`;
}
function renderVergelijken() {
  const el = $('#vergelijken'), A = laatste;
  if (!A || A.fout) { el.innerHTML = '<h2>Vergelijken</h2><p>Vul eerst je gegevens in.</p>'; return; }
  el.innerHTML = `<h2>Alle opties, komende 12 maanden</h2>
   <p class="klein">Periode ${datumNL(A.start)} t/m 12 maanden later (aangenomen overstapduur ${staat.instellingen.overstapDagen} dagen). Verbruik naar rato verdeeld over de dagen; seizoenseffecten zitten niet in de verdeling. Vanaf 1 januari 2027 is er geen saldering meer.</p>
   <div class="kaart"><div class="optie open" style="border:0"><button aria-expanded="true"><span><b>${esc(staat.huidig.naam)}</b><br><span class="klein">huidig contract</span></span><span class="bedrag"><b>${euro(A.basis.totaal)}</b></span></button><div class="detail">${regelsTabel(A.basis)}${contractInfo(staat.huidig)}</div></div></div>
   <div class="kaart">${A.rijen.map((r, i) => `<div class="optie" data-i="${i}"><button aria-expanded="false"><span><b>${esc(r.contract.naam)}</b><br><span class="klein">${esc(r.contract.type)} · zekerheid <span class="badge b-${r.zekerheid.niveau}">${r.zekerheid.niveau}</span></span></span>
     <span class="bedrag">${euro(r.totaal)}<br><span class="verschil ${r.besparing >= 0 ? 'pos' : 'neg'}">${r.besparing >= 0 ? 'bespaart ' : 'kost '}${euro(Math.abs(r.besparing))}</span></span></button>
     <div class="detail">${regelsTabel(r)}${contractInfo(r.contract)}<ul>${r.zekerheid.redenen.map((x) => `<li class="klein">${esc(x)}</li>`).join('')}</ul></div></div>`).join('') || '<p>Geen aanbiedingen. Voeg er een toe onder ‘Aanbod’.</p>'}</div>
   <div class="kaart"><h3 style="margin-top:0">Aannames</h3><ul class="klein">
     <li>${esc(A.markt.methode)}</li>
     <li>Gemiddelde beursprijs (incl. btw): afname ${euro(A.markt.afname * 1.21, 4)}, teruglevering ${euro(A.markt.terug * 1.21, 4)}, nacht (laden) ${euro(A.markt.nacht * 1.21, 4)}${A.markt.nachtGeschat ? ' (geschat)' : ''}, gas ${euro(A.markt.gas * 1.21, 4)}/m³.</li>
     <li>Alle dynamische leveranciers rekenen met dezelfde uurprijs van de beurs; het verschil zit in opslag, vaste kosten en de terugleverregeling.</li>
     <li>Netbeheerkosten en energiebelasting zijn bij elke leverancier gelijk. Netbeheer 2027 is nog een voorstel (de ACM besluit eind november 2026).</li>
     <li>Bij vaste en variabele contracten: ${Math.round((staat.profiel.aandeelDal ?? 0.5) * 100)}% van het verbruik in daltarief, laden tegen daltarief.</li>
     ${A.basis.delen.flatMap((d) => d.tarieven.bronnen || []).filter((b, i, s) => s.findIndex((x) => x.url === b.url) === i).map((b) => `<li><a href="${esc(b.url)}" target="_blank" rel="noopener">${esc(b.naam)}</a></li>`).join('')}
   </ul></div>`;
  el.querySelectorAll('.optie > button').forEach((k) => (k.onclick = () => { const o = k.parentElement; o.classList.toggle('open'); k.setAttribute('aria-expanded', o.classList.contains('open')); }));
}

// ---------- formulieren
const pakPad = (obj, pad) => pad.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
function zetPad(obj, pad, w) { const d = pad.split('.'); const l = d.pop(); let o = obj; for (const k of d) o = o[k] ??= {}; o[l] = w; }
function veld(pad, label, soort = 'getal', extra = {}) {
  const w = pakPad(staat, pad);
  const id = 'v-' + pad.replace(/\./g, '-');
  let input;
  if (soort === 'keuze') input = `<select id="${id}" data-pad="${pad}" data-soort="tekst">${extra.opties.map(([v, t]) => `<option value="${esc(v)}" ${v === w ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>`;
  else if (soort === 'aan') return `<div class="schakel"><input type="checkbox" id="${id}" data-pad="${pad}" data-soort="aan" ${w ? 'checked' : ''}><label for="${id}">${esc(label)}</label></div>`;
  else if (soort === 'lang') input = `<textarea id="${id}" data-pad="${pad}" data-soort="tekst" rows="3">${esc(w)}</textarea>`;
  else {
    const waarde = soort === 'pct' ? (w == null ? '' : Math.round(w * 1000) / 10) : w ?? '';
    const type = soort === 'datum' ? 'date' : soort === 'tekst' ? 'text' : 'number';
    input = `<input id="${id}" type="${type}" ${type === 'number' ? `inputmode="decimal" step="${extra.stap || 'any'}"` : ''} data-pad="${pad}" data-soort="${soort}" value="${esc(waarde)}" ${extra.ph ? `placeholder="${esc(extra.ph)}"` : ''}>`;
  }
  return `<div class="veld"><label for="${id}">${esc(label)}</label>${input}${extra.hint ? `<span class="klein">${esc(extra.hint)}</span>` : ''}</div>`;
}
function koppelVelden(root, naWijziging) {
  root.querySelectorAll('[data-pad]').forEach((inp) => {
    inp.onchange = () => {
      const s = inp.dataset.soort; let w;
      if (s === 'aan') w = inp.checked;
      else if (s === 'tekst' || s === 'datum') w = inp.value.trim() || null;
      else if (s === 'pct') w = inp.value === '' ? null : Number(inp.value.replace(',', '.')) / 100;
      else w = inp.value === '' ? null : Number(inp.value.replace(',', '.'));
      if (typeof w === 'number' && Number.isNaN(w)) { toast('Vul een getal in'); return; }
      zetPad(staat, inp.dataset.pad, w); bewaar(); (naWijziging || render)();
    };
  });
}

function renderGegevens() {
  const el = $('#gegevens'), h = staat.huidig, dyn = h.type === 'dynamisch';
  el.innerHTML = `<h2>Mijn gegevens</h2>
  <p class="klein">Alles hieronder wordt alleen in deze browser op dit toestel bewaard. Wijzigingen worden direct opgeslagen.</p>
  <form class="kaart" onsubmit="return false"><h3 style="margin-top:0">Verwacht verbruik per jaar</h3><div class="velden">
    ${veld('profiel.stroomAfname', 'Stroom van het net (kWh/jaar)', 'getal', { hint: 'Inclusief het laden van de auto.' })}
    ${veld('profiel.teruglevering', 'Teruglevering zonnepanelen (kWh/jaar)')}
    ${veld('profiel.gas', 'Gas (m³/jaar)', 'getal', { hint: '0 = geen gasaansluiting meerekenen.' })}
    ${veld('profiel.laadKwh', 'Laden auto, ’s nachts (kWh/jaar)', 'getal', { hint: '20 kWh per week ≈ 1.040 kWh per jaar.' })}
    ${veld('profiel.laadVergoeding', 'Vergoeding werkgever (€/kWh)', 'getal', { stap: '0.01' })}
    ${veld('profiel.aandeelDal', 'Aandeel daltarief (%)', 'pct', { hint: 'Alleen voor vaste/variabele contracten.' })}
  </div>${veld('profiel.toelichting', 'Notities', 'lang')}</form>

  <form class="kaart" onsubmit="return false"><h3 style="margin-top:0">Gemiddelde beursprijzen uit je jaarafrekening</h3>
  <p class="klein">Bij een dynamisch contract staan deze op de jaarafrekening (‘gemiddelde beursprijs’, incl. btw). De app schaalt ze met actuele beursdata.</p><div class="velden">
    ${veld('profiel.gerealiseerd.jaar', 'Jaar van de afrekening', 'getal', { stap: '1' })}
    ${veld('profiel.gerealiseerd.stroomAfnamePrijs', 'Stroom afname (€/kWh)')}
    ${veld('profiel.gerealiseerd.stroomTerugPrijs', 'Teruglevering (€/kWh)')}
    ${veld('profiel.gerealiseerd.gasPrijs', 'Gas (€/m³)')}
  </div></form>

  <form class="kaart" onsubmit="return false"><h3 style="margin-top:0">IJken op je kosten tot nu toe</h3>
  <p class="klein">Neem over uit de app van je leverancier. Dan rekent de app met jouw werkelijke prijsniveau van dit jaar. Laat ‘Kosten’ leeg om niet te ijken.</p><div class="velden">
    ${veld('profiel.ijking.datum', 'Stand op datum', 'datum')}
    ${veld('profiel.ijking.kosten', 'Kosten tot nu toe (€)')}
    ${veld('profiel.ijking.stroomAfname', 'Stroom van het net tot nu (kWh)')}
    ${veld('profiel.ijking.teruglevering', 'Teruglevering tot nu (kWh)')}
    ${veld('profiel.ijking.gas', 'Gas tot nu (m³)')}
    ${veld('profiel.ijking.laadKwh', 'Waarvan laden auto (kWh)')}
  </div>${laatste?.markt?.ijkFactor ? `<p class="klein">Resultaat: beursprijzen × ${laatste.markt.ijkFactor.toFixed(2).replace('.', ',')} t.o.v. je jaarafrekening.</p>` : ''}</form>

  <form class="kaart" onsubmit="return false"><h3 style="margin-top:0">Huidig contract</h3><div class="velden">
    ${veld('huidig.naam', 'Naam', 'tekst')}${veld('huidig.leverancier', 'Leverancier', 'tekst')}
    ${veld('huidig.type', 'Soort contract', 'keuze', { opties: [['dynamisch', 'Dynamisch'], ['vast', 'Vast'], ['variabel', 'Variabel']] })}
    ${dyn ? veld('huidig.stroom.opslag', 'Opslag stroom (€/kWh incl. btw)') + veld('huidig.gas.opslag', 'Opslag gas (€/m³ incl. btw)')
          : veld('huidig.stroom.tarief', 'Stroomtarief normaal (€/kWh, excl. energiebelasting)') + veld('huidig.stroom.tariefDal', 'Stroomtarief dal (€/kWh)') + veld('huidig.gas.tarief', 'Gastarief (€/m³, excl. energiebelasting)')}
    ${veld('huidig.stroom.vast', 'Vaste kosten stroom (€/maand)')}${veld('huidig.gas.vast', 'Vaste kosten gas (€/maand)')}
    ${veld('huidig.stroom.terugVergoeding', 'Extra terugleververgoeding (€/kWh)')}${veld('huidig.stroom.terugKosten', 'Terugleverkosten (€/kWh)')}
    ${veld('huidig.einddatum', 'Einddatum (leeg = onbepaalde tijd)', 'datum')}
    ${veld('huidig.opzegtermijn', 'Opzegtermijn', 'tekst')}${veld('huidig.opzegvergoeding', 'Opzegvergoeding bij overstap (€)')}
  </div>${contractInfo(h)}</form>

  <div class="kaart"><h3 style="margin-top:0">Back-up en overzetten</h3>
    <div class="knoppen"><label class="knop" for="impBestand" style="display:inline-flex;align-items:center">Bestand importeren</label><input type="file" id="impBestand" accept=".json,application/json" hidden>
    <button class="knop licht" id="kopieer">Kopieer back-up</button><button class="knop licht" id="download">Download back-up</button></div>
    <details><summary>Plak een back-up (JSON)</summary><textarea id="plakJson" rows="5" placeholder='{"type":"energie-overstap-profiel", ...}'></textarea><div class="knoppen"><button class="knop" id="plakKnop">Importeren</button></div></details>
    <details><summary>Alles wissen op dit toestel</summary><p class="klein">Verwijdert je gegevens uit deze browser. Maak eerst een back-up.</p><button class="knop licht" id="wis" style="border-color:var(--fout);color:var(--fout)">Wis mijn gegevens</button></details>
  </div>`;
  koppelVelden(el);
  $('#impBestand').onchange = (e) => importeerBestand(e.target.files[0]);
  $('#kopieer').onclick = () => kopieer(JSON.stringify(exportObject(), null, 1), 'Back-up gekopieerd');
  $('#download').onclick = () => download();
  $('#plakKnop').onclick = () => importeerTekst($('#plakJson').value);
  $('#wis').onclick = () => { if ($('#wis').dataset.zeker) { localStorage.removeItem(SLEUTEL); staat = nieuweStaat(); render(); toast('Gewist'); } else { $('#wis').dataset.zeker = 1; $('#wis').textContent = 'Tik nogmaals om te bevestigen'; } };
}

const LEEG_AANBOD = { naam: '', leverancier: '', type: 'dynamisch', stroom: { opslag: null, tarief: null, tariefDal: null, vast: null, terugVergoeding: 0, terugKosten: 0, terugBtw: true }, gas: { opslag: null, tarief: null, vast: null }, korting: 0, looptijdMnd: 0, geldigTot: null, bron: { naam: '', url: '', soort: 'handmatig', datum: null }, onzeker: [] };
let concept = null;
function renderAanbod() {
  const el = $('#aanbod'), lijst = aanbiedingen(), m = laatste?.markt;
  const kaart = (a) => {
    const z = m ? zekerheid(a, m, vandaag()) : null;
    const eigen = String(a.id).startsWith('eigen-');
    const d = a.type === 'dynamisch' ? `opslag ${euro(a.stroom.opslag ?? 0, 4)}/kWh · gas ${euro(a.gas?.opslag ?? 0, 4)}/m³` : `stroom ${euro(a.stroom.tarief ?? 0, 4)}/kWh · gas ${euro(a.gas?.tarief ?? 0, 4)}/m³`;
    return `<div class="optie"><div style="padding:12px 0"><b>${esc(a.naam)}</b> ${z ? `<span class="badge b-${z.niveau}">${z.niveau}</span>` : ''} ${a.verborgen ? '<span class="badge b-laag">verborgen</span>' : ''}<br>
      <span class="klein">${esc(a.type)} · ${d} · vast ${euro((a.stroom.vast || 0) + (a.gas?.vast || 0), 2)}/mnd · teruglevering ${a.stroom.terugVergoeding ? '+' + euro(a.stroom.terugVergoeding, 4) : ''}${a.stroom.terugKosten ? ' −' + euro(a.stroom.terugKosten, 4) : ''}${!a.stroom.terugVergoeding && !a.stroom.terugKosten ? (a.type === 'dynamisch' ? 'beursprijs' : 'geen vergoeding') : ''}${a.geldigTot ? ' · geldig t/m ' + datumNL(a.geldigTot) : ''}</span>
      ${contractInfo(a)}
      <div class="knoppen">${eigen ? `<button class="knop licht" data-bewerk="${esc(a.id)}">Bewerken</button><button class="knop licht" data-weg="${esc(a.id)}">Verwijderen</button>` : `<button class="knop licht" data-verberg="${esc(a.id)}">${a.verborgen ? 'Weer meenemen' : 'Niet meenemen'}</button><button class="knop licht" data-kopie="${esc(a.id)}">Kopiëren en aanpassen</button>`}</div></div></div>`;
  };
  const c = concept, cd = c && c.type === 'dynamisch';
  el.innerHTML = `<h2>Aanbiedingen</h2>
  <p class="klein">Er is geen openbare, toegestane bron die alle actuele contractaanbiedingen levert (vergelijkingssites verbieden automatisch uitlezen). Deze lijst wordt daarom handmatig bijgehouden, elk met bron en peildatum. Vind je een aanbod, bijvoorbeeld een vast contract of een welkomstkorting? Voeg het hier toe.</p>
  <div class="knoppen"><button class="knop accent" id="nieuw">Aanbieding toevoegen</button></div>
  ${c ? `<form class="kaart" id="conceptForm" onsubmit="return false"><h3 style="margin-top:0">${c.id ? 'Aanbieding bewerken' : 'Nieuwe aanbieding'}</h3><div class="velden">
    ${cveld('naam', 'Naam', 'tekst')}${cveld('leverancier', 'Leverancier', 'tekst')}
    ${cveld('type', 'Soort', 'keuze', [['dynamisch', 'Dynamisch'], ['vast', 'Vast'], ['variabel', 'Variabel']])}
    ${cd ? cveld('stroom.opslag', 'Opslag stroom (€/kWh incl. btw)') + cveld('gas.opslag', 'Opslag gas (€/m³ incl. btw)')
         : cveld('stroom.tarief', 'Stroom normaal (€/kWh incl. btw, excl. energiebelasting)') + cveld('stroom.tariefDal', 'Stroom dal (€/kWh, leeg = enkeltarief)') + cveld('gas.tarief', 'Gas (€/m³ incl. btw, excl. energiebelasting)')}
    ${cveld('stroom.vast', 'Vaste kosten stroom (€/maand)')}${cveld('gas.vast', 'Vaste kosten gas (€/maand)')}
    ${cveld('stroom.terugVergoeding', cd ? 'Extra vergoeding bovenop beursprijs (€/kWh)' : 'Terugleververgoeding (€/kWh)')}${cveld('stroom.terugKosten', 'Terugleverkosten (€/kWh)')}
    ${cveld('korting', 'Welkomstkorting (€, eenmalig)')}${cveld('looptijdMnd', 'Looptijd (maanden, 0 = onbepaald)')}
    ${cveld('geldigTot', 'Aanbod geldig tot', 'datum')}${cveld('bron.url', 'Link naar het aanbod', 'tekst')}
    ${cveld('bron.datum', 'Peildatum tarieven', 'datum')}
    ${cveld('bron.soort', 'Waar komt het vandaan?', 'keuze', [['leverancier', 'Website/aanbod van de leverancier'], ['handmatig', 'Eigen invoer / vergelijkingssite']])}
  </div><p class="klein">Bedragen zoals de leverancier ze toont, inclusief btw. Bij vaste en variabele contracten: tarief zónder energiebelasting (die rekent de app zelf). Staat de energiebelasting erin, trek dan voor 2027 €0,1065/kWh en €0,7457/m³ af.</p>
  <div class="knoppen"><button class="knop" id="bewaarConcept">Opslaan</button><button class="knop licht" id="annuleer">Annuleren</button></div></form>` : ''}
  <div class="kaart">${lijst.map(kaart).join('') || '<p>Nog geen aanbiedingen.</p>'}</div>
  <details class="kaart"><summary>Aanbiedingen importeren (JSON)</summary><p class="klein">Plak een lijst in hetzelfde formaat als <code>data/aanbiedingen.json</code>.</p><textarea id="aanbodJson" rows="4"></textarea><div class="knoppen"><button class="knop" id="aanbodImp">Importeren</button></div></details>`;
  $('#nieuw').onclick = () => { concept = kloon(LEEG_AANBOD); concept.bron.datum = vandaag(); renderAanbod(); $('#conceptForm')?.scrollIntoView({ behavior: 'smooth' }); };
  el.querySelectorAll('[data-verberg]').forEach((k) => (k.onclick = () => { const id = k.dataset.verberg; staat.verborgen = staat.verborgen.includes(id) ? staat.verborgen.filter((x) => x !== id) : [...staat.verborgen, id]; bewaar(); render(); }));
  el.querySelectorAll('[data-kopie]').forEach((k) => (k.onclick = () => { const a = lijst.find((x) => x.id === k.dataset.kopie); concept = { ...kloon(a), id: null, naam: a.naam + ' (eigen)', bron: { ...a.bron, soort: 'handmatig', datum: vandaag() } }; delete concept.verborgen; renderAanbod(); $('#conceptForm')?.scrollIntoView({ behavior: 'smooth' }); }));
  el.querySelectorAll('[data-bewerk]').forEach((k) => (k.onclick = () => { concept = kloon(staat.eigenAanbiedingen.find((x) => x.id === k.dataset.bewerk)); renderAanbod(); $('#conceptForm')?.scrollIntoView({ behavior: 'smooth' }); }));
  el.querySelectorAll('[data-weg]').forEach((k) => (k.onclick = () => { staat.eigenAanbiedingen = staat.eigenAanbiedingen.filter((x) => x.id !== k.dataset.weg); bewaar(); render(); }));
  if (c) {
    $('#conceptForm').querySelectorAll('[data-cpad]').forEach((inp) => (inp.onchange = () => {
      const s = inp.dataset.soort; let w = inp.value.trim();
      w = s === 'getal' ? (w === '' ? null : Number(w.replace(',', '.'))) : w || null;
      zetPad(concept, inp.dataset.cpad, w);
      if (inp.dataset.cpad === 'type') renderAanbod();
    }));
    $('#annuleer').onclick = () => { concept = null; renderAanbod(); };
    $('#bewaarConcept').onclick = () => {
      $('#conceptForm').querySelectorAll('[data-cpad]').forEach((i) => i.onchange());
      const k = concept, dy = k.type === 'dynamisch';
      if (!k.naam) return toast('Geef de aanbieding een naam');
      if (dy ? k.stroom.opslag == null : k.stroom.tarief == null) return toast(dy ? 'Vul de opslag stroom in' : 'Vul het stroomtarief in');
      if (staat.profiel.gas > 0 && (dy ? k.gas.opslag == null : k.gas.tarief == null)) return toast('Vul ook de gasprijs in (of zet je gasverbruik op 0)');
      if (!k.bron.naam) k.bron.naam = k.bron.url ? 'Aanbod ' + (k.leverancier || k.naam) : 'Eigen invoer';
      k.onzeker = k.onzeker || [];
      if (k.id) staat.eigenAanbiedingen = staat.eigenAanbiedingen.map((x) => (x.id === k.id ? k : x));
      else { k.id = 'eigen-' + Date.now(); staat.eigenAanbiedingen.push(k); }
      concept = null; bewaar(); render(); toast('Aanbieding opgeslagen');
    };
  }
  $('#aanbodImp').onclick = () => {
    try {
      const j = JSON.parse($('#aanbodJson').value); const l = Array.isArray(j) ? j : j.aanbiedingen;
      if (!Array.isArray(l)) throw new Error();
      l.forEach((a, i) => { if (!a.naam || !a.stroom) throw new Error(); staat.eigenAanbiedingen.push({ ...a, id: 'eigen-' + Date.now() + '-' + i }); });
      bewaar(); render(); toast(l.length + ' aanbieding(en) geïmporteerd');
    } catch { toast('Dit is geen geldige lijst met aanbiedingen'); }
  };
}
function cveld(pad, label, soort = 'getal', opties) {
  const w = pakPad(concept, pad), id = 'c-' + pad.replace(/\./g, '-');
  if (soort === 'keuze') return `<div class="veld"><label for="${id}">${esc(label)}</label><select id="${id}" data-cpad="${pad}" data-soort="tekst">${opties.map(([v, t]) => `<option value="${esc(v)}" ${v === w ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></div>`;
  return `<div class="veld"><label for="${id}">${esc(label)}</label><input id="${id}" type="${soort === 'datum' ? 'date' : soort === 'tekst' ? 'text' : 'number'}" ${soort === 'getal' ? 'inputmode="decimal" step="any"' : ''} data-cpad="${pad}" data-soort="${soort}" value="${esc(w ?? '')}"></div>`;
}

function renderMeer() {
  const el = $('#meer'), i = staat.instellingen;
  el.innerHTML = `<h2>Meldingen</h2>
  <form class="kaart" onsubmit="return false"><div class="velden">
    ${veld('instellingen.meldingen', 'Meldingen aan', 'aan')}${veld('instellingen.weekoverzicht', 'Elke maandag een kort weekoverzicht', 'aan')}
    ${veld('instellingen.drempel', 'Melden vanaf besparing (€/jaar)', 'getal', { stap: '10' })}
    ${veld('instellingen.dagenVoorEinde', 'Waarschuw zoveel dagen voor einde contract')}
    ${veld('instellingen.overstapDagen', 'Aangenomen duur van een overstap (dagen)')}
    ${veld('instellingen.repo', 'GitHub-repository (gebruiker/naam)', 'tekst', { ph: 'eric/energie-overstap' })}
  </div>
  <div class="veld"><label for="ntfy">Geheim meldingsonderwerp (ntfy)</label><div style="display:flex;gap:8px"><input id="ntfy" readonly value="${esc(i.ntfyOnderwerp || '')}" placeholder="nog niet aangemaakt"><button class="knop licht" id="maakNtfy" type="button">${i.ntfyOnderwerp ? 'Nieuw' : 'Maak aan'}</button></div>
  <span class="klein">Wie dit onderwerp kent, kan je meldingen lezen. Behandel het als een wachtwoord.</span></div>
  <div class="knoppen"><button class="knop accent" id="kopProfiel" type="button">Kopieer instellingen voor GitHub</button>${i.ntfyOnderwerp ? `<button class="knop licht" id="kopNtfy" type="button">Kopieer onderwerp</button>` : ''}</div>
  <p class="klein">Plak de gekopieerde tekst in GitHub als geheim <code>PROFIEL_JSON</code> (Settings → Secrets and variables → Actions). Doe dat opnieuw als je gegevens of instellingen hier wijzigt.</p></form>

  <div class="kaart"><h3 style="margin-top:0">Hoe meldingen werken</h3>
  <table class="stack"><thead><tr><th>Kanaal</th><th>Kosten</th><th>Privacy</th><th>Status</th></tr></thead><tbody>
   <tr><td><b>In de app</b></td><td>gratis</td><td>blijft op je toestel</td><td>altijd aan (bij openen)</td></tr>
   <tr><td><b>Push op iPhone via ntfy</b></td><td>gratis</td><td>tekst gaat via ntfy.sh; geen naam/adres</td><td>${i.ntfyOnderwerp ? 'ingesteld in de app; zet ook NTFY_TOPIC in GitHub' : 'nog niet ingesteld'}</td></tr>
   <tr><td><b>E-mail (via ntfy)</b></td><td>gratis, beperkt aantal per dag</td><td>e-mailadres gaat naar ntfy.sh</td><td>optioneel: geheim MELDING_EMAIL</td></tr>
   <tr><td><b>Sms / WhatsApp</b></td><td>betaald (bijv. Twilio, per bericht + WhatsApp-goedkeuring)</td><td>telefoonnummer naar betaalde dienst</td><td>niet geactiveerd</td></tr>
  </tbody></table>
  <p class="klein">Meldingen komen van de dagelijkse GitHub-taak: alleen bij een nieuwe of duidelijk betere overstapkans (≥ €25 meer dan de vorige melding, of na 30 dagen), als je contract bijna afloopt of als een aanbieding bijna verloopt. Er worden nooit berichten namens jou verstuurd.</p></div>

  <h2>Privacy en werking</h2>
  <div class="kaart klein">
   <p><b>Waar staan je gegevens?</b> Je verbruik en contract staan in de opslag van deze browser op dit toestel. Ze worden nergens heen gestuurd door de app. Voor de dagelijkse check zet je zelf een kopie (zonder naam, adres, EAN of rekeningnummer) als versleuteld geheim in je eigen GitHub-repository.</p>
   <p><b>Welke externe diensten krijgen iets?</b> GitHub (de app-bestanden en je geheim, versleuteld). Energy-Charts en EnergyZero ontvangen alleen datums voor de beursprijzen, vanaf GitHub, niet vanaf je telefoon. ntfy.sh ontvangt alleen de tekst van een melding.</p>
   <p><b>Let op:</b> de repository is openbaar (nodig voor gratis GitHub Pages). Daarin staan alleen de app, tarieven en beursprijzen, nooit jouw gegevens. De logboeken van de taak tonen geen bedragen.</p>
   <p><b>Zonder internet</b> werkt de app met de laatst geladen gegevens: invoeren, vergelijken en de berekening bekijken. <b>Met internet nodig:</b> nieuwe beursprijzen, bijgewerkte tarieven en aanbiedingen, en meldingen.</p>
   <p><b>Beursprijzen:</b> ${(data.prijzen?.bronnen || [{ naam: 'Energy-Charts (Fraunhofer ISE)', licentie: 'zie energy-charts.info' }, { naam: 'EnergyZero', licentie: 'openbare API' }]).map((b) => `${esc(b.naam)} (${esc(b.licentie || '')})`).join('; ')}.</p>
   <p>Geen financieel advies: de app maakt schattingen met de getoonde aannames. Controleer een aanbod altijd bij de leverancier voordat je overstapt.</p>
  </div>`;
  koppelVelden(el);
  $('#maakNtfy').onclick = () => { const b = new Uint8Array(12); crypto.getRandomValues(b); staat.instellingen.ntfyOnderwerp = 'energie-' + Array.from(b, (x) => x.toString(36).padStart(2, '0')).join('').slice(0, 20); bewaar(); render(); };
  $('#kopProfiel').onclick = () => kopieer(JSON.stringify(exportObject()), 'Gekopieerd. Plak dit als PROFIEL_JSON in GitHub.');
  if ($('#kopNtfy')) $('#kopNtfy').onclick = () => kopieer(i.ntfyOnderwerp, 'Onderwerp gekopieerd. Abonneer je erop in de ntfy-app en zet het als NTFY_TOPIC in GitHub.');
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
  catch { const t = document.createElement('textarea'); t.value = tekst; document.body.appendChild(t); t.select(); try { document.execCommand('copy'); toast(melding); } catch { toast('Kopiëren lukt niet; gebruik Download.'); } t.remove(); }
}
function download() {
  const blob = new Blob([JSON.stringify(exportObject(), null, 1)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'energie-overstap-backup-' + vandaag() + '.json';
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
function repoUrl() {
  const r = staat.instellingen.repo;
  if (r && /^[\w.-]+\/[\w.-]+$/.test(r)) return 'https://github.com/' + r;
  const m = location.hostname.match(/^([\w-]+)\.github\.io$/);
  const pad = location.pathname.split('/').filter(Boolean)[0];
  return m && pad ? `https://github.com/${m[1]}/${pad}` : null;
}

// ---------- navigatie en algemeen
function ga(tab) {
  document.querySelectorAll('section.scherm').forEach((s) => s.classList.toggle('actief', s.id === tab));
  document.querySelectorAll('nav.tabs button').forEach((b) => b.setAttribute('aria-current', b.dataset.tab === tab));
  try { history.replaceState(null, '', '#' + tab); } catch {}
  window.scrollTo(0, 0);
}
let toastTimer;
function toast(t) { const el = $('#toast'); el.textContent = t; el.classList.add('zicht'); clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('zicht'), 2600); }

document.querySelectorAll('nav.tabs button').forEach((b) => (b.onclick = () => ga(b.dataset.tab)));
addEventListener('online', () => laadData()); addEventListener('offline', render);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && data.geladen && Date.now() - Date.parse(data.geladen) > 3600e3) laadData(); });
const start = location.hash.slice(1);
if (['overzicht', 'vergelijken', 'gegevens', 'aanbod', 'meer'].includes(start)) ga(start);
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
laadData();
}
