# Makro-Scoring · Regime-Check

Lokale Browser-App: neun Whitelist-Indikatoren → drei Faktoren → ein Gesamtscore → Regime und
Soll-Cash-Band. Jeder Wochenstand wird als Snapshot aufbewahrt, damit sich Veränderungen von
Kalenderwoche zu Kalenderwoche und von Jahr zu Jahr verfolgen lassen.

Vorlage der Methodik und Gestaltung: `doc/MakroScoringInfoScreen.jpg` (KW 32/2026).

## Loslegen

```bash
npm install
```

```bash
npm run update
```

```bash
npm run dev
```

Dann `http://localhost:5177` öffnen. `npm run dev` startet API-Server (Port 5178) und Frontend
(Port 5177) gemeinsam.

Weitere Befehle:

```bash
npm run check:sources
```

```bash
npm run backfill
```

```bash
npm test
```

## Die Methodik

| Faktor | Indikatoren |
|---|---|
| 1 · Business Cycle | ISM Mfg PMI (3m-Change) · Chicago Fed NFCI (3m) · 10y−2y Spread (3m) |
| 2 · Globale Liquidität | Howell GLI (Richtung) · MOVE (Level) · SOFR−IORB (Level/Richtung) |
| 3 · Sentiment | VIX (Level) · AAII Bull-Bear (4w-Ø) · CNN Fear & Greed (Level) |

Jeder Indikator wird zu −1 / 0 / +1. Ein Faktor ist +1, wenn mindestens zwei seiner drei
Indikatoren positiv sind, −1 bei zwei negativen, sonst 0. Der Gesamtscore ist die Summe der drei
Faktoren (−3 … +3) und bestimmt Regime und Soll-Cash-Band.

Alle Schwellen stehen in `rules/v1.json`, nichts davon ist im Code fest verdrahtet. Jeder Snapshot
merkt sich, mit welcher Regelwerk-Version er gerechnet wurde — eine Regeländerung bekommt eine neue
Datei, alte Snapshots bleiben reproduzierbar.

## Datenquellen

| Indikator | Quelle | Historie |
|---|---|---|
| Chicago Fed NFCI | FRED `NFCI` | ab 1971 |
| 10y−2y Spread | FRED `T10Y2Y` | ab 1976 |
| VIX | FRED `VIXCLS` | ab 1990 |
| SOFR − IORB | FRED `SOFR`, `IORB` + `IOER` verkettet | ab 2018 |
| Liquidität (Ersatz) | FRED `WALCL` − `WTREGEN` − `RRPONTSYD` | ab 2002 |
| MOVE | Yahoo `^MOVE` | ab 2021 |
| CNN Fear & Greed | CNN dataviz-Endpunkt | ~1 Jahr live, optional ab 2011 nachladbar |
| ISM Mfg PMI | PRNewswire-Pressemitteilungen | ~12 Monate |
| AAII Bull-Bear | aaii.com | nur aktuelle Woche |

FRED läuft über den CSV-Graphdienst und braucht **keinen API-Schlüssel**.

### Drei Einschränkungen, die man kennen muss

**1. Der Liquiditäts-Indikator ist eine Ersatzreihe.** Der Howell GLI (CrossBorder Capital) ist
kostenpflichtig und hat keine offene Schnittstelle. An seiner Stelle steht Fed Net Liquidity
(Fed-Bilanz − Treasury General Account − Reverse Repo). Gleiche Form, anderer Aggregatbegriff. Die
App kennzeichnet ihn überall als `ERSATZREIHE`.

Diese Reihe ist zudem deutlich unruhiger als das Original: ihre 3m-annualisierte Rate schwankt im
Monatsvergleich mit einer Standardabweichung von rund 50 Prozentpunkten. Die Schwelle wurde deshalb
an der Reihe selbst kalibriert (±6,0 pp, ergibt etwa eine Drittelung) statt geraten. Die Messung
steht in `rules/v1.json` unter `calibration`.

**2. Die belastbare Historie beginnt erst 2025.** ISM, AAII und Fear & Greed sind öffentlich nur für
die jüngste Zeit zu bekommen. Von 851 rückgerechneten Wochen ab 2010 sind nur **53 aussagekräftig**
(ab KW 33/2025). Bei allen übrigen ist mindestens ein Faktor mangels Daten nicht bestimmbar.

Diese Wochen werden nicht versteckt, aber auch nie wie ein regulärer Stand dargestellt: sie tragen
`completeness: "sparse"`, erscheinen im Verlauf schraffiert und fehlen in der Wochenauswahl. Der
Grund ist wichtiger als es aussieht — ein fehlender Indikator zählt rechnerisch als 0 und zieht den
Gesamtscore Richtung Mitte. Ohne Kennzeichnung läse man eine Datenlücke als „Neutral".

**3. Einzelne Schwellen sind gesetzt, nicht belegt.** Aus einem Screenshot lassen sich nicht alle
Regeln ableiten. Was belegt ist (VIX-Korridor 15–25, MOVE < 80, F&G 20–70, AAII −10…+20, die
Mehrheitsregel, Risk On bei +2 und Neutral bei +1), ist als solches vermerkt. Alles Übrige trägt
`"assumed": true` samt Begründung — insbesondere die numerischen Schwellen für ISM, NFCI und
Spread-Änderung, das Verhalten oberhalb der Sentiment-Korridore (kontrarisch gelesen) und die
Regime-Bänder für negative Gesamtscores.

### Optional: historische Fear-&-Greed-Daten nachladen

Recherche vom 14.08.2026: CNN verkauft keine Historie seines Fear-&-Greed-Index, und kein
institutioneller Datenanbieter (Bloomberg, Refinitiv, FactSet, Trading Economics, Quandl) führt die
Reihe. AAII verkauft seine volle Historie seit 1987 über die Mitgliedschaft (298 USD/Jahr,
[invest.aaii.com/membership](https://invest.aaii.com/membership)) — für Fear & Greed gibt es
dagegen nur eine kostenlose, MIT-lizenzierte Community-Rekonstruktion:
[github.com/whit3rabbit/fear-greed-data](https://github.com/whit3rabbit/fear-greed-data), täglich
seit 2011-01-03.

```bash
npm run import:feargreed
```

lädt sie einmalig in den Cache; `npm run backfill -- --no-fetch` rechnet danach die betroffenen
historischen Snapshots neu. Wichtig: **der Autor der Quelle weist selbst darauf hin, dass Werte vor
dem 01.02.2021 aus Archiven rekonstruiert und weniger genau sind** als danach. Die App verschweigt
das nicht — Wochen, die aus dem Import stammen, tragen `quality: "proxy"` (dasselbe
`ERSATZREIHE`-Badge wie beim GLI) und bei Daten vor der Grenze einen zusätzlichen Hinweis in der
Anzeigezeile. Die echte CNN-Live-Quelle hat für jede Woche, die sie abdeckt, immer Vorrang.

Der Import läuft **nicht** im regulären `npm run update` mit — die CSV ist ein statischer
vergangener Zeitraum von einem Drittanbieter-Repo, und der wöchentliche Betrieb soll nicht an dessen
Verfügbarkeit hängen.

Warum das allein schon fast die ganze Lücke schließt: ein Faktor gilt als bestimmbar, sobald 2 von 3
Mitgliedern einen Wert haben. NFCI und Zinskurve sind immer da, GLI und MOVE fast immer — Business
Cycle und Liquidität sind damit historisch fast durchgehend bestimmbar, auch ganz ohne ISM oder
SOFR-Vorgeschichte. Einzig Sentiment war blockiert, weil AAII und Fear & Greed gleichzeitig fehlten
und VIX allein nicht reicht. Ein einziger nachgerüsteter Datensatz genügt also bereits.

## Aufbau

```
data/snapshots/<jahr>/<jahr>-W<kw>.json   git-versioniert — das Gedächtnis
data/series/                              Rohdaten-Cache (nicht versioniert)
rules/v1.json                             Schwellen, Korridore, Regime-Bänder
src/core/                                 Scoring, ISO-Wochen, Ableitungen (ohne I/O)
src/sources/                              ein Konnektor je Quelle
src/pipeline/                             Snapshot-Bau, Store, Vergleiche
src/server/                               API + Proxy zu den Quellen
web/                                      Dashboard, Verlauf und Hilfe
web/src/content/                          Erklärtexte; playbooks.ts ist gesetzt, nicht abgeleitet
test/                                     124 Tests, davon der Golden Test
```

**`src/core/` ist frei von Datei- und Netzzugriff.** Dieselbe Scoring-Logik läuft im ETL, im Server
und im Browser — ohne Duplikat.

**Snapshots sind unveränderlich und enthalten keine Deltas.** Wochen- und Jahresvergleiche werden
beim Lesen gerechnet. Wären sie eingebacken, müsste jeder Nachtrag alle Folgewochen umschreiben.
Geschrieben wird mit stabiler Schlüsselreihenfolge, sodass ein Wochenlauf einen lesbaren `git diff`
erzeugt: bei unveränderten Daten ändert sich genau eine Zeile, nämlich `builtAt`.

**Warum ein lokaler Server statt einer statischen Seite:** FRED, Yahoo, CNN und AAII senden keine
CORS-Header. Eine reine Browser-App kann sie nicht abrufen.

## Der Hilfe-Tab

Erklärt jeden Indikator einzeln, was Veränderungen bedeuten, wie sich das Gesamtbild zusammensetzt
und was sich ableiten lässt. Zwei Regeln bestimmen seinen Bau:

**Keine zweite Wahrheit.** Sämtliche Schwellen, Korridore und Cash-Bänder werden aus
`rules/v1.json` und dem aktuellen Snapshot gerendert — auch die Skalenleiste unter jedem Indikator
und die Liste der elf gesetzten Annahmen. Verschiebt jemand eine Schwelle, bewegt sich die Hilfe
mit. Von Hand geschrieben ist nur, was sich nicht aus den Daten ergibt: was ein Indikator misst und
warum er im Modell steckt.

Beim Bau fiel dabei eine bestehende Doppelung auf: die Sentiment-Korridore standen zusätzlich als
Text in den Anzeigezeilen (`"Korridor 15–25"`). Sie kommen jetzt ebenfalls aus dem Regelwerk, und
ein Test hält das fest.

**Die Szenarien werden gerechnet, nicht behauptet.** Vier Durchspielungen laufen von der aktuellen
Lage aus durch `aggregateFactor()` und `resolveRegime()` — denselben Code, der die Snapshots
erzeugt. Das geht nur, weil `src/core/` frei von I/O ist.

Ein Abschnitt fällt bewusst aus dem Rahmen: die Einordnung je Anlageklasse in
`web/src/content/playbooks.ts`. Das Regelwerk leitet aus dem Regime ausschließlich das
Soll-Cash-Band ab; alles zu Aktien, Stil, Duration und Credit ist gesetzt. Deshalb steht es in einer
eigenen Datei, ist in der Oberfläche grau abgesetzt statt golden und trägt den Vermerk, dass es
nicht aus dem Modell stammt.

## Anlageklassen im Regime

Unter dem Score-Verlauf liegt ein zweites Diagramm mit den Kursverläufen von elf Anlageklassen,
einzeln zuschaltbar, auf 100 zum Fensterbeginn indexiert. Beide Felder teilen sich Breite, Ränder
und Zeitachse aus `web/src/components/chartGeometry.tsx` und tragen dieselbe Regime-Schattierung —
nur so lässt sich senkrecht ablesen, was eine Anlageklasse während einer Regime-Phase getan hat.

Bewusst **keine zweite y-Achse**: Score −3…+3 und Kursindex auf einer Fläche ließen sich so
skalieren, dass dieselbe Datenlage nach Gleichlauf oder nach Gegenlauf aussieht.

### Gemessen wird die Folgewoche

Das Regime der Woche *W* steht erst an deren Ende fest. Die Rendite derselben Woche zuzuordnen wäre
ein Blick in die Zukunft und würde jede Kennzahl schönrechnen. Gemessen wird deshalb *W+1* — der
Ertrag, den man tatsächlich hätte erzielen können. `test/asset-returns.test.ts` hält das fest.

Gerechnet wird auf `adjclose`, also inklusive Ausschüttungen. Ohne das wären TLT, HYG und LQD
systematisch schlechtgerechnet, weil dort der Kupon den Großteil der Rendite ausmacht.

### Vergleichsmodell 2018

Das echte Modell hat nur 53 belastbare Wochen — Risk Off kommt darin **zweimal** vor. Für eine
Auswertung ist das nichts. Deshalb gibt es einen zweiten Modus, der nur mit den sechs historisch
verfügbaren Indikatoren rechnet und bis Juli 2018 zurückreicht (**420 Wochen**, einschließlich
Corona-Crash und 2022). Bindende Grenze ist der SOFR ab April 2018.

Das ist **eine andere Methodik, nicht die Verlängerung des echten Modells**: der Sentiment-Faktor
besteht dort allein aus dem VIX, der Business-Cycle-Faktor nur aus NFCI und Zinskurve. Die Mehrheit
bezieht sich auf die vorhandenen Werte (`aggregateFactor(..., 'available')`), was bei drei
vorhandenen Werten rechnerisch dasselbe ergibt wie die echte Regel — `test/aggregation-mode.test.ts`
prüft das über alle 27 Kombinationen. Das Vergleichsmodell wird **nie gespeichert**, sondern bei
Bedarf aus dem Rohdaten-Cache gerechnet.

### Warum jede Zahl ihre Stichprobe mitführt

Die Tabelle zeigt neben jeder Kennzahl die Zahl der Wochen **und der Episoden**. Der Grund steht im
Ergebnis selbst: im Vergleichsmodell stammen 58 der 73 Risk-On-Wochen aus zwei Phasen 2020/21. Ohne
2020 halbiert sich die Kennzahl (+56,9 % → +28,4 %). `n = 73` sieht robust aus, sind aber im Kern
zwei Beobachtungen desselben Ereignisses — solche Zellen tragen deshalb einen Stern.

Unter acht Wochen erscheint gar keine Zahl, sondern „zu wenige Daten". Im echten Modell bleibt die
Risk-Off-Spalte damit leer.

## Der Golden Test

`test/golden.test.ts` füttert die neun Werte aus der Vorlage in den Scoring-Kern und erwartet exakt
das dort abgedruckte Ergebnis: Einzelscores `+1,+1,0 / −1,+1,+1 / 0,0,0`, Faktoren `+1,+1,0`,
Gesamtscore `+2`, Regime `Risk On`, Cash `5–15 %`.

Er prüft zusätzlich beide Punkte des roten Kastens der Vorlage: dass der VIX 0,15 Punkte über seiner
Complacency-Schwelle steht, und dass ein Kippen von SOFR−IORB den Gesamtscore auf +1 und damit das
Regime auf Neutral zieht. Schlägt dieser Test fehl, ist jede andere Zahl der App wertlos.

Nebenbefund beim Schreiben: bei einem Gesamtscore von genau +2 kippen **vier** Indikatoren das
Regime, nicht nur die zwei genannten — jeder Faktor, der seine Mehrheit verliert, reicht. Die
Vorlage hebt SOFR−IORB und VIX hervor, weil sie ihren Schwellen am nächsten stehen.

## Grenzfall-Analyse

Die App berechnet für jeden Indikator den Abstand zur nächsten Schwelle und spielt durch, welcher
einzelne Wechsel das Regime dreht — die maschinelle Fassung des roten Kastens.

Die Rangfolge läuft dabei **nicht** über den rohen Abstand: 3 bp beim SOFR-Spread, 0,01 Indexpunkte
beim NFCI und 1,9 Punkte beim ISM messen völlig verschiedene Dinge. Verglichen wird in
Standardabweichungen der eigenen Wochenveränderung, sobald genug Historie vorliegt, sonst in
Schritten der Anzeigegenauigkeit.

## Diagramme

Die Farben sind mit dem Validator der `dataviz`-Vorgaben geprüft. Die naheliegende Ampel
Grün/Gelb/Rot für die Regime ist dabei durchgefallen: Rot gegen Grün liegt bei Deuteranopie bei
einem Abstand von 4,1 und wäre in einer Heatmap mit angrenzenden Zellen nicht unterscheidbar. Die
Regime sind ohnehin geordnet und stehen deshalb auf einer divergierenden Skala mit neutraler Mitte.
Jede Zelle trägt zusätzlich ihre Zahl — Farbe trägt die Bedeutung nie allein.

## Nächste Schritte

- Die als `"assumed": true` markierten Schwellen gegen das Original-Regelwerk prüfen

- Export des Dashboards als PNG/PDF
- Was-wäre-wenn-Regler für die Schwellen (läuft im Browser, weil `src/core` I/O-frei ist)
- Wochen-Automatik über die Windows-Aufgabenplanung

