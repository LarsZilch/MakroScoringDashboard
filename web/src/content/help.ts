/**
 * Die erzaehlende Ebene des Hilfe-Tabs.
 *
 * WICHTIG: Hier stehen KEINE Schwellenwerte, Korridore oder Cash-Baender.
 * Alle Zahlen rendert der Hilfe-Tab aus rules/v1.json und dem aktuellen
 * Snapshot. Stuenden sie zusaetzlich hier als Text, haette die App zwei
 * Wahrheiten — und die Hilfe wuerde still falsch, sobald jemand eine Schwelle
 * anfasst.
 *
 * Was hier steht, ist das, was sich NICHT aus den Daten ergibt: was ein
 * Indikator misst, warum er im Modell steckt, wie eine Bewegung zu lesen ist.
 */

import type { ScenarioId } from '../../../src/core/scenario.js';

export interface IndicatorHelp {
  /** Ein Satz fuer die Uebersicht. */
  short: string;
  /** Was genau gemessen wird. */
  measures: string;
  /** Warum der Indikator im Modell steckt. */
  why: string;
  /** Was eine Bewegung nach oben bzw. unten bedeutet. */
  reading: { up: string; down: string };
  /**
   * Warum die Richtung sich umkehrt — nur bei invertierter Skala oder
   * kontrarischer Lesart gesetzt. Das ist die haeufigste Verwirrung.
   */
  twist?: string;
  /** Fallstricke beim Lesen. */
  watchOut?: string;
  /** Herkunft und Rhythmus, fuer die Detailebene. */
  source: string;
}

export const INDICATOR_HELP: Record<string, IndicatorHelp> = {
  ism_mfg_pmi: {
    short: 'Umfrage unter Einkaufsmanagern im Verarbeitenden Gewerbe — der klassische Fruehindikator der US-Konjunktur.',
    measures:
      'Der ISM Manufacturing PMI fasst monatliche Umfragen bei Einkaufsleitern zu Auftraegen, Produktion, Beschaeftigung, Lieferzeiten und Lagern zusammen. Ein Stand ueber 50 bedeutet Expansion, darunter Schrumpfung. Bewertet wird hier aber nicht das Niveau, sondern die Veraenderung ueber drei Monate.',
    why: 'Einkaufsleiter disponieren, bevor sich etwas in harten Zahlen niederschlaegt. Der PMI dreht deshalb typischerweise vor Umsaetzen und Gewinnen. Fuer den Gewinnzyklus, an dem Aktienmaerkte haengen, ist er einer der verlaesslichsten Vorlaeufer.',
    reading: {
      up: 'Die Industriekonjunktur beschleunigt. Auftraege ziehen an, Unternehmen planen mit mehr Volumen.',
      down: 'Die Industriekonjunktur kuehlt ab. Das kann eine Delle sein oder der Beginn eines Abschwungs — die drei Monate Abstand filtern einzelne Ausreisser heraus.',
    },
    watchOut:
      'Bewertet wird die Beschleunigung, nicht das Niveau. Ein PMI, der von 58 auf 55 faellt, zeigt weiterhin Expansion — wird hier aber negativ gewertet, weil die Dynamik nachlaesst. Umgekehrt kann ein Anstieg von 45 auf 48 positiv zaehlen, obwohl die Industrie noch schrumpft.',
    source:
      'ISM (Institute for Supply Management), monatlich am ersten Werktag des Folgemonats. Der Index ist lizenziert; die App liest den Kopfwert aus den Pressemitteilungen. Er wird nachtraeglich revidiert, meist geringfuegig.',
  },

  nfci: {
    short: 'Sammelmass der Chicago Fed fuer die Finanzierungsbedingungen in den USA — aus rund 105 Einzelreihen.',
    measures:
      'Der National Financial Conditions Index buendelt Kreditkonditionen, Risikoaufschlaege, Verschuldungsgrade und Geldmarktbedingungen zu einer Zahl. Null entspricht dem historischen Durchschnitt. Bewertet wird die Veraenderung ueber drei Monate.',
    why: 'Finanzierungsbedingungen sind der Uebertragungsweg zwischen Geldpolitik und Realwirtschaft. Sie straffen sich meist, bevor die Konjunkturdaten kippen — und lockern sich, bevor eine Erholung sichtbar wird.',
    reading: {
      up: 'Die Finanzierungsbedingungen straffen sich: Kredit wird teurer oder schwerer zu bekommen, Risikoaufschlaege weiten sich.',
      down: 'Die Finanzierungsbedingungen lockern sich: Kredit fliesst leichter, Aufschlaege gehen zurueck.',
    },
    twist:
      'Der NFCI ist invertiert. Ein FALLENDER Wert ist die gute Nachricht, weil er lockerere Bedingungen anzeigt. Das ist die haeufigste Fehllesung dieses Indikators.',
    watchOut:
      'Der NFCI wird woechentlich veroeffentlicht, aber rueckwirkend revidiert. Ein Score, der auf einem knappen Ausschlag beruhte, kann sich mit der naechsten Revision anders darstellen.',
    source: 'Federal Reserve Bank of Chicago ueber FRED, woechentlich mit rund einer Woche Verzug. Historie bis 1971.',
  },

  t10y2y: {
    short: 'Renditeabstand zwischen zehnjaehrigen und zweijaehrigen US-Staatsanleihen — die Steilheit der Zinskurve.',
    measures:
      'Die Differenz zwischen der zehnjaehrigen und der zweijaehrigen Rendite, in Prozentpunkten. Bewertet wird die Veraenderung ueber drei Monate, umgerechnet in Basispunkte — nicht das Niveau.',
    why: 'Die Kurvensteilheit buendelt Erwartungen an Wachstum, Inflation und Geldpolitik in einer Zahl. Das kurze Ende folgt der Fed, das lange Ende den Wachstumserwartungen. Ihr Abstand sagt, in welche Richtung sich beides bewegt.',
    reading: {
      up: 'Die Kurve versteilert sich. Entweder preist der Markt mehr Wachstum ins lange Ende, oder er erwartet Zinssenkungen am kurzen — beides folgt oft auf einen Wendepunkt.',
      down: 'Die Kurve verflacht. Der Markt erwartet straffere Geldpolitik oder schwaecheres Wachstum.',
    },
    watchOut:
      'Versteilerung ist nicht per se gut. Sie kann aus einem fallenden kurzen Ende kommen (Zinssenkungserwartung, oft in einer Rezession) oder einem steigenden langen (Wachstum oder Inflationssorge). Der Indikator unterscheidet das nicht — er misst nur die Richtung.',
    source: 'FRED-Reihe T10Y2Y, taeglich, Historie bis 1976.',
  },

  gli: {
    short: 'Richtung des globalen Liquiditaetsimpulses — hier ersetzt durch die Netto-Liquiditaet der Fed.',
    measures:
      'Fed-Bilanzsumme abzueglich des Treasury General Account und der Reverse-Repo-Bestaende. Daraus die auf ein Jahr hochgerechnete Dreimonatsrate — und bewertet wird deren RICHTUNG, nicht ihr Niveau.',
    why: 'Liquiditaet ist das Loesungsmittel der Bewertungen. Wenn mehr Zentralbankgeld im System zirkuliert, steigen Risikoaktiva tendenziell, bevor sich Fundamentaldaten bewegen. Der Impuls laeuft dem Konjunkturzyklus voraus.',
    reading: {
      up: 'Der Liquiditaetsimpuls nimmt zu: Bilanz waechst, Treasury-Konto oder Reverse-Repo entleeren sich. Geld fliesst ins System.',
      down: 'Der Liquiditaetsimpuls laesst nach: Bilanzabbau, oder das Treasury zieht Mittel ab. Dem Markt wird Liquiditaet entzogen.',
    },
    watchOut:
      'Bewertet wird die zweite Ableitung: nicht wie viel Liquiditaet da ist, sondern ob der Zufluss zu- oder abnimmt. Der Impuls kann fallen, waehrend die Liquiditaet absolut noch waechst. Dieser Indikator ist zudem der mit Abstand unruhigste der neun — Einzelheiten unter den Details.',
    source:
      'FRED-Reihen WALCL, WTREGEN und RRPONTSYD, woechentlich. Achtung bei den Einheiten: die ersten beiden stehen in Millionen, die dritte in Milliarden Dollar.',
  },

  move: {
    short: 'Erwartete Schwankungsbreite am US-Anleihemarkt — der VIX der Zinsen.',
    measures:
      'Der ICE BofA MOVE Index misst die aus Optionen abgeleitete erwartete Volatilitaet von US-Staatsanleihen ueber die naechsten 30 Tage. Bewertet wird das Niveau.',
    why: 'Der Anleihemarkt ist der groessere und traegere der beiden Maerkte. Wenn dort die Unruhe steigt, folgt der Aktienmarkt meist — nicht umgekehrt. Ein ruhiger Zinsmarkt ist die Grundlage dafuer, dass Risiko ueberhaupt getragen wird.',
    reading: {
      up: 'Unruhe am Anleihemarkt nimmt zu. Zinserwartungen werden unsicher, Absicherung wird teuer, Risikobudgets schrumpfen.',
      down: 'Der Zinsmarkt beruhigt sich. Kalkulierbare Refinanzierung ist die Voraussetzung fuer Risikobereitschaft.',
    },
    watchOut:
      'Anders als beim VIX wird der MOVE hier NICHT kontrarisch gelesen. Ein niedriger MOVE gilt schlicht als gut — es gibt keine Stufe, in der Ruhe am Anleihemarkt negativ gewertet wuerde.',
    source:
      'ICE BofA MOVE Index ueber Yahoo Finance, taeglich. Der Index ist lizenziert und wird ueber einen inoffiziellen Endpunkt bezogen.',
  },

  sofr_iorb: {
    short: 'Abstand zwischen dem besicherten Tagesgeldsatz und dem Zins, den die Fed auf Reserveguthaben zahlt.',
    measures:
      'SOFR minus IORB, in Basispunkten. Der SOFR ist der Satz, zu dem sich Banken gegen Staatsanleihen kurzfristig Geld leihen; der IORB ist die Verzinsung, die die Fed auf Reserveguthaben zahlt. Bewertet wird der Abstand.',
    why: 'Dieser Spread ist das empfindlichste Thermometer fuer die Reichlichkeit von Bankreserven. Solange Reserven im Ueberfluss vorhanden sind, liegt der SOFR am oder unter dem IORB. Werden sie knapp, muessen Marktteilnehmer draufzahlen und der Spread laeuft nach oben — meist Wochen bevor sich das irgendwo anders zeigt.',
    reading: {
      up: 'Funding wird teurer als die Fed zahlt: Reserven werden knapp, im Repo-Markt entsteht Druck. Ein klassisches Fruehwarnsignal.',
      down: 'Reserven sind reichlich, kein Refinanzierungsdruck im System.',
    },
    twist:
      'Ein NEGATIVER Spread ist die gute Nachricht. Das wirkt zunaechst verkehrt, ist aber der Normalzustand bei reichlichen Reserven.',
    watchOut:
      'Der Spread springt um Quartals- und Jahresenden regelmaessig nach oben, weil Bilanzstichtage die Nachfrage nach Repo-Finanzierung verzerren. Solche Ausschlaege sind technisch und kein Stresssignal.',
    source: 'FRED-Reihen SOFR und IORB, taeglich. Vor Juli 2021 wird IORB durch seinen Vorgaenger IOER fortgesetzt.',
  },

  vix: {
    short: 'Erwartete Schwankungsbreite des S&P 500 ueber 30 Tage — das bekannteste Angstbarometer.',
    measures:
      'Der VIX leitet aus den Optionspreisen auf den S&P 500 ab, welche Schwankung der Markt fuer die naechsten 30 Tage einpreist. Bewertet wird das Niveau.',
    why: 'Der VIX misst nicht Risiko, sondern den Preis der Absicherung. Ist er sehr niedrig, hat sich niemand abgesichert und der Markt ist verwundbar. Ist er sehr hoch, ist die Panik bereits bezahlt.',
    reading: {
      up: 'Die Unsicherheit steigt, Absicherung wird teurer.',
      down: 'Der Markt wird ruhiger und sorgloser.',
    },
    twist:
      'Kontrarisch gelesen. Ein sehr NIEDRIGER VIX ist keine gute Nachricht, sondern Sorglosigkeit — genau die Lage, in der ein Schock am meisten anrichtet. Ein sehr hoher VIX gilt umgekehrt als Kapitulation und damit als Chance.',
    watchOut:
      'Der VIX bewegt sich taeglich. Von allen neun Indikatoren ist er derjenige, der einen Wochenstand am ehesten allein durch einen ruhigen oder nervoesen Tag kippen laesst.',
    source: 'CBOE ueber FRED-Reihe VIXCLS, taeglicher Schlussstand. Historie bis 1990.',
  },

  aaii: {
    short: 'Woechentliche Stimmungsumfrage unter US-Privatanlegern: Anteil der Optimisten minus Anteil der Pessimisten.',
    measures:
      'Die American Association of Individual Investors fragt woechentlich, ob Mitglieder den Markt auf Sicht von sechs Monaten steigend, fallend oder unveraendert sehen. Bewertet wird der Abstand zwischen Bullen und Baeren, geglaettet ueber vier Wochen.',
    why: 'Privatanleger sind in Extremen verlaesslich schlecht getimt. Ihre Stimmung taugt deshalb als Gegenindikator — nicht zur Prognose, aber zur Einordnung, wie viel Optimismus bereits in den Kursen steckt.',
    reading: {
      up: 'Die Privatanleger werden zuversichtlicher.',
      down: 'Die Privatanleger werden pessimistischer.',
    },
    twist:
      'Kontrarisch gelesen. Ausgepraegter Optimismus wird negativ gewertet, ausgepraegter Pessimismus positiv. Die Umfrage misst, wer bereits investiert ist — und damit, wer noch kaufen koennte.',
    watchOut:
      'Die vier Wochen Glaettung sind Absicht: die Einzelwoche ist verrauscht. Liegen ausnahmsweise weniger als vier Wochen vor, weist die Anzeige das aus — der Wert ist dann nur ein Teilschnitt.',
    source:
      'aaii.com, woechentlich mittwochs, datiert auf den Umfrageschluss. Die Wochenwerte kommen aus der frei zugaenglichen Ergebnistabelle (rund 22 Wochen je Abruf), die vollstaendige Historie ab Juli 1987 aus der offiziellen Arbeitsmappe unter aaii.com/files/surveys — einmalig per "npm run import:aaii" geladen. Beides stammt von AAII selbst; die Mitgliedschaft braucht es dafuer nicht. Die Arbeitsmappe wird nicht jede Woche fortgeschrieben, deshalb schliesst der Wochenabruf die Luecke bis heute.',
  },

  fear_greed: {
    short: 'Aggregat aus sieben Marktindikatoren, das CNN zu einer Skala von 0 bis 100 verdichtet.',
    measures:
      'Der Index kombiniert unter anderem Marktbreite, Momentum gegen den 125-Tage-Schnitt, Put-Call-Verhaeltnis, Volatilitaet, die Nachfrage nach Ramschanleihen und den Abstand zwischen Aktien- und Anleiherenditen. 0 steht fuer extreme Angst, 100 fuer extreme Gier.',
    why: 'Er ergaenzt die Umfrage bei AAII um die Frage, was Anleger tatsaechlich TUN statt was sie sagen. Positionierung ist der ehrlichere Teil der Stimmung.',
    reading: {
      up: 'Die Risikobereitschaft steigt: mehr Momentum, weniger Absicherung, hoehere Nachfrage nach Ramschanleihen.',
      down: 'Die Risikobereitschaft faellt, Anleger suchen Deckung.',
    },
    twist:
      'Kontrarisch gelesen — wie VIX und AAII. Extreme Gier wird negativ gewertet, extreme Angst positiv.',
    watchOut:
      'Der Index ueberschneidet sich inhaltlich mit dem VIX, der eine seiner sieben Komponenten ist. Zwei der drei Sentiment-Indikatoren teilen sich damit teilweise dieselbe Information. Fuer Wochen, die aus der importierten historischen Rekonstruktion stammen (siehe unten), traegt der Wert zusaetzlich das Ersatzreihen-Kennzeichen.',
    source:
      'CNN Business ueber einen inoffiziellen Endpunkt, taeglich. Der Live-Endpunkt reicht nur rund ein Jahr zurueck. Optional laesst sich per "npm run import:feargreed" eine kostenlose, MIT-lizenzierte Community-Rekonstruktion nachladen (github.com/whit3rabbit/fear-greed-data, taeglich seit 2011-01-03) — CNN selbst verkauft keine Historie, und kein institutioneller Datenanbieter fuehrt diese Reihe. Der Autor der Rekonstruktion weist selbst darauf hin, dass Werte vor dem 01.02.2021 aus Archiven rekonstruiert und weniger genau sind als danach; die App zeigt diesen Vorbehalt in jeder betroffenen Woche an. Die echte CNN-Quelle hat immer Vorrang, sobald sie fuer eine Woche etwas liefert.',
  },
};

// ---------------------------------------------------------------------------
// Faktoren
// ---------------------------------------------------------------------------

export interface FactorHelp {
  short: string;
  detail: string;
}

export const FACTOR_HELP: Record<string, FactorHelp> = {
  business_cycle: {
    short: 'Wo steht die Realwirtschaft, und in welche Richtung bewegt sie sich?',
    detail:
      'Alle drei Indikatoren dieses Faktors messen Veraenderung, nicht Niveau. Das ist Absicht: fuer die Frage, ob Risiko gerade bezahlt wird, zaehlt die Richtung mehr als der Stand. Eine schwache Wirtschaft, die sich verbessert, ist fuer Risikoaktiva guenstiger als eine starke, die sich abkuehlt.',
  },
  liquidity: {
    short: 'Wie viel Geld ist im System, und wie leicht laesst es sich beschaffen?',
    detail:
      'Dieser Faktor laeuft dem Konjunkturzyklus typischerweise voraus. Zentralbankliquiditaet, die Ruhe am Anleihemarkt und der Refinanzierungsdruck im Bankensystem drehen zusammen frueher als jede Konjunkturzahl. Wenn ein Regimewechsel bevorsteht, kuendigt er sich meist hier zuerst an.',
  },
  sentiment: {
    short: 'Wie viel Optimismus steckt bereits in den Kursen?',
    detail:
      'Alle drei Indikatoren werden KONTRARISCH gelesen: Extreme in beide Richtungen zaehlen gegen die vorherrschende Stimmung. Der Faktor prognostiziert nicht, er misst, wie viel Erwartung schon eingepreist ist — und damit, wie viel Raum nach oben oder unten bleibt. Er bestaetigt eher, als dass er fuehrt.',
  },
};

// ---------------------------------------------------------------------------
// Szenarien
//
// Nur die Texte. Die Annahmen selbst — welcher Indikator auf welchen Score
// gesetzt wird — sind Eingabe einer Rechnung und stehen deshalb im Kern
// (src/core/scenario.ts), wo auch der Server sie fuer den Backtest liest.
//
// Record<ScenarioId, ...> erzwingt, dass zu jedem Szenario ein Text existiert:
// ein vergessener Eintrag ist ein Typfehler, kein leerer Kasten im Browser.
// ---------------------------------------------------------------------------

export interface ScenarioText {
  title: string;
  trigger: string;
  narrative: string;
}

export const SCENARIO_TEXTS: Record<ScenarioId, ScenarioText> = {
  liquidity_turns: {
    title: 'Der Liquiditaetsimpuls dreht ab',
    trigger:
      'Die Fed baut ihre Bilanz ab oder das Treasury fuellt sein Konto auf, gleichzeitig kommt Unruhe in den Anleihemarkt.',
    narrative:
      'Das typische erste Anzeichen eines Regimewechsels. Liquiditaet dreht, bevor die Konjunktur es tut — deshalb faellt dieser Faktor oft als erster. Wenn der Funding-Spread danach ebenfalls anzieht, verliert der Liquiditaetsfaktor seine Mehrheit vollstaendig.',
  },
  greed_extreme: {
    title: 'Das Sentiment kippt in Extreme Greed',
    trigger:
      'Nach einer laengeren Aufwaertsbewegung schlagen Fear & Greed und die AAII-Umfrage gleichzeitig ins Euphorische um.',
    narrative:
      'Der Sentiment-Faktor ist der einzige, der aus einer Aufwaertsbewegung heraus negativ werden kann — genau das ist der Zweck der kontrarischen Lesart. Er fuehrt selten, aber er markiert, wann eine Bewegung an Nachschub verliert.',
  },
  cycle_breaks: {
    title: 'Die Konjunktur bricht ein',
    trigger:
      'Der ISM faellt ueber drei Monate deutlich, gleichzeitig straffen sich die Finanzierungsbedingungen.',
    narrative:
      'Der langsamste, aber deutlichste der vier Faelle. Da beide Indikatoren im selben Faktor liegen, reicht ihr gemeinsames Drehen fuer die Mehrheit — der Business-Cycle-Faktor kippt vollstaendig durch.',
  },
  funding_stress: {
    title: 'Funding-Stress im Bankensystem',
    trigger:
      'Der SOFR laeuft deutlich ueber den IORB, gleichzeitig springt die Volatilitaet am Anleihemarkt.',
    narrative:
      'Der schnellste der vier Faelle und der mit der schaerfsten Signalwirkung. Knappe Reserven und ein unruhiger Anleihemarkt treten selten allein auf — historisch geht das den scharfen Korrekturen voraus, nicht nach.',
  },
};
