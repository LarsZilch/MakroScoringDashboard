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
| CNN Fear & Greed | CNN dataviz-Endpunkt | ~1 Jahr |
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

## Aufbau

```
data/snapshots/<jahr>/<jahr>-W<kw>.json   git-versioniert — das Gedächtnis
data/series/                              Rohdaten-Cache (nicht versioniert)
rules/v1.json                             Schwellen, Korridore, Regime-Bänder
src/core/                                 Scoring, ISO-Wochen, Ableitungen (ohne I/O)
src/sources/                              ein Konnektor je Quelle
src/pipeline/                             Snapshot-Bau, Store, Vergleiche
src/server/                               API + Proxy zu den Quellen
web/                                      Dashboard und Verlauf
test/                                     65 Tests, davon der Golden Test
```

**`src/core/` ist frei von Datei- und Netzzugriff.** Dieselbe Scoring-Logik läuft im ETL, im Server
und im Browser — ohne Duplikat.

**Snapshots sind unveränderlich und enthalten keine Deltas.** Wochen- und Jahresvergleiche werden
beim Lesen gerechnet. Wären sie eingebacken, müsste jeder Nachtrag alle Folgewochen umschreiben.
Geschrieben wird mit stabiler Schlüsselreihenfolge, sodass ein Wochenlauf einen lesbaren `git diff`
erzeugt: bei unveränderten Daten ändert sich genau eine Zeile, nämlich `builtAt`.

**Warum ein lokaler Server statt einer statischen Seite:** FRED, Yahoo, CNN und AAII senden keine
CORS-Header. Eine reine Browser-App kann sie nicht abrufen.

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
- Methodik-Ansicht in der App, gerendert aus `rules/*.json`
- Export des Dashboards als PNG/PDF
- Was-wäre-wenn-Regler für die Schwellen (läuft im Browser, weil `src/core` I/O-frei ist)
- Wochen-Automatik über die Windows-Aufgabenplanung
- Backtest des Regimes gegen die SPX-Forward-Rendite
