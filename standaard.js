// Standaardwaarden zonder persoonsgegevens. Jouw eigen cijfers staan alleen op je eigen toestel.

export const LEEG_PROFIEL = {
  stroomAfname: 0,          // kWh per jaar van het net (incl. laden auto)
  teruglevering: 0,         // kWh per jaar terug aan het net
  gas: 0,                   // m³ per jaar
  laadKwh: 0,               // kWh per jaar voor het laden van de auto ('s nachts)
  laadVergoeding: 0,        // € per kWh die je werkgever vergoedt
  aandeelDal: 0.5,          // deel van het verbruik in daltarief (voor vaste/variabele contracten)
  gerealiseerd: {           // gemiddelde beursprijzen van je dynamische jaarafrekening, incl. btw
    jaar: 2025, stroomAfnamePrijs: 0.12, stroomTerugPrijs: 0.05, gasPrijs: 0.5,
  },
  toelichting: '',
};

export const ANWB_DYNAMISCH = {
  id: 'huidig',
  naam: 'ANWB Energie dynamisch',
  leverancier: 'ANWB Energie',
  type: 'dynamisch',
  stroom: { opslag: 0.018, vast: 8.5, terugVergoeding: 0, terugKosten: 0, terugBtw: true },
  gas: { opslag: 0.05911, vast: 8.5 },
  einddatum: null,
  opzegtermijn: 'dagelijks',
  opzegvergoeding: 0,
  korting: 0,
  bron: { naam: 'ANWB Energie, tarieven vanaf 1-1-2026', url: 'https://www.anwb.nl/energie/dynamische-energiecontracten-vergelijken', soort: 'leverancier', datum: '2026-11-24' },
  onzeker: ['ANWB heeft niet gepubliceerd of er vanaf 2027 iets bovenop de beursprijs voor teruglevering komt; gerekend met alleen de beursprijs (zoals op je jaarafrekening 2025).'],
};

export const STANDAARD_INSTELLINGEN = {
  drempel: 100,          // € besparing per jaar voordat je een melding krijgt
  dagenVoorEinde: 60,    // melding zoveel dagen voor einde contract
  overstapDagen: 21,     // aangenomen doorlooptijd van een overstap
  meldingen: true,
  standHerinnering: true, // op de 1e van de maand een herinnering om je stand bij te werken
  ntfyOnderwerp: '',     // geheim onderwerp voor pushmeldingen via ntfy.sh
  repo: '',              // bijv. eric/energie-overstap (voor de knop 'Nu bijwerken')
};
