# Matchdag – fotbollsspelet

Ett fotbollsspel för webbläsaren (dator, mobil och surfplatta) med elva mot elva, riktig bollfysik, egen trupp, affär, turneringar, handel med spelare och matcher mot kompisar i realtid.

Spelet finns i två versioner som använder samma filer:

| | **GitHub Pages** (ingen server) | **Med server** (`node server.js`) |
|---|---|---|
| Kostnad och krångel | Gratis, inget att installera | Kräver en dator eller ett webbhotell som kör Node.js |
| Var laget sparas | I varje spelares webbläsare (spara en kopia som fil under Inställningar) | På servern, med konto och PIN-kod |
| Matcher mot datorn, turneringar, affär, träning | Ja | Ja |
| Spela mot kompis | Ja, direkt mellan webbläsarna med rumskod | Ja, via servern med rumskod |
| Köpa spelare av andra | **Handla med kompis**: när ni är ihopkopplade lägger ni ut spelare, budar och köper | **Global marknad** med auktioner för alla |
| Topplista | Nej | Ja |
| Vem ändrar spelardokumentet | Den som äger GitHub-projektet (och de som fått tillgång) | Ägaren av servern (och de ägaren ger tillåtelse) |

Spelet märker själv vilken version som körs.

## Publicera på GitHub Pages

1. Skapa ett konto på **github.com** och ett nytt **publikt** repository, t.ex. `matchdag`.
2. Ladda upp **allt innehåll** i mappen `fotbollsspel` (dra filerna och mapparna till sidan med *Add file → Upload files*). Mappen `docs` måste vara med.
3. Gå till **Settings → Pages**. Under *Build and deployment* väljer du *Deploy from a branch*, branch **main** och mappen **/docs**. Tryck **Save**.
4. Efter någon minut finns spelet på `https://DITTNAMN.github.io/matchdag/`. Skicka länken till kompisarna.

**Ändra spelardokumentet:** öppna `docs/spelare.csv` på GitHub och tryck på pennan för att redigera. Bara du (och de du lägger till under *Settings → Collaborators*) kan spara ändringar direkt. Efter någon minut syns ändringarna i spelet.

**Uppdatera spelet:** ladda upp de nya filerna på samma sätt. Lagen påverkas inte – de ligger i spelarnas webbläsare.

**Bra att veta:**

- Ett lag finns bara i den webbläsare där det skapades. Tryck **Spara en kopia** under Inställningar ibland – filen kan läsas in igen, även på en annan dator eller mobil.
- Kompismatcher kopplar ihop webbläsarna direkt (WebRTC). Rumskoden förmedlas av en gratis tjänst från PeerJS. Vissa nätverk, t.ex. skolans eller jobbets wifi, blockerar direktanslutningar – prova då ett annat nätverk.
- Resultat och pengar räknas i varje spelares egen webbläsare, så den som kan programmera kan fuska. Det är ett spel för kompisar.

## Starta spelet med server

Du behöver **Node.js 18 eller nyare** (gratis från nodejs.org). Inga andra paket behövs.

```bash
cd fotbollsspel
```

```bash
node server.js
```

(eller `npm start`)

Öppna sedan **http://localhost:3000** i webbläsaren. Terminalen skriver också ut adressen som kompisar på samma wifi ska använda, till exempel `http://192.168.1.20:3000`.

Skapa ett konto med namn, PIN-kod och klubbnamn. Varje kompis skapar sitt eget konto på samma server. All data sparas i `data/db.json`.

## Kontroller

| Mobil / surfplatta | Tangentbord | Vad händer |
|---|---|---|
| Joystick (vänster tumme) | WASD eller pilar | Spring |
| Tryck på en lagkamrat eller **Passa** | Klicka på lagkamrat eller **J** | Passa |
| Håll in **Skjut** | Håll in **K** eller mellanslag | Skott – ju längre du håller, desto hårdare |
| **Dribbla** | **L** | Fryser försvararna eller tappar bollen |
| Håll in **Sprinta** | **Shift** | Spring snabbt, max 10 sekunder |
| **Byt** (utan boll) | **J** | Byt till spelaren närmast motståndaren med bollen |
| **Tackla** (utan boll) | **K** | Glidtackling åt hållet du drar joysticken |
| Pausknappen | **Esc** | Paus, byten, energidryck, ljud |

## Allt från önskelistan

| Önskemål | Var det finns |
|---|---|
| Olika spelare | 16 spelare i startruppen, 36 proffs i affären, talanger via scouting |
| Realistisk spelfysik och grafik | Luftmotstånd, skruv (Magnuseffekt), studs, rullmotstånd, stolpar och ribba, nät som buktar. TV-kamera i perspektiv, kamera bakom bollen vid fasta situationer |
| Affär för spelare och saker | **Affär**: spelare, saker (energidryck, medicinväska, guldkikare, proffsskor), matchställ, sälj till klubben |
| Se laget, träna, scouta, läka | **Mitt lag**: Laget (formation och startelva), Träna, Scouta, Sjukstugan |
| Spela mot vänner och köpa spelare som andra säljer | **Spela mot kompis** (realtid med kod och insats). Med server: **Global marknad** (auktioner med bud och köp nu). På GitHub Pages: **Handla med kompis** (bud och köp när ni är ihopkopplade) |
| Spelpengar | Vinst ger pengar, allt i spelet kostar pengar |
| Enkelt redigerbart dokument med spelare | `docs/spelare.csv` – öppna i Excel/Numbers/Google Kalkylark, redigera på GitHub eller (med server) inne i spelet under **Spelardokument**. Bara ägaren och de som fått tillåtelse kan ändra |
| Skotthastighet = shooting × procent / 50 | Visas live när du håller in Skjut, t.ex. `61 × 100 / 50 = 122 km/h` |
| Byta ut skadad spelare | En ruta dyker upp direkt när någon skadas, plus byten i pausmenyn |
| Skadade spelare får lägre rating | Lätt −6 %, medelsvår −14 %, svår −28 % på alla värden |
| Sex kategorier för utespelare, två för målvakt | shooting, passing, dribbling, defending, pace, stamina – målvakter: diving och passing |
| Dribbling med slumptal | Slumptal 1–100. Över spelarens dribbling = tappar bollen, annars fryses försvarare inom 5 m i 1,5 s |
| Knappar med och utan boll | Se kontroller ovan |
| Joystick, ork-mätare, miniplan, pausknapp | Allt finns i matchen |
| Kommentator | Text i matchen och uppläsning med svensk röst om webbläsaren har en |
| Turnering mot datorlag med insats | 8 lag, kvartsfinal → final. Vinnaren tar hela potten (8 × insatsen) |
| Frispark med mur och ritad linje | Rita en linje från bollen; böj den för skruv. För mycket skruv eller för långt åt sidan = bollen går inte dit du vill |
| Straffar: tryck där du vill skjuta | Tryck i målet |
| Rädda straff/skott: dra åt ett håll | Rätt håll = diving-värdet i procent chans att rädda. Fungerar likadant när motståndaren skjuter i spelet (slowmotion) |
| Pengar när man vinner | Snabbmatch: 150 / 300 / 550 för vinst (lätt/medel/svår), turnering +100 per vinst, kompismatch potten + 250 |

## Så räknar spelet

- **Skott:** km/h = shooting × kraft i procent / 50. Bättre shooting ger också mindre spridning. Över 92 % kraft blir skotten vildare.
- **Passning:** bättre passing ger rakare och mer exakta passningar som är svårare att bryta.
- **Pace:** toppfart med och utan boll.
- **Stamina:** hur snabbt orken tar slut när man sprintar. Under 40 % ork går spelaren långsammare.
- **Defending:** chansen att vinna bollen i tacklingar (och färre fouls).
- **Diving:** när målvakten dyker åt rätt håll är chansen att rädda lika med diving i procent.
- **Skador:** fouls kan ge skador. De läker efter 1, 3 eller 6 matcher – eller direkt i Sjukstugan för 100, 250 eller 600.
- **Träning:** kostar 40 + 4 per poäng över 40 och ger +1 till +3.
- **Pris:** räknas ut från spelarens totalbetyg om priset i `spelare.csv` lämnas tomt.

## Spelardokumentet (`docs/spelare.csv`)

Kolumnerna skiljs åt med semikolon: `id;namn;position;land;shooting;passing;dribbling;defending;pace;stamina;diving;pris`

- position: `MV` (målvakt), `B` (back), `M` (mittfältare), `A` (anfallare)
- Utespelare fyller i de sex värdena och lämnar `diving` tomt.
- Målvakter fyller i `diving` och `passing`.
- Rader som börjar med `#` är kommentarer.

Spara filen och ladda om sidan, så syns ändringarna i affären.

### Vem får ändra dokumentet?

På GitHub Pages: den som äger GitHub-projektet och de som lagts till som *Collaborators*.

Med server:

- **Ägaren** är den som skapar det **första kontot** på servern. Terminalen skriver ut vem det är när servern startar.
- Ägaren kan ge (och ta bort) tillåtelse för andra under **Spelardokument → Vem får ändra dokumentet?**.
- Alla andra kan bara **läsa** dokumentet. Servern stoppar ändringar från den som inte har tillåtelse.
- Själva filen `docs/spelare.csv` kan bara ändras av den som har tillgång till datorn där servern körs.
- Vill du göra någon annan till ägare, starta servern med deras namn: `ADMIN=Alva node server.js`

## Publicera serverversionen på internet

Det enklaste är GitHub Pages (se ovan). Vill du ha serverversionen med konton, global marknad och topplista: den fungerar direkt för alla på samma wifi. För att kompisar ska kunna spela hemifrån måste servern gå att nå från internet.

**Snabbast (gratis, datorn måste vara på):** kör spelet på din dator och dela det via en tunnel, till exempel Cloudflares `cloudflared`:

```bash
cloudflared tunnel --url http://localhost:3000
```

Du får en adress som slutar på `trycloudflare.com` som du skickar till kompisarna. Adressen byts varje gång du startar tunneln.

**Alltid igång (webbhotell):** lägg koden hos en tjänst som kan köra Node.js. Den behöver:

- köra Node 18 eller nyare med startkommandot `npm start`
- tillåta WebSocket (för kompismatcherna)
- ha en **permanent disk (volym)** – annars försvinner alla konton när servern startas om
- miljövariabeln `DATA_DIR` satt till sökvägen där disken är monterad, t.ex. `/data`. Där sparas då både konton (`db.json`) och spelardokumentet (`spelare.csv`).
- miljövariabeln `PORT` om tjänsten kräver det (de flesta sätter den själva)

**Innan du delar länken:** skapa ditt eget konto först, så att du blir ägare. Alla som har länken kan skapa konto. Efter 5 fel PIN-koder låses ett konto i 10 minuter. Ta gärna en kopia av `db.json` ibland.

## Filer

Mappen `docs` är själva spelet – det är den GitHub Pages publicerar och den servern visar.

| Fil | Innehåll |
|---|---|
| `docs/index.html` | Spelets sida |
| `docs/spelare.csv` | Spelardokumentet |
| `docs/js/match.js` | Matchmotorn: fysik, regler, datorspelare, frisparkar, straffar |
| `docs/js/render.js` | Grafiken |
| `docs/js/controls.js` | Joystick, knappar, ork, miniplan, paus, frispark/straff/räddning |
| `docs/js/app.js` | Menyerna |
| `docs/js/shared.js` | Värden och formler (betyg, priser, skador, formationer, datorlag) |
| `docs/js/logic.js` | Lagets regler: affär, träning, scouting, sjukstuga, turneringar, matchresultat |
| `docs/js/local.js` | GitHub Pages-versionen: sparar laget i webbläsaren |
| `docs/js/p2p.js` | GitHub Pages-versionen: spela och handla med kompis direkt mellan webbläsarna |
| `docs/js/net.js` | Realtid mot kompis (värden kör matchen, gästen ser samma sak) |
| `docs/js/audio.js` | Ljud och kommentator |
| `docs/js/vendor/peerjs.min.js` | PeerJS 1.5.4 (MIT-licens) för direktanslutning |
| `server.js` | Servern: konton, global marknad, topplista, kompismatcher (WebSocket) |
