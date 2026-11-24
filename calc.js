// Rekenmodel energiekosten — puur, zonder DOM. Gebruikt door de app én door de GitHub Actions-check.
// Alle bedragen in euro. Beursprijzen in de markt-invoer zijn EXCL. btw; tarieven van aanbiedingen INCL. btw.

export const BTW = 0.21;
const r2 = (x) => Math.round(x * 100) / 100;
const DAG = 86400000;

/** Kies de tarieventabel (energiebelasting, netbeheer, saldering) voor een jaar. */
export function tarievenVoorJaar(tarieven, jaar) {
  const t = tarieven.jaren[String(jaar)];
  if (t) return { ...t, jaar };
  // Onbekend jaar: neem het laatst bekende jaar en markeer als schatting.
  const jaren = Object.keys(tarieven.jaren).map(Number).sort((a, b) => a - b);
  const laatste = jaren[jaren.length - 1];
  return { ...tarieven.jaren[String(laatste)], jaar, geschat: true, saldering: jaar < 2027 ? true : false };
}

/** Marktprijzen (excl. btw) die voor de berekening worden aangenomen. */
export function bepaalMarkt(profiel, prijzen, huidig, tarieven) {
  const basis = profiel.gerealiseerd; // uit jaarafrekening, incl. btw
  const out = {
    afname: basis.stroomAfnamePrijs / (1 + BTW),
    terug: basis.stroomTerugPrijs / (1 + BTW),
    nacht: basis.stroomAfnamePrijs / (1 + BTW),
    gas: basis.gasPrijs / (1 + BTW),
    methode: 'Jouw gemiddelde beursprijzen uit de jaarafrekening ' + basis.jaar + ' (geen actuele koersdata beschikbaar).',
    nachtGeschat: true,
    peildatum: null,
    bron: 'Jaarafrekening ' + basis.jaar,
  };
  const s = prijzen && prijzen.stroom;
  const ref = s && s.jaren && s.jaren[basis.jaar];
  if (s && s.gem12m && ref) {
    const fv = s.gem12m.verbruik / ref.verbruik, fz = s.gem12m.zon / ref.zon;
    out.afname = out.afname * fv;
    out.terug = out.terug * fz;
    out.nacht = s.gem12m.nacht; out.nachtGeschat = false;
    out.methode = `Jouw gemiddelden uit ${basis.jaar}, geschaald met de beursprijzen van de afgelopen 12 maanden t.o.v. ${basis.jaar} (verbruiksprofiel ×${nl(fv, 2)}, zonprofiel ×${nl(fz, 2)}).`;
    out.peildatum = prijzen.bijgewerkt;
    out.bron = (prijzen.bronnen || []).map((b) => b.naam).join(' + ');
  } else if (s && s.gem12m) {
    out.nacht = s.gem12m.nacht * (out.afname / s.gem12m.verbruik); out.nachtGeschat = true;
  }
  const g = prijzen && prijzen.gas;
  const gref = g && g.jaren && g.jaren[basis.jaar];
  if (g && g.gem12m && gref && gref.gem) out.gas = out.gas * (g.gem12m / gref.gem);
  // IJking op de stand in de app van je leverancier heeft voorrang: dat zijn jouw echte kosten dit jaar.
  const ij = profiel.ijking;
  if (ij && ij.kosten > 0 && ij.datum && huidig && tarieven) {
    const basisMarkt = { ...out, afname: basis.stroomAfnamePrijs / (1 + BTW), terug: basis.stroomTerugPrijs / (1 + BTW), gas: basis.gasPrijs / (1 + BTW), nacht: basis.stroomAfnamePrijs / (1 + BTW) };
    const k = ijkFactor(ij, profiel, huidig, basisMarkt, tarieven);
    if (k && k > 0.3 && k < 4) {
      const nachtRatio = s && s.gem12m ? s.gem12m.nacht / s.gem12m.verbruik : 1;
      out.afname = basisMarkt.afname * k; out.terug = basisMarkt.terug * k; out.gas = basisMarkt.gas * k;
      out.nacht = out.afname * nachtRatio;
      out.ijkFactor = k;
      out.methode = `Geijkt op jouw werkelijke kosten volgens ${huidig.leverancier || 'je leverancier'} (€${ij.kosten} t/m ${ij.datum}): beursprijzen uit ${basis.jaar} × ${nl(k, 2)}.` + (s && s.gem12m ? ' Nachtprijs-verhouding uit actuele beursdata.' : ' Nachtprijs gelijk aan gemiddelde (geen beursdata).');
      out.peildatum = out.peildatum || ij.datum;
    }
  }
  return out;
}

/** Zoekt de factor op de beursprijzen waarmee het model jouw werkelijke kosten tot nu toe reproduceert. */
export function ijkFactor(ij, profiel, huidig, markt, tarieven) {
  const van = new Date((ij.vanaf || ij.datum.slice(0, 4) + '-01-01') + 'T00:00:00Z');
  const tot = new Date(ij.datum + 'T00:00:00Z');
  const f = (tot - van) / DAG / 365;
  if (f <= 0.05) return null;
  const p = { ...profiel, stroomAfname: ij.stroomAfname / f, teruglevering: ij.teruglevering / f, gas: ij.gas / f, laadKwh: (ij.laadKwh || 0) / f, laadVergoeding: 0 };
  const t = tarievenVoorJaar(tarieven, tot.getUTCFullYear());
  const som = (k) => kostenPeriode(huidig, p, { ...markt, afname: markt.afname * k, terug: markt.terug * k, gas: markt.gas * k, nacht: markt.nacht * k }, t, f).reduce((a, r) => a + r.bedrag, 0);
  const a = som(0), b = som(1) - a;
  if (Math.abs(b) < 1) return null;
  return (ij.kosten - a) / b;
}

/** Splits de horizon (12 maanden vanaf start) in stukken per kalenderjaar. */
export function periodes(startISO, maanden = 12) {
  const start = new Date(startISO + 'T00:00:00Z');
  const eind = new Date(start); eind.setUTCMonth(eind.getUTCMonth() + maanden);
  const out = [];
  let van = start;
  while (van < eind) {
    const jaarEind = new Date(Date.UTC(van.getUTCFullYear() + 1, 0, 1));
    const tot = jaarEind < eind ? jaarEind : eind;
    out.push({ jaar: van.getUTCFullYear(), van: van.toISOString().slice(0, 10), tot: tot.toISOString().slice(0, 10), fractie: (tot - van) / DAG / 365 });
    van = tot;
  }
  return out;
}

/**
 * Kosten van één contract over één periode.
 * Geeft regels terug met label, bedrag (+ = kosten, − = opbrengst) en soort ('bevestigd' | 'schatting').
 */
export function kostenPeriode(contract, profiel, markt, t, fractie) {
  const f = fractie;
  const afname = profiel.stroomAfname * f;
  const laad = Math.min(profiel.laadKwh || 0, profiel.stroomAfname) * f;
  const huis = afname - laad;
  const terug = profiel.teruglevering * f;
  const gas = profiel.gas * f;
  const S = contract.stroom, G = contract.gas || {};
  const dyn = contract.type === 'dynamisch' || contract.type === 'huidig-dynamisch';
  const bronSoort = contract.bron && contract.bron.soort === 'leverancier' ? 'bevestigd' : 'schatting';
  const regels = [];
  const add = (label, bedrag, soort, uitleg) => regels.push({ label, bedrag: r2(bedrag), soort, uitleg });

  // --- Stroom: afname
  let prijsHuis, prijsLaad;
  if (dyn) {
    prijsHuis = markt.afname * (1 + BTW) + S.opslag;
    prijsLaad = markt.nacht * (1 + BTW) + S.opslag;
    add('Stroom: beursprijs + opslag', huis * prijsHuis, 'schatting', `${fmtK(huis)} × €${nl(prijsHuis, 4)} (beurs ${fmt4(markt.afname * (1 + BTW))} + opslag ${fmt4(S.opslag)})`);
    if (laad > 0) add('Stroom: laden auto ’s nachts', laad * prijsLaad, 'schatting', `${fmtK(laad)} × €${nl(prijsLaad, 4)} (nachtprijs${markt.nachtGeschat ? ', geschat' : ''})`);
  } else {
    const dal = S.tariefDal ?? S.tarief, norm = S.tarief;
    const aandeelDal = profiel.aandeelDal ?? 0.5;
    prijsHuis = norm * (1 - aandeelDal) + dal * aandeelDal;
    prijsLaad = dal;
    add('Stroom: leveringstarief', huis * prijsHuis + laad * prijsLaad, bronSoort, `${fmtK(huis)} × €${nl(prijsHuis, 4)}${laad ? ` + ${fmtK(laad)} × €${nl(dal, 4)} (dal)` : ''}`);
  }
  add('Energiebelasting stroom', afname * t.ebStroom, 'bevestigd', `${fmtK(afname)} × €${nl(t.ebStroom, 5)}`);

  // --- Teruglevering
  const salderbaar = t.saldering ? Math.min(afname, terug) : 0;
  const overschot = terug - salderbaar;
  if (dyn) {
    const terugBeurs = markt.terug * (S.terugBtw === false ? 1 : 1 + BTW);
    const perKwh = terugBeurs + (S.terugVergoeding || 0) - (S.terugKosten || 0);
    add('Teruglevering: beursprijs', -terug * perKwh, 'schatting', `${fmtK(terug)} × €${nl(perKwh, 4)} (beurs ${fmt4(terugBeurs)}${S.terugVergoeding ? ' + vergoeding ' + fmt4(S.terugVergoeding) : ''}${S.terugKosten ? ' − kosten ' + fmt4(S.terugKosten) : ''})`);
    if (salderbaar > 0) add('Saldering: energiebelasting + opslag terug', -salderbaar * (t.ebStroom + S.opslag), 'bevestigd', `${fmtK(salderbaar)} × €${nl((t.ebStroom + S.opslag), 4)} (alleen t/m 31-12-2026)`);
  } else {
    if (salderbaar > 0) add('Saldering (verrekend tegen tarief + belasting)', -salderbaar * (prijsHuis + t.ebStroom), bronSoort, `${fmtK(salderbaar)} × €${nl((prijsHuis + t.ebStroom), 4)} (alleen t/m 31-12-2026)`);
    const telt = t.saldering ? overschot : terug;
    if (S.terugVergoeding) add('Terugleververgoeding', -telt * S.terugVergoeding, bronSoort, `${fmtK(telt)} × €${nl(S.terugVergoeding, 4)}`);
  }
  if (!dyn && S.terugKosten) add('Terugleverkosten', terug * S.terugKosten, bronSoort, `${fmtK(terug)} × €${nl(S.terugKosten, 4)}`);

  // --- Gas
  if (profiel.gas > 0) {
    if (dyn) {
      const p = markt.gas * (1 + BTW) + (G.opslag || 0);
      add('Gas: beursprijs + opslag', gas * p, 'schatting', `${fmtK(gas, 'm³')} × €${nl(p, 4)}`);
    } else {
      add('Gas: leveringstarief', gas * G.tarief, bronSoort, `${fmtK(gas, 'm³')} × €${nl(G.tarief, 4)}`);
    }
    add('Energiebelasting gas', gas * t.ebGas, 'bevestigd', `${fmtK(gas, 'm³')} × €${nl(t.ebGas, 5)}`);
    if (t.groenGas) add('Bijmengverplichting groen gas', gas * t.groenGas, 'schatting', `${fmtK(gas, 'm³')} × €${nl(t.groenGas, 3)} (verwachting kabinet)`);
  }

  // --- Vaste kosten
  const mnd = 12 * f;
  add('Vaste leveringskosten', mnd * ((S.vast || 0) + (profiel.gas > 0 ? G.vast || 0 : 0)), bronSoort, `${nl(mnd, 1)} mnd × €${nl(((S.vast || 0) + (profiel.gas > 0 ? G.vast || 0 : 0)), 2)}`);
  add('Netbeheerkosten (Enexis)', (t.netStroom + (profiel.gas > 0 ? t.netGas : 0)) * f, t.netDefinitief ? 'bevestigd' : 'schatting', t.netDefinitief ? 'definitief tarief' : 'voorstel netbeheerder, nog niet definitief');
  add('Vermindering energiebelasting', -t.vermindering * f, 'bevestigd', `€${nl(t.vermindering, 2)} per jaar`);
  if (laad > 0 && profiel.laadVergoeding) add('Vergoeding werkgever laden', -laad * profiel.laadVergoeding, 'bevestigd', `${fmtK(laad)} × €${nl(profiel.laadVergoeding, 2)}`);

  return regels;
}

/** Totale kosten voor de horizon, inclusief eenmalige posten. */
export function vergelijkContract(contract, profiel, markt, tarieven, startISO, opties = {}) {
  const per = periodes(startISO, opties.maanden || 12);
  const delen = per.map((p) => {
    const t = tarievenVoorJaar(tarieven, p.jaar);
    return { ...p, tarieven: t, regels: kostenPeriode(contract, profiel, markt, t, p.fractie) };
  });
  const eenmalig = [];
  if (contract.korting) eenmalig.push({ label: 'Welkomstkorting', bedrag: -contract.korting, soort: contract.bron?.soort === 'leverancier' ? 'bevestigd' : 'schatting' });
  if (opties.overstapKosten) eenmalig.push({ label: 'Opzegvergoeding huidig contract', bedrag: opties.overstapKosten, soort: 'bevestigd' });
  const totaal = r2(delen.reduce((s, d) => s + d.regels.reduce((a, r) => a + r.bedrag, 0), 0) + eenmalig.reduce((a, r) => a + r.bedrag, 0));
  const schattingAandeel = (() => {
    const all = delen.flatMap((d) => d.regels).concat(eenmalig);
    const abs = all.reduce((a, r) => a + Math.abs(r.bedrag), 0) || 1;
    return all.filter((r) => r.soort !== 'bevestigd').reduce((a, r) => a + Math.abs(r.bedrag), 0) / abs;
  })();
  return { contract, delen, eenmalig, totaal, schattingAandeel, geschatteTarieven: delen.some((d) => d.tarieven.geschat) };
}

/** Hoe betrouwbaar is de vergelijking voor deze aanbieding? */
export function zekerheid(contract, markt, vandaagISO) {
  const redenen = [];
  let punten = 3;
  const b = contract.bron || {};
  if (b.soort === 'leverancier') redenen.push('Tarieven van de leverancier zelf.');
  else if (b.soort === 'derde') { punten -= 1; redenen.push('Tarieven via een derde partij, niet bij de leverancier gecontroleerd.'); }
  else { punten -= 1; redenen.push('Handmatig ingevoerd.'); }
  if (b.datum) {
    const dagen = (new Date(vandaagISO) - new Date(b.datum)) / DAG;
    if (dagen > 60) { punten -= 1; redenen.push(`Tarieven zijn ${Math.round(dagen)} dagen oud.`); }
  } else { punten -= 1; redenen.push('Peildatum onbekend.'); }
  if (contract.onzeker && contract.onzeker.length) { punten -= 1; redenen.push(...contract.onzeker); }
  if (!markt.peildatum) { punten -= 1; redenen.push('Geen actuele beursprijzen; gerekend met jouw prijzen van vorig jaar.'); }
  const niveau = punten >= 3 ? 'hoog' : punten >= 2 ? 'middel' : 'laag';
  return { niveau, redenen };
}

/** Volledige vergelijking: huidig contract tegen alle aanbiedingen. */
export function analyse({ profiel, huidig, aanbiedingen, prijzen, tarieven, instellingen, vandaagISO }) {
  const markt = bepaalMarkt(profiel, prijzen, huidig, tarieven);
  const start = startDatum(vandaagISO, instellingen?.overstapDagen ?? 21);
  const basis = vergelijkContract(huidig, profiel, markt, tarieven, start);
  const opzeg = huidig.opzegvergoeding || 0;
  const rijen = aanbiedingen.filter((a) => !a.verborgen && !verlopen(a, vandaagISO)).map((a) => {
    const v = vergelijkContract(a, profiel, markt, tarieven, start, { overstapKosten: opzeg });
    return { ...v, besparing: r2(basis.totaal - v.totaal), zekerheid: zekerheid(a, markt, vandaagISO) };
  }).sort((x, y) => y.besparing - x.besparing);
  const drempel = instellingen?.drempel ?? 100;
  const beste = rijen.find((r) => r.zekerheid.niveau !== 'laag') || rijen[0];
  let advies;
  if (!beste) advies = { soort: 'geen', tekst: 'Er zijn nog geen aanbiedingen om mee te vergelijken.' };
  else if (beste.besparing >= drempel) advies = { soort: 'overstappen', tekst: `Overstappen naar ${beste.contract.naam} bespaart naar schatting €${Math.round(beste.besparing)} in de komende 12 maanden.`, wanneer: wanneerTekst(huidig, start) };
  else if (beste.besparing > 0) advies = { soort: 'twijfel', tekst: `${beste.contract.naam} is naar schatting €${Math.round(beste.besparing)} goedkoper, onder jouw drempel van €${drempel}. Blijven is prima.` };
  else advies = { soort: 'blijven', tekst: 'Je huidige contract is in deze vergelijking het voordeligst. Blijven.' };
  return { markt, start, basis, rijen, beste, advies, drempel };
}

export function startDatum(vandaagISO, dagen) {
  const d = new Date(vandaagISO + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + dagen);
  return d.toISOString().slice(0, 10);
}
export function verlopen(a, vandaagISO) { return a.geldigTot && a.geldigTot < vandaagISO; }
function wanneerTekst(huidig, start) {
  if (huidig.einddatum) return `Je contract loopt tot ${huidig.einddatum}. Laat de overstap ingaan op of na die datum om opzegkosten te voorkomen.`;
  return `Je huidige contract is ${huidig.opzegtermijn || 'kort'} opzegbaar zonder boete. Een overstap kan dus direct; reken op ingang rond ${start}. De nieuwe leverancier zegt je oude contract voor je op.`;
}

/** Waarschuwingen voor op het startscherm en in de dagelijkse check. */
export function waarschuwingen({ huidig, aanbiedingen, prijzen, instellingen, vandaagISO, analyseResultaat }) {
  const out = [];
  const dagenTot = (iso) => Math.round((new Date(iso) - new Date(vandaagISO)) / DAG);
  const n = instellingen?.dagenVoorEinde ?? 60;
  if (huidig.einddatum) {
    const d = dagenTot(huidig.einddatum);
    if (d <= n) out.push({ soort: 'contract', ernst: d <= 14 ? 'hoog' : 'middel', tekst: `Je contract loopt over ${d} dagen af (${huidig.einddatum}).` });
  }
  for (const a of aanbiedingen) {
    if (a.verborgen || !a.geldigTot) continue;
    const d = dagenTot(a.geldigTot);
    if (d >= 0 && d <= 7) out.push({ soort: 'aanbod', ernst: 'middel', tekst: `Aanbieding ${a.naam} verloopt over ${d} dagen.` });
  }
  const sal = dagenTot('2027-01-01');
  if (sal > 0 && sal <= 90) out.push({ soort: 'info', ernst: 'middel', tekst: `De salderingsregeling stopt over ${sal} dagen (1 januari 2027). De vergelijking rekent daar al mee.` });
  const geijkt = analyseResultaat && analyseResultaat.markt.ijkFactor;
  if (!prijzen || !prijzen.bijgewerkt) out.push({ soort: 'data', ernst: geijkt ? 'laag' : 'middel', tekst: geijkt ? 'Nog geen actuele beursprijzen opgehaald; de berekening is geijkt op jouw kosten tot nu toe.' : 'Er zijn nog geen actuele beursprijzen opgehaald. De berekening gebruikt jouw prijzen uit de jaarafrekening.' });
  else if (dagenTot(prijzen.bijgewerkt.slice(0, 10)) < -3) out.push({ soort: 'data', ernst: 'middel', tekst: `Beursprijzen zijn voor het laatst bijgewerkt op ${prijzen.bijgewerkt.slice(0, 10)}.` });
  const oud = aanbiedingen.filter((a) => !a.verborgen && a.bron?.datum && dagenTot(a.bron.datum) < -60);
  if (oud.length) out.push({ soort: 'data', ernst: 'laag', tekst: `${oud.length} aanbieding(en) hebben tarieven ouder dan 60 dagen. Controleer ze bij de leverancier.` });
  const A = analyseResultaat;
  if (A && A.advies.soort === 'overstappen') out.unshift({ soort: 'kans', ernst: 'hoog', tekst: A.advies.tekst });
  return out;
}

function fmtK(x, eenheid = 'kWh') { return `${Math.round(x).toLocaleString('nl-NL')} ${eenheid}`; }
function fmt4(x) { return '€' + nl(x, 4); }
function nl(x, d) { return Number(x).toFixed(d).replace('.', ','); }
