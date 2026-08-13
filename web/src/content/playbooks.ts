/**
 * ══════════════════════════════════════════════════════════════════════════
 *  ACHTUNG: DIESE DATEI ENTHAELT KEINE ABLEITUNG AUS DEM REGELWERK.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * rules/v1.json leitet aus dem Regime genau EINE Groesse ab: das
 * Soll-Cash-Band. Alles Weitere — Aktienquote, Zyklik gegen Defensive,
 * Duration, Credit — steht dort nicht und ist auch aus der Vorlage
 * doc/MakroScoringInfoScreen.jpg nicht belegbar.
 *
 * Die Zuordnungen unten sind gesetzt. Sie folgen der ueblichen Lesart von
 * Makro-Regimen dieser Bauart, aber sie sind eine ERGAENZUNG und keine
 * Aussage des Modells. Deshalb:
 *
 *   1. stehen sie in einer eigenen Datei, damit die Herkunft schon im
 *      Dateibaum sichtbar ist,
 *   2. werden sie in der Oberflaeche sichtbar abgesetzt und als gesetzt
 *      gekennzeichnet,
 *   3. tragen sie den Hinweis, dass es sich um einen Regelrahmen handelt und
 *      nicht um Anlageberatung.
 *
 * Wer das Modell erweitert, sollte diese Zuordnungen bewusst pruefen oder
 * durch eigene ersetzen — nicht stillschweigend uebernehmen.
 */

export interface PlaybookEntry {
  /** Passt zum label eines Regime-Bandes aus rules/*.json. */
  regime: string;
  /** Was die Lage im Kern kennzeichnet. */
  stance: string;
  equities: string;
  style: string;
  duration: string;
  credit: string;
  /** Worauf in diesem Regime besonders zu achten ist. */
  watch: string;
}

export const PLAYBOOKS: PlaybookEntry[] = [
  {
    regime: 'Risk On',
    stance:
      'Konjunktur und Liquiditaet tragen gemeinsam. Risiko wird bezahlt, und die Kosten der Absicherung sind niedrig.',
    equities:
      'Volle Quote im Rahmen der eigenen Bandbreite. Rueckschlaege sind in diesem Regime eher Gelegenheit als Warnung.',
    style:
      'Zyklik und kleinere Werte laufen typischerweise besser als defensive Qualitaet. Breite schlaegt Konzentration.',
    duration:
      'Als Absicherung wenig gefragt — bei anziehender Konjunktur arbeitet sie eher gegen die Aktienseite. Duration hier aus Zinsgruenden halten, nicht als Versicherung.',
    credit:
      'Aufschlaege sind meist eng. Traegt laufenden Ertrag, aber wenig Puffer, falls das Regime dreht.',
    watch:
      'Die niedrigen Absicherungskosten sind die eigentliche Chance dieses Regimes: Schutz ist dann guenstig, wenn man ihn nicht zu brauchen glaubt.',
  },
  {
    regime: 'Neutral',
    stance:
      'Kein Faktor hat eine klare Mehrheit. Das Modell trifft bewusst keine Aussage — es sagt nicht "seitwaerts", sondern "kein Signal".',
    equities:
      'Kernquote ohne Uebergewicht. Der Kassebestand steigt gegenueber Risk On deutlich an.',
    style:
      'Keine Faktorwetten. In dieser Lage ist die Trefferquote von Stilentscheidungen erfahrungsgemaess am schlechtesten.',
    duration: 'Neutrale Gewichtung; als Absicherung wieder brauchbar, weil die Korrelation sich normalisiert.',
    credit: 'Qualitaet vor Rendite. Der Zusatzertrag schwaecherer Schuldner entschaedigt hier selten fuer das Risiko.',
    watch:
      'Neutral ist der haeufigste Zustand und zugleich der, in dem am meisten falsch gehandelt wird — die Versuchung, aus Langeweile eine Richtung zu setzen, ist gross.',
  },
  {
    regime: 'Risk Off',
    stance:
      'Mindestens ein Faktor steht klar negativ. Absicherung ist teurer geworden, das Umfeld traegt Risiko nicht mehr.',
    equities: 'Deutlich reduziert, Kasse hoch. Erholungen eher zum Abbauen als zum Aufstocken nutzen.',
    style: 'Defensive Qualitaet, stabile Cashflows, geringe Verschuldung. Zyklik und kleine Werte untergewichten.',
    duration:
      'Als Absicherung am wertvollsten — sofern der Ausloeser Wachstum ist und nicht Inflation. Bei einem Inflationsschock versagt dieser Schutz.',
    credit: 'Risiko deutlich zurueckfahren. Aufschlaege weiten sich in diesem Regime typischerweise schnell und ungeordnet.',
    watch:
      'Pruefen, WELCHER Faktor negativ ist. Ein Liquiditaets-Risk-Off verhaelt sich anders als eines aus der Konjunktur — beim ersten hilft Duration, beim zweiten meist auch, bei Funding-Stress dagegen zaehlt allein die Kasse.',
  },
  {
    regime: 'Defensiv',
    stance:
      'Alle drei Faktoren negativ. Diese Lage tritt selten auf und selten lange, war historisch aber der teuerste Zustand fuer Risikoaktiva.',
    equities: 'Auf den Kern reduzieren. Kapitalerhalt geht vor Beteiligung an einer moeglichen Gegenbewegung.',
    style: 'Nur hoechste Qualitaet und Liquiditaet — handelbar bleiben zaehlt mehr als Bewertung.',
    duration: 'Staatsanleihen hoher Bonitaet als Kern der Absicherung, sofern kein Inflationsschock der Ausloeser ist.',
    credit: 'Weitgehend meiden. In dieser Lage trocknet die Liquiditaet am Kreditmarkt zuerst aus.',
    watch:
      'Der Ausstieg aus diesem Regime erfolgt typischerweise ueber die Liquiditaet, nicht ueber die Konjunktur. Der Sentiment-Faktor dreht kontrarisch oft als erster ins Positive — das ist ein Hinweis, kein Startsignal.',
  },
];

/** Welche Indikatoren einen Regimewechsel typischerweise anfuehren. */
export const LEAD_LAG = [
  {
    group: 'Fuehren',
    items: 'Liquiditaetsimpuls, SOFR–IORB, MOVE',
    note: 'Liquiditaet und Refinanzierungsdruck drehen, bevor die Realwirtschaft reagiert. Wechsel kuendigen sich meist im Faktor 2 an.',
  },
  {
    group: 'Folgen',
    items: 'ISM, NFCI, Zinskurve',
    note: 'Konjunkturdaten bestaetigen einen Wechsel, statt ihn anzuzeigen. Der ISM erscheint zudem nur monatlich und mit Verzug.',
  },
  {
    group: 'Bestaetigen',
    items: 'VIX, AAII, Fear & Greed',
    note: 'Sentiment fuehrt so gut wie nie. Es sagt, wie viel Erwartung bereits eingepreist ist — nuetzlich fuer die Frage, wie viel Raum noch bleibt, nicht fuer die Richtung.',
  },
];

export const PLAYBOOK_DISCLAIMER =
  'Dieser Abschnitt ist eine gesetzte Ergaenzung und steht nicht in rules/v1.json. Das Regelwerk selbst leitet aus dem Regime ausschliesslich das Soll-Cash-Band ab. Die Einordnungen zu Aktien, Stil, Duration und Credit folgen der ueblichen Lesart solcher Makro-Regime, sind aber nicht Teil des Modells und keine Anlageberatung.';
