# Energie overstap

Een privé-webapp (PWA) voor je iPhone en laptop. De app laat zien of en wanneer overstappen naar een andere energieleverancier loont. Hij rekent met je eigen verbruik, je teruglevering, het laden van je auto en het einde van de salderingsregeling op 1-1-2027. Bij elke uitkomst zie je de volledige berekening.

## Wat je nodig hebt (allemaal gratis)
- Een GitHub-account: <https://github.com/signup>
- Op de iPhone: Safari, en de app **ntfy** uit de App Store (voor pushmeldingen)

## Eenmalig installeren (±15 minuten)
1. **Repository maken.** Ga naar <https://github.com/new>. Noem de repository `energie-overstap`, kies **Public** en vink *Add a README* aan. Klik op *Create repository*.
   > Een openbare repository is nodig voor gratis GitHub Pages. Er komen géén persoonsgegevens in, zie ‘Privacy’.
2. **Bestanden uploaden.** Klik op *Add file → Upload files* en sleep alle bestanden en mappen uit de zip erin. Klik daarna op *Commit changes*.
   - De map `.github` is op een Mac verborgen en wordt vaak niet meegesleept. Controleer of `.github/workflows/dagelijks.yml` in de repository staat. Staat hij er niet, maak hem dan aan via *Add file → Create new file*: typ als naam `.github/workflows/dagelijks.yml`, plak de inhoud van dat bestand uit de zip en klik op *Commit changes*.
3. **Website aanzetten.** Ga naar *Settings → Pages*, kies bij *Source* voor *Deploy from a branch*, branch `main`, map `/ (root)`, en klik op *Save*. Na ongeveer een minuut staat je app op `https://<jouw-gebruikersnaam>.github.io/energie-overstap/`.
4. **Schrijfrechten voor de dagelijkse taak.** Ga naar *Settings → Actions → General → Workflow permissions*, kies *Read and write permissions* en klik op *Save*.
5. **App op je iPhone zetten.** Open het adres uit stap 3 in Safari, tik op het deelicoon en kies *Zet op beginscherm*.
6. **Je gegevens laden.** Zet het bestand `profiel-eric.json` op je iPhone, bijvoorbeeld via AirDrop of iCloud Drive. Tik in de app op *Profielbestand openen* en kies het bestand. Je kunt ook alles zelf invullen onder *Gegevens*.
7. **Meldingen instellen.**
   - In de app: ga naar *Meldingen* en tik op **Maak aan** om een geheim meldingsonderwerp te maken. Tik daarna op **Kopieer onderwerp**.
   - In de ntfy-app op je iPhone: tik op **+**, plak het onderwerp en sta meldingen toe.
   - In GitHub: ga naar *Settings → Secrets and variables → Actions → New repository secret* en maak deze geheimen aan:

     | Naam | Waarde |
     |---|---|
     | `NTFY_TOPIC` | het onderwerp dat je net kopieerde |
     | `PROFIEL_JSON` | tik in de app op **Kopieer instellingen voor GitHub** en plak het resultaat |
     | `MELDING_EMAIL` (optioneel) | je e-mailadres, als je meldingen ook per e-mail wilt ontvangen (via ntfy) |
8. **Eerste run.** Ga naar het tabblad *Actions*. Klik zo nodig op *I understand… enable*, kies **Dagelijkse energiecheck** en klik op **Run workflow**. Na ongeveer twee minuten zijn de beursprijzen opgehaald. Tik daarna in de app op **Vernieuwen**.

Vanaf dan draait de taak elke ochtend vanzelf.

## Dagelijks gebruik
- **Overzicht** toont het oordeel (overstappen, kleine winst of blijven), de geschatte besparing, de zekerheid, aandachtspunten en de actuele beursprijs.
- **Vergelijk** toont per contract de volledige berekening. Elke regel staat er met een label: *bevestigd* (vastgestelde tarieven) of *schatting* (vooral de beursprijzen).
- **Vernieuwen** laadt de nieuwste prijzen en tarieven. Wil je dat de prijzen nú opnieuw worden opgehaald, gebruik dan de knop *Nu prijzen ophalen (GitHub)* en daarna *Run workflow*.
- **Je gegevens wijzigen** doe je onder *Gegevens*. Wijzigingen worden direct opgeslagen. Kopieer daarna opnieuw *Kopieer instellingen voor GitHub* naar het geheim `PROFIEL_JSON`. Zo rekent de dagelijkse melding met dezelfde gegevens.
- **IJken:** vul af en toe de stand uit de ANWB-app in onder *Gegevens → IJken*: kosten en verbruik tot nu toe. Dan rekent de app met jouw werkelijke prijsniveau.
- **Aanbiedingen** voeg je toe onder *Aanbod*. Je kunt een bestaande kopiëren en aanpassen, of een nieuwe invullen met een link naar het aanbod en de peildatum.

## Wat automatisch gaat en wat niet
| Onderdeel | Automatisch? | Bron |
|---|---|---|
| Beursprijzen stroom (day-ahead NL) | ja, dagelijks | Energy-Charts (Fraunhofer ISE); reserve: EnergyZero |
| Beursprijs gas | ja, dagelijks | EnergyZero (de prijsbron van onder meer ANWB Energie) |
| Energiebelasting, netbeheerkosten | nee, 1× per jaar bijwerken in `data/tarieven.json` | Belastingplan, ACM/Enexis |
| Aanbiedingen van leveranciers | **nee**, handmatig | Er is geen openbare, toegestane bron. Vergelijkingssites verbieden automatisch uitlezen, en ANWB staat er bijvoorbeeld niet eens op. |
| Meldingen | ja, dagelijks | GitHub Actions → ntfy.sh |

**Te controleren na 27 november 2026:** de ACM stelt dan de definitieve netbeheerkosten voor 2027 vast. Pas in `data/tarieven.json` `netStroom` en `netGas` aan en zet `netDefinitief` op `true`. Omdat dit bij elke leverancier gelijk is, verandert het verschil tussen contracten niet. Alleen het totaal verandert.

## Online en offline
- **Zonder internet** opent de app met de laatst geladen gegevens. Invoeren, vergelijken en de berekening bekijken werkt gewoon.
- **Met internet nodig:** nieuwe beursprijzen, bijgewerkte tarieven en aanbiedingen, en meldingen.

## Privacy
- **Je verbruik, contract en instellingen** staan alleen in de opslag van de browser op je toestel. Maak af en toe een back-up via *Gegevens → Download back-up*. Als je de websitegegevens in Safari wist, ben je ze anders kwijt.
- **De repository** is openbaar, maar bevat alleen de app, de tarieven en de beursprijzen. Er staan geen naam, adres, EAN, rekeningnummer of verbruik in.
- **`PROFIEL_JSON`** is een versleuteld GitHub-geheim. Alleen de taak kan het lezen. De logboeken tonen geen bedragen of verbruik.
- **Externe diensten:**
  - Energy-Charts en EnergyZero krijgen alleen datums, en die vragen komen van GitHub, niet van je telefoon.
  - ntfy.sh krijgt alleen de tekst van een melding, plus je e-mailadres als je `MELDING_EMAIL` gebruikt.
  - Wie je ntfy-onderwerp kent, kan je meldingen lezen. Behandel het daarom als een wachtwoord.
- **Sms of WhatsApp** is niet ingebouwd. Daarvoor is een betaalde dienst nodig (bijvoorbeeld Twilio, met kosten per bericht en goedkeuring voor WhatsApp). Er worden nooit berichten namens jou verstuurd.

## Kosten
Alles is gratis. GitHub Actions is gratis voor openbare repositories, net als GitHub Pages en ntfy.sh. De dagelijkse commit van de prijzen houdt de repository actief. GitHub zet geplande taken anders na 60 dagen zonder activiteit uit.

## Grenzen van de berekening
- Er wordt gerekend over de komende 12 maanden vanaf de vermoedelijke overstapdatum. Het verbruik wordt naar rato over de dagen verdeeld, zonder seizoenspatroon.
- Bij een dynamisch contract betaalt iedere leverancier dezelfde beursprijs. Het verschil zit in de opslag, de vaste kosten en de terugleverregeling vanaf 2027.
- Hoe de prijzen over de dag en het jaar verdeeld zijn (meer verbruik ’s avonds, zon midden op de dag) is benaderd. De app ijkt die verdeling op jouw jaarafrekening.
- De startlijst met aanbiedingen komt deels van derden. Dat zie je aan de zekerheid ‘laag’ of ‘middel’. Controleer een aanbod altijd bij de leverancier voordat je overstapt.
- Dit is geen financieel advies.

## Voor ontwikkelaars
```
npm test                      # rekenmodel-tests (node 22)
node scripts/haal-prijzen.mjs # prijzen ophalen (schrijft data/prijzen.json)
python3 -m http.server        # lokaal openen op http://localhost:8000
```
