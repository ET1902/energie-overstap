import test from 'node:test';
import assert from 'node:assert/strict';
import { kostenPeriode, periodes, vergelijkContract, analyse, ijkFactor, bepaalMarkt, zekerheid } from '../calc.js';
import { ANWB_DYNAMISCH } from '../standaard.js';
import fs from 'node:fs';
const T = JSON.parse(fs.readFileSync(new URL('../data/tarieven.json', import.meta.url)));
const A = JSON.parse(fs.readFileSync(new URL('../data/aanbiedingen.json', import.meta.url))).aanbiedingen;

// Fictief testhuishouden (geen echte gegevens)
const P = { stroomAfname: 4000, teruglevering: 2000, gas: 500, laadKwh: 0, laadVergoeding: 0, aandeelDal: 0.5,
  gerealiseerd: { jaar: 2025, stroomAfnamePrijs: 0.121, stroomTerugPrijs: 0.0484, gasPrijs: 0.4840 } };
const M = { afname: 0.10, terug: 0.04, nacht: 0.08, gas: 0.40, nachtGeschat: false };
const som = (r) => r.reduce((a, x) => a + x.bedrag, 0);
const t27 = { ...T.jaren['2027'] }, t26 = { ...T.jaren['2026'] };

test('periodes splitst over de jaargrens', () => {
  const p = periodes('2026-12-15');
  assert.equal(p.length, 2);
  assert.equal(p[0].jaar, 2026); assert.equal(p[1].jaar, 2027);
  assert.ok(Math.abs(p[0].fractie + p[1].fractie - 1) < 0.01);
});

test('dynamisch 2027 zonder saldering, handmatig nagerekend', () => {
  const r = kostenPeriode(ANWB_DYNAMISCH, P, M, t27, 1);
  const verwacht =
    4000 * (0.10 * 1.21 + 0.018) + 4000 * t27.ebStroom   // afname
    - 2000 * (0.04 * 1.21)                               // teruglevering alleen beurs
    + 500 * (0.40 * 1.21 + 0.05911) + 500 * t27.ebGas + 500 * t27.groenGas
    + 12 * 17 + t27.netStroom + t27.netGas - t27.vermindering;
  assert.ok(Math.abs(som(r) - verwacht) < 0.05, `${som(r)} ≠ ${verwacht}`);
  assert.ok(!r.some((x) => x.label.startsWith('Saldering')));
});

test('saldering 2026 geeft energiebelasting + opslag terug over min(afname, terug)', () => {
  const zonder = som(kostenPeriode(ANWB_DYNAMISCH, P, M, { ...t26, saldering: false }, 1));
  const met = som(kostenPeriode(ANWB_DYNAMISCH, P, M, t26, 1));
  assert.ok(Math.abs((zonder - met) - 2000 * (t26.ebStroom + 0.018)) < 0.05);
});

test('vast contract: terugleverkosten over alle teruglevering, vergoeding na 2027 over alles', () => {
  const vast = A.find((a) => a.type === 'vast');
  const r = kostenPeriode(vast, P, M, t27, 1);
  const tk = r.find((x) => x.label === 'Terugleverkosten').bedrag;
  const tv = r.find((x) => x.label === 'Terugleververgoeding').bedrag;
  assert.equal(tk, +(2000 * vast.stroom.terugKosten).toFixed(2));
  assert.equal(tv, -(2000 * vast.stroom.terugVergoeding).toFixed(2));
});

test('laden auto: nachtprijs bij dynamisch, vergoeding werkgever als opbrengst', () => {
  const p = { ...P, laadKwh: 1000, laadVergoeding: 0.43 };
  const r = kostenPeriode(ANWB_DYNAMISCH, p, M, t27, 1);
  assert.equal(r.find((x) => x.label.startsWith('Stroom: laden')).bedrag, +(1000 * (0.08 * 1.21 + 0.018)).toFixed(2));
  assert.equal(r.find((x) => x.label.startsWith('Vergoeding werkgever')).bedrag, -430);
});

test('besparing = verschil in totalen; opzegvergoeding telt bij alternatief', () => {
  const huidig = { ...ANWB_DYNAMISCH, opzegvergoeding: 50 };
  const res = analyse({ profiel: P, huidig, aanbiedingen: A, prijzen: null, tarieven: T, instellingen: { drempel: 100 }, vandaagISO: '2026-11-24' });
  for (const r of res.rijen) {
    assert.ok(Math.abs(res.basis.totaal - r.totaal - r.besparing) < 0.02);
    assert.ok(r.eenmalig.some((e) => e.bedrag === 50));
  }
});

test('ijking reproduceert de opgegeven kosten', () => {
  const ij = { datum: '2026-07-01', vanaf: '2026-01-01', kosten: 900, stroomAfname: 2000, teruglevering: 1000, gas: 300, laadKwh: 0 };
  const basis = bepaalMarkt(P, null);
  const k = ijkFactor(ij, P, ANWB_DYNAMISCH, basis, T);
  const f = (new Date('2026-07-01') - new Date('2026-01-01')) / 86400000 / 365;
  const p = { ...P, stroomAfname: 2000 / f, teruglevering: 1000 / f, gas: 300 / f };
  const m = { ...basis, afname: basis.afname * k, terug: basis.terug * k, gas: basis.gas * k, nacht: basis.nacht * k };
  assert.ok(Math.abs(som(kostenPeriode(ANWB_DYNAMISCH, p, m, t26, f)) - 900) < 0.5);
});

test('zekerheid daalt bij derde bron en oude tarieven', () => {
  const z = zekerheid({ bron: { soort: 'derde', datum: '2026-01-01' } }, { peildatum: null }, '2026-11-24');
  assert.equal(z.niveau, 'laag');
  const h = zekerheid({ bron: { soort: 'leverancier', datum: '2026-11-20' } }, { peildatum: '2026-11-24' }, '2026-11-24');
  assert.equal(h.niveau, 'hoog');
});

test('verlopen aanbiedingen worden niet meegenomen', () => {
  const a = [{ ...A[0], geldigTot: '2026-11-01' }];
  const res = analyse({ profiel: P, huidig: ANWB_DYNAMISCH, aanbiedingen: a, prijzen: null, tarieven: T, instellingen: {}, vandaagISO: '2026-11-24' });
  assert.equal(res.rijen.length, 0);
});

import { verschil, controleerContract } from '../calc.js';
test('uitsplitsing per kostensoort telt op tot de besparing', () => {
  const res = analyse({ profiel: { ...P, laadKwh: 800, laadVergoeding: 0.43 }, huidig: ANWB_DYNAMISCH, aanbiedingen: A, prijzen: null, tarieven: T, instellingen: {}, vandaagISO: '2026-11-24' });
  for (const r of res.rijen) {
    const som = verschil(res.basis, r).reduce((a, x) => a + x.bedrag, 0);
    assert.ok(Math.abs(som - r.besparing) < 1.5, `${r.contract.naam}: ${som} vs ${r.besparing}`);
  }
});
test('Zonnebonus: 10% over beurs + vergoeding', () => {
  const zp = A.find((a) => a.id === 'zonneplan');
  const r = kostenPeriode(zp, P, M, t27, 1).find((x) => x.label.startsWith('Teruglevering'));
  const per = (0.04 * 1.21 + 0.02) * 1.10;
  assert.ok(Math.abs(r.bedrag + 2000 * per) < 0.05);
});
test('onvolledig contract wordt gemeld en niet berekend', () => {
  assert.deepEqual(controleerContract({ type: 'vast', stroom: {}, gas: {} }, P), ['stroomtarief', 'gastarief']);
  const res = analyse({ profiel: P, huidig: { ...ANWB_DYNAMISCH, type: 'vast' }, aanbiedingen: A, prijzen: null, tarieven: T, instellingen: {}, vandaagISO: '2026-11-24' });
  assert.ok(res.fout && res.fout.includes('stroomtarief'));
});
