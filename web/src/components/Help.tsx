/**
 * Hilfe-Tab: was jeder Indikator misst, was Veraenderungen bedeuten, wie sich
 * das Gesamtbild zusammensetzt und was sich daraus ableiten laesst.
 *
 * Leitgedanke: KEINE ZWEITE WAHRHEIT. Saemtliche Schwellen, Korridore und
 * Cash-Baender kommen aus dem Regelwerk und dem aktuellen Snapshot. Im Text
 * stehen nur Dinge, die sich nicht aus den Daten ergeben. Verschiebt jemand
 * eine Schwelle in rules/*.json, bewegt sich die Hilfe mit.
 *
 * Die Szenarien werden mit demselben Scoring-Kern gerechnet, der auch die
 * Snapshots erzeugt — genau dafuer ist src/core/ frei von I/O.
 */

import { useMemo } from 'react';
import type {
  HistoryPoint,
  RulesResponse,
  ScenarioBacktest,
  ScenarioBacktestReport,
  Sensitivity,
  Snapshot,
} from '../types';
import { num, scoreText, signed, weekLabel } from '../format';
import { REGIME_COLOR } from './viz';
import { IndicatorCard } from './IndicatorCard';
import { ScoreChip } from './ScoreChip';
import { useScenarios, type ScenarioView } from './useScenarios';
import { FACTOR_HELP, INDICATOR_HELP } from '../content/help';
import { LEAD_LAG, PLAYBOOKS, PLAYBOOK_DISCLAIMER } from '../content/playbooks';
import { SECTIONS, type HelpSection } from '../content/sections';

export type { HelpSection } from '../content/sections';

/** Reihenfolge wie in der Vorlage, nicht alphabetisch. */
const FACTOR_ORDER = ['business_cycle', 'liquidity', 'sentiment'] as const;
const INDICATOR_ORDER: Record<string, string[]> = {
  business_cycle: ['ism_mfg_pmi', 'nfci', 't10y2y'],
  liquidity: ['gli', 'move', 'sofr_iorb'],
  sentiment: ['vix', 'aaii', 'fear_greed'],
};

// ---------------------------------------------------------------------------
// 1 · Mechanik
// ---------------------------------------------------------------------------

function Mechanics({ rules }: { rules: RulesResponse }) {
  const { minCount } = rules.rules.factorAggregation;
  const bands = [...rules.rules.regimeBands].sort((a, b) => b.min - a.min);

  return (
    <div className="panel">
      <div className="panel-head">
        <div className="panel-title">So funktioniert das Scoring</div>
        <div className="panel-sub">Regelwerk {rules.rules.version}</div>
      </div>
      <div className="panel-body">
        <p className="help-lead">
          Neun Indikatoren, drei Faktoren, ein Score. Jeder Indikator bekommt eine von drei
          Bewertungen: <ScoreChip score={1} /> guenstig, <ScoreChip score={0} /> neutral,{' '}
          <ScoreChip score={-1} /> unguenstig. Zwischenstufen gibt es nicht — das ist Absicht, denn
          feinere Abstufungen wuerden eine Genauigkeit vortaeuschen, die die Datenlage nicht hergibt.
        </p>

        <p>
          Ein <strong>Faktor</strong> fasst drei Indikatoren zur Mehrheit zusammen: mindestens{' '}
          {minCount} von 3 positiv ergeben <ScoreChip score={1} />, mindestens {minCount} von 3
          negativ ergeben <ScoreChip score={-1} />, sonst <ScoreChip score={0} />. Ein einzelner
          Ausreisser kippt einen Faktor also nie — es braucht immer zwei.
        </p>

        <p>
          Der <strong>Gesamtscore</strong> ist die Summe der drei Faktorscores und liegt damit
          zwischen −3 und +3. Er bestimmt Regime und Soll-Cash-Band:
        </p>

        <table className="help-table">
          <thead>
            <tr>
              <th>Gesamtscore</th>
              <th>Regime</th>
              <th className="num">Soll-Cash</th>
              <th>Herkunft</th>
            </tr>
          </thead>
          <tbody>
            {bands.map((b) => (
              <tr key={b.label}>
                <td className="num">
                  {b.min === b.max ? scoreText(b.min) : `${scoreText(b.min)} bis ${scoreText(b.max)}`}
                </td>
                <td>
                  <span
                    className="regime-dot"
                    style={{ background: REGIME_COLOR[b.label] ?? '#ccc' }}
                  />
                  {b.label}
                </td>
                <td className="num">
                  {b.cashBand[0]}–{b.cashBand[1]} %
                </td>
                <td className="help-origin">
                  {b.assumed ? (
                    <span className="quality-tag quality-stale">gesetzt</span>
                  ) : (
                    <span className="quality-tag quality-manual">belegt</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="callout" style={{ marginTop: 22 }}>
          <strong>Neutral heisst nicht unbekannt.</strong> Ein Indikator, dessen Wert fehlt, zaehlt
          nicht als neutral, sondern gar nicht — er geht nicht in die Mehrheit ein. Fehlen einem
          Faktor zwei von drei Werten, kann die Mehrheitsregel nicht mehr greifen: der Faktor ist
          dann <em>unbestimmt</em>, nicht neutral. Die App weist solche Wochen ausdruecklich aus, weil
          ihr Gesamtscore sonst wie eine Marktaussage aussaehe, obwohl er nur eine Datenluecke
          abbildet.
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 2 · Die neun Indikatoren
// ---------------------------------------------------------------------------

function Indicators({
  rules,
  snapshot,
  sensitivity,
}: {
  rules: RulesResponse;
  snapshot: Snapshot;
  sensitivity: Sensitivity[];
}) {
  const byIndicator = new Map(sensitivity.map((s) => [s.indicator, s]));

  return (
    <>
      {FACTOR_ORDER.map((factorId, i) => {
        const factor = rules.rules.factors.find((f) => f.id === factorId);
        const fhelp = FACTOR_HELP[factorId];
        const snapFactor = snapshot.factors[factorId];
        if (!factor) return null;

        return (
          <div className="panel" key={factorId}>
            <div className="panel-head">
              <div>
                <div className="panel-title">
                  Faktor {i + 1} · {factor.label}
                </div>
                <div className="panel-sub">{fhelp?.short}</div>
              </div>
              {snapFactor && (
                <div className="help-factor-state">
                  {snapFactor.determinable ? (
                    <>
                      aktuell <ScoreChip score={snapFactor.score} /> · {snapFactor.rationale}
                    </>
                  ) : (
                    <em>aktuell unbestimmt · {snapFactor.rationale}</em>
                  )}
                </div>
              )}
            </div>
            <div className="panel-body">
              {fhelp && <p className="help-lead">{fhelp.detail}</p>}
              <div className="help-cards">
                {(INDICATOR_ORDER[factorId] ?? []).map((id) => (
                  <IndicatorCard
                    key={id}
                    id={id}
                    rules={rules}
                    indicator={snapshot.indicators[id]}
                    sensitivity={byIndicator.get(id)}
                  />
                ))}
              </div>
            </div>
          </div>
        );
      })}
    </>
  );
}

// ---------------------------------------------------------------------------
// 3 · Szenarien — gerechnet, nicht hinterlegt
// ---------------------------------------------------------------------------

/** Regimeverteilung als Klartext, z. B. "37x Neutral, 16x Risk Off". */
function regimeTally(byRegime: Record<string, number>): string {
  return Object.entries(byRegime)
    .sort((a, b) => b[1] - a[1])
    .map(([label, n]) => `${n}× ${label}`)
    .join(', ');
}

/**
 * Was der Bestand ueber ein Szenario hergibt.
 *
 * Die Abgrenzung ist der wichtigste Teil dieses Blocks: gezaehlt wird, WANN
 * diese Lage schon einmal galt — nicht, wie wahrscheinlich sie eintritt. Ohne
 * diesen Satz steht eine Trefferzahl direkt neben einer kontrafaktischen
 * Rechnung und liest sich wie eine Quote.
 */
function ScenarioBacktestNote({
  backtest,
  basisWeeks,
}: {
  backtest: ScenarioBacktest;
  basisWeeks: number;
}) {
  const { occurrences, episodes, largestEpisodeShare, lastWeek, byRegime, coverage } = backtest;

  if (occurrences === 0) {
    /*
     * Die nackte Null waere irrefuehrend — sie liest sich wie ein Befund ueber
     * den Markt. Deshalb steht daneben, welche der Annahmen den Ausschlag gibt:
     * ein gemeinsames Vorkommen kann nie haeufiger sein als die seltenste
     * Einzelannahme. Ist der Indikator zusaetzlich lueckenhaft, wird auch das
     * genannt — beides sind Aussagen ueber die Datenlage, nicht ueber den Markt.
     */
    const scarcest = coverage.find((c) => c.id === backtest.limitedBy);
    return (
      <div className="help-scenario-backtest">
        Diese Lage kam im Bestand <strong>nie</strong> vor.
        {scarcest && (
          <>
            {' '}
            Die engste der Annahmen ist {scarcest.label}:{' '}
            {scarcest.weeksMatching === 0 ? (
              <>sie traf im ganzen Bestand kein einziges Mal zu.</>
            ) : (
              <>
                sie traf allein in {scarcest.weeksMatching} von {basisWeeks} belastbaren Wochen zu —
                nie gemeinsam mit den uebrigen.
              </>
            )}
            {scarcest.weeksWithValue < basisWeeks && (
              <>
                {' '}
                Der Indikator traegt ohnehin nur in {scarcest.weeksWithValue}{' '}
                {scarcest.weeksWithValue === 1 ? 'Woche' : 'Wochen'} einen Wert
                {scarcest.firstWeekWithValue && (
                  <> (erst ab {weekLabel(scarcest.firstWeekWithValue)})</>
                )}
                .
              </>
            )}
          </>
        )}{' '}
        Gezaehlt wird, wann diese Lage schon einmal galt — keine Aussage darueber, wie
        wahrscheinlich sie eintritt.
      </div>
    );
  }

  return (
    <div className="help-scenario-backtest">
      So lag es in{' '}
      <strong>
        {occurrences} von {basisWeeks}
      </strong>{' '}
      belastbaren Wochen ({episodes} {episodes === 1 ? 'Episode' : 'Episoden'}, groesste{' '}
      {Math.round(largestEpisodeShare * 100)} %)
      {lastWeek && <>, zuletzt {weekLabel(lastWeek)}</>}. Regime damals: {regimeTally(byRegime)}.
      <ul>
        {backtest.horizons.map((h) => (
          <li key={h.weeks}>
            Nach {h.weeks} Wochen:{' '}
            {h.evaluated === 0 ? (
              <em>noch kein Ausblick im Bestand</em>
            ) : (
              <>
                {regimeTally(h.byRegime)} — {h.changed} von {h.evaluated} mit gewechseltem Regime
                {h.truncated > 0 && (
                  <>
                    {' '}
                    (fuer {h.truncated} {h.truncated === 1 ? 'Vorkommen liegt' : 'Vorkommen liegen'}{' '}
                    die Sicht noch nicht vor)
                  </>
                )}
              </>
            )}
          </li>
        ))}
      </ul>
      Gezaehlt wird, wann diese Lage schon einmal galt — keine Aussage darueber, wie wahrscheinlich
      sie eintritt. Und der Bestand ist rueckgerechnet: er zeigt, wie das Modell die Lage gesehen
      HAETTE, nicht wie es sie gesehen hat.
    </div>
  );
}

function Scenarios({
  snapshot,
  rules,
  scenarios,
}: {
  snapshot: Snapshot;
  rules: RulesResponse;
  scenarios: ScenarioBacktestReport | null;
}) {
  const results = useScenarios(snapshot, rules, scenarios);

  return (
    <div className="panel">
      <div className="panel-head">
        <div>
          <div className="panel-title">Szenarien</div>
          <div className="panel-sub">
            gerechnet von der Lage in {weekLabel(snapshot.weekKey)} aus, mit demselben Scoring-Kern
            wie die Snapshots — die Wochenauswahl im Dashboard zieht sie mit; jede belastbare Woche
            des Bestands laesst sich hier durchspielen
          </div>
        </div>
      </div>
      <div className="panel-body">
        {!snapshot.meaningful && (
          <div className="callout warn" style={{ marginBottom: 18 }}>
            Die Ausgangslage dieser Woche ist unvollstaendig — die Szenarien rechnen zwar, ihre
            Ergebnisse sind aber genauso wenig aussagekraeftig wie der Ausgangsstand.
          </div>
        )}

        {/*
          Die Ausgangslage gehoert ausgeschrieben. Ohne sie muss man sich das
          "vorher" aus vier Kacheln zusammenreimen.
        */}
        <p className="help-scenario-base">
          <strong>Ausgangslage {weekLabel(snapshot.weekKey)}:</strong> Gesamtscore{' '}
          {scoreText(snapshot.total)} · {snapshot.regime.label} · Cash{' '}
          {snapshot.regime.cashBand[0]}–{snapshot.regime.cashBand[1]} %
        </p>

        <div className="help-scenarios">
          {results.map((r) => (
            <div key={r.scenarioId} className={`help-scenario${r.changed ? ' flips' : ''}`}>
              <div className="help-scenario-title">{r.title}</div>
              <div className="help-scenario-trigger">{r.trigger}</div>

              {/*
                Vier Spalten statt Fliesstext: Label, Vorher, Pfeil, Nachher.
                Der Wrapper je Zeile traegt display:contents, damit alle Zeilen
                einer Karte im selben Raster haengen — sonst wanderten die
                Chips mit der Labellaenge, und das Auge findet beim Vergleich
                zweier Zeilen keine gemeinsame Kante.
              */}
              <div className="help-scenario-moves">
                {r.alreadyTrue ? (
                  <em className="help-scenario-wide">
                    Die angenommenen Werte entsprechen bereits dem aktuellen Stand — dieses Szenario
                    ist eingetreten.
                  </em>
                ) : (
                  r.moves.map((m) => (
                    <div key={m.id} className="help-scenario-move">
                      <span className="help-scenario-move-label">{m.label}</span>
                      <ScoreChip score={m.before} />
                      <span className="help-scenario-arrow">→</span>
                      <ScoreChip score={m.after} />
                    </div>
                  ))
                )}
                {r.assumedWithoutValue.map((id) => (
                  <div key={id} className="help-scenario-assumed help-scenario-wide">
                    {snapshot.indicators[id]?.label ?? id} traegt in dieser Woche keinen Wert — das
                    Szenario setzt ihn an, statt ihn zu bewegen.
                  </div>
                ))}
              </div>

              {/*
                Drei gleich breite Spalten. Da alle Karten dieselben drei
                Faktornamen tragen, fluchten die Chips dadurch nicht nur
                innerhalb einer Karte, sondern auch von Karte zu Karte.
              */}
              <div className="help-scenario-factors">
                {r.factors.map((f) => (
                  <span key={f.id} className={f.before !== f.after ? 'moved' : ''}>
                    <span className="help-scenario-factor-label">{f.label}</span>
                    <ScoreChip score={f.after} />
                  </span>
                ))}
              </div>

              <div className="help-scenario-result">
                <span>
                  Gesamtscore {scoreText(r.totalBefore)} → <strong>{scoreText(r.totalAfter)}</strong>
                </span>
                <span
                  className="help-scenario-regime"
                  style={{ borderColor: REGIME_COLOR[r.regimeAfter.label] ?? '#ccc' }}
                >
                  {r.changed ? (
                    <>
                      {r.regimeBefore.label} → <strong>{r.regimeAfter.label}</strong> · Cash{' '}
                      {r.regimeAfter.cashBand[0]}–{r.regimeAfter.cashBand[1]} %
                    </>
                  ) : (
                    <>Regime bleibt {r.regimeAfter.label}</>
                  )}
                </span>
              </div>

              <div className="help-scenario-narrative">{r.narrative}</div>

              {/* Faellt /api/scenarios aus, entfaellt der Block wortlos. */}
              {r.backtest && scenarios && (
                <ScenarioBacktestNote backtest={r.backtest} basisWeeks={scenarios.basisWeeks} />
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 4 · Anlageklassen im Regime
// ---------------------------------------------------------------------------

/**
 * Erklaerender Abschnitt. Die tatsaechliche Auswertung liegt im Tab "Verlauf"
 * unter der Delta-Tabelle (web/src/components/AssetSection.tsx) — dort stehen
 * auch die Live-Hinweise zu Stichprobe und Konzentration, die hier nicht
 * wiederholt, sondern eingeordnet werden.
 *
 * Der Umfang des Bestands wird gezaehlt, nicht behauptet. Hier stand einmal
 * eine feste Zahl; sie war schon veraltet, bevor jemand sie bemerkte.
 */
function AssetPerformanceHelp({
  points,
  meaningfulFrom,
}: {
  points: HistoryPoint[];
  meaningfulFrom: string | null;
}) {
  const meaningful = points.filter((p) => p.completeness !== 'sparse');
  const riskOff = meaningful.filter((p) => p.regime === 'Risk Off').length;

  return (
    <div className="panel">
      <div className="panel-head">
        <div>
          <div className="panel-title">Anlageklassen im Regime</div>
          <div className="panel-sub">
            die Auswertung selbst liegt im Tab Verlauf, unter der Delta-Tabelle
          </div>
        </div>
      </div>
      <div className="panel-body">
        <p className="help-lead">
          Ein Regime, das keinen Unterschied macht, waere ein Regime, dem man nicht trauen sollte.
          Dieser Teil der App legt deshalb Kursverlaeufe verschiedener Anlageklassen ueber die
          Regime-Phasen — als Gegenprobe an den eigenen Zahlen, nicht als Beweis.
        </p>

        <p>
          Unter dem Gesamtscore liegt ein zweites Diagramm mit den Kursverlaeufen, auf 100 zum
          Beginn des sichtbaren Zeitraums indexiert und mit derselben Regime-Schattierung im
          Hintergrund wie das Score-Diagramm — beide Felder teilen sich Breite und Zeitachse, damit
          sich senkrecht ablesen laesst, was eine Anlageklasse waehrend einer Phase getan hat.
          Bewusst <strong>keine zweite y-Achse</strong>: Score und Kursindex auf einer Flaeche
          liessen sich so skalieren, dass dieselbe Datenlage nach Gleichlauf oder nach Gegenlauf
          aussieht — der Zusammenhang entstuende dann aus der Achsenwahl, nicht aus den Daten.
        </p>

        <div className="help-why">
          <span className="help-why-label">Gemessen wird die Folgewoche</span>
          Das Regime einer Woche steht erst an deren Ende fest. Wer danach handelt, ist erst in der
          Woche darauf investiert — jede Kennzahl misst deshalb den Ertrag der Woche NACH dem
          Signal, nie derselben. Die naheliegende Zuordnung derselben Woche waere ein Blick in die
          Zukunft und wuerde jede Zahl beschoenigen.
        </div>

        <p>
          Gerechnet wird auf dem Gesamtertrag (inklusive Ausschuettungen), nicht auf dem reinen
          Kurs. Bei Anleihe-Fonds macht der Kupon den groessten Teil der Rendite aus — mit reinen
          Kursen waeren sie systematisch schlechtgerechnet und mit Aktien nicht fair vergleichbar.
        </p>

        <p>
          <strong>Hoechstens vier Linien gleichzeitig.</strong> Mehr Farben lassen sich auch bei
          normalem Farbsehen nicht mehr zuverlaessig unterscheiden — geprueft, nicht geschaetzt.
          Jede Anlageklasse hat einen festen Platz in der Auswahl, der sich nicht verschiebt, wenn
          andere zu- oder abgeschaltet werden.
        </p>

        <div className="help-why">
          <span className="help-why-label">Ausschnitt waehlen</span>
          Ueber 800 Wochen auf einer Diagrammbreite ergeben rund einen Bildpunkt je Woche — lesbar
          wird das erst im Ausschnitt. Das Mausrad ueber einem Diagramm zoomt (die Woche unter dem
          Zeiger bleibt dabei stehen), Ziehen verschiebt, Umschalt+Rad blaettert seitwaerts. Die
          Leiste unter den Diagrammen zeigt, wo im Gesamtbestand man steht, und laesst sich an
          ihren Griffen aufziehen oder als Ganzes verschieben. Score- und Kursdiagramm teilen sich
          dabei IMMER denselben Ausschnitt — sonst waere der senkrechte Vergleich wertlos. Beim
          Zoomen wird der Kursindex auf den ersten sichtbaren Punkt neu gesetzt, damit sich die
          100er-Linie nicht auf eine Woche ausserhalb des Bildes bezieht.
        </div>

        <div className="callout warn">
          <strong>Zwei Modi, unterschiedliche Aussagekraft.</strong> Das echte Modell traegt derzeit{' '}
          <strong>{meaningful.length} belastbare Wochen</strong>
          {meaningfulFrom && <> (ab {weekLabel(meaningfulFrom)})</>}, davon {riskOff} in Risk Off.
          Das Vergleichsmodell 2018 rechnet mit sechs statt neun Indikatoren. Das ist eine ANDERE
          METHODIK, nicht die Verlaengerung des echten Modells: sein Sentiment-Faktor besteht allein
          aus dem VIX, sein Business-Cycle-Faktor nur aus NFCI und Zinskurve. Er wird nie
          gespeichert, sondern bei Bedarf aus den Rohdaten neu gerechnet — und er ist kein Ersatz
          fuer den Bestand des echten Modells, sondern eine Gegenprobe mit anderer Zusammensetzung.
        </div>

        <p>
          <strong>Eine Zahl kann an einer einzigen Phase haengen.</strong> Die Kennzahlen-Tabelle
          zeigt neben jeder Rendite die Zahl der Wochen und der zusammenhaengenden Episoden. Im
          Vergleichsmodell etwa stammt der Grossteil der Risk-On-Wochen aus zwei laengeren Phasen
          rund um 2020 — "n = 73" sieht nach einer breiten Stichprobe aus, ist im Kern aber eine
          Handvoll unabhaengiger Beobachtungen. Solche Zellen tragen einen Stern; unter acht Wochen
          erscheint gar keine Zahl, sondern der Hinweis darauf.
        </p>

        <p className="help-lead" style={{ marginTop: 4 }}>
          Was daraus folgt, bleibt Rueckschau. Dass eine Anlageklasse in einem Regime bisher gut
          lief, ist keine Garantie, dass sie es weiter tut — die Auswertung prueft das Modell, sie
          ersetzt kein Urteil.
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 5 · Ableitung fuer den Handel
// ---------------------------------------------------------------------------

/**
 * Wie viele Prozentpunkte trennen zwei Cash-Baender.
 *
 * Springen beide Grenzen gleich weit, waere "15 bis 15 Prozentpunkte" ein
 * Stolperstein beim Lesen — dann steht dort nur eine Zahl.
 */
function stepText(from: [number, number], to: [number, number]): string {
  const lo = to[0] - from[0];
  const hi = to[1] - from[1];
  return lo === hi ? `${lo} Prozentpunkte` : `${lo} bis ${hi} Prozentpunkte`;
}

function Trading({ rules, snapshot }: { rules: RulesResponse; snapshot: Snapshot }) {
  const bands = [...rules.rules.regimeBands].sort((a, b) => b.min - a.min);
  const current = snapshot.regime.label;

  return (
    <>
      <div className="panel">
        <div className="panel-head">
          <div>
            <div className="panel-title">Was das Regelwerk ableitet</div>
            <div className="panel-sub">aus rules/{rules.rules.version}.json — die einzige Groesse, die das Modell selbst vorgibt</div>
          </div>
        </div>
        <div className="panel-body">
          <p className="help-lead">
            Das Modell leitet aus dem Regime genau eine Groesse ab: die Soll-Kassenquote. Ein
            Regimewechsel ist damit immer auch eine konkrete Anweisung — von{' '}
            {bands[0]!.cashBand[0]}–{bands[0]!.cashBand[1]} % in {bands[0]!.label} auf{' '}
            {bands[1]!.cashBand[0]}–{bands[1]!.cashBand[1]} % in {bands[1]!.label} ist ein
            spuerbarer Schritt, der nicht von einer Meinung abhaengt, sondern von der
            Mehrheitsregel.
          </p>

          <table className="help-table">
            <thead>
              <tr>
                <th>Regime</th>
                <th className="num">Soll-Cash</th>
                <th>Was ein Wechsel hierhin bedeutet</th>
              </tr>
            </thead>
            <tbody>
              {bands.map((b, i) => {
                const prev = bands[i - 1];
                return (
                  <tr key={b.label} className={b.label === current ? 'is-current' : ''}>
                    <td>
                      <span className="regime-dot" style={{ background: REGIME_COLOR[b.label] ?? '#ccc' }} />
                      {b.label}
                      {b.label === current && <span className="help-now">aktuell</span>}
                    </td>
                    <td className="num">
                      {b.cashBand[0]}–{b.cashBand[1]} %
                    </td>
                    <td>
                      {prev ? (
                        <>
                          Kasse von {prev.cashBand[0]}–{prev.cashBand[1]} % auf {b.cashBand[0]}–
                          {b.cashBand[1]} % erhoehen — {stepText(prev.cashBand, b.cashBand)}{' '}
                          weniger investiert.
                        </>
                      ) : (
                        <>Hoechste Investitionsquote des Modells.</>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <div className="help-leadlag">
            <div className="help-leadlag-title">Wer fuehrt, wer folgt</div>
            {LEAD_LAG.map((g) => (
              <div key={g.group} className="help-leadlag-row">
                <div className="help-leadlag-group">{g.group}</div>
                <div>
                  <div className="help-leadlag-items">{g.items}</div>
                  <div className="help-leadlag-note">{g.note}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="panel panel-authored">
        <div className="panel-head">
          <div>
            <div className="panel-title">
              Einordnung je Anlageklasse
              <span className="quality-tag quality-stale">gesetzt, nicht abgeleitet</span>
            </div>
            <div className="panel-sub">steht nicht im Regelwerk — siehe Hinweis unten</div>
          </div>
        </div>
        <div className="panel-body">
          <div className="callout warn" style={{ marginBottom: 20 }}>
            <strong>Herkunft dieses Abschnitts:</strong> {PLAYBOOK_DISCLAIMER}
          </div>

          {PLAYBOOKS.map((p) => (
            <div key={p.regime} className={`help-playbook${p.regime === current ? ' is-current' : ''}`}>
              <div className="help-playbook-head">
                <span className="regime-dot" style={{ background: REGIME_COLOR[p.regime] ?? '#ccc' }} />
                <strong>{p.regime}</strong>
                {p.regime === current && <span className="help-now">aktuell</span>}
              </div>
              <div className="help-playbook-stance">{p.stance}</div>
              <dl className="help-playbook-grid">
                <dt>Aktien</dt>
                <dd>{p.equities}</dd>
                <dt>Stil</dt>
                <dd>{p.style}</dd>
                <dt>Duration</dt>
                <dd>{p.duration}</dd>
                <dt>Credit</dt>
                <dd>{p.credit}</dd>
              </dl>
              <div className="help-playbook-watch">
                <strong>Worauf achten:</strong> {p.watch}
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// 6 · Grenzen
// ---------------------------------------------------------------------------

function Limits({
  rules,
  snapshot,
  meaningfulFrom,
}: {
  rules: RulesResponse;
  snapshot: Snapshot;
  meaningfulFrom: string | null;
}) {
  return (
    <div className="panel">
      <div className="panel-head">
        <div className="panel-title">Was diese App nicht sagt</div>
      </div>
      <div className="panel-body">
        <p className="help-lead">
          Die folgenden Einschraenkungen sind keine Randnotizen — sie bestimmen, wie weit man den
          Zahlen trauen darf.
        </p>

        <ul className="help-limits">
          <li>
            <strong>Eine der neun Reihen ist ein Ersatz.</strong> Der Howell GLI ist kostenpflichtig
            und hat keine offene Schnittstelle. An seiner Stelle steht Fed Net Liquidity — gleiche
            Form, anderer Aggregatbegriff. Er ist ueberall als Ersatzreihe gekennzeichnet.
          </li>
          <li>
            <strong>
              Belastbare Historie {meaningfulFrom ? <>erst ab {weekLabel(meaningfulFrom)}</> : 'ist noch sehr kurz'}.
            </strong>{' '}
            Der Begrenzer ist der <strong>ISM Manufacturing PMI</strong>: die Pressemitteilung gibt
            oeffentlich nur rund ein Jahr her. Aeltere Wochen tragen zwar einen Gesamtscore, aber
            bei ihnen ist mindestens ein Faktor nicht bestimmbar; die Verlaufsansicht setzt sie
            schraffiert ab. Die beiden anderen einst lueckenhaften Reihen sind nachladbar:{' '}
            <code>npm run import:aaii</code> holt die AAII-Umfrage ab Juli 1987 aus der offiziellen
            Arbeitsmappe, <code>npm run import:feargreed</code> eine Rekonstruktion von Fear &amp;
            Greed ab 2011 (beides naeher in den jeweiligen Karten im Abschnitt „Die neun
            Indikatoren").
          </li>
          <li>
            <strong>ISM und NFCI werden revidiert.</strong> Ein Score, der auf einem knappen
            Ausschlag beruhte, kann sich mit der naechsten Datenrevision anders darstellen. Die
            Snapshots halten fest, was zum jeweiligen Zeitpunkt bekannt war.
          </li>
          <li>
            <strong>Backfill-Staende sind keine veroeffentlichten Staende.</strong> Sie beruhen auf
            heutigen, teils revidierten Daten und rekonstruieren, was das Modell gesagt HAETTE —
            nicht, was es damals gesagt hat.
          </li>
          <li>
            <strong>Das Modell prognostiziert nicht.</strong> Es beschreibt die Lage nach festen
            Regeln. Ob diese Regeln in Zukunft tragen, sagt kein Indikator.
          </li>
        </ul>

        <details className="help-details" style={{ marginTop: 20 }}>
          <summary>
            Alle {rules.assumptions.length} gesetzten Annahmen des Regelwerks im Wortlaut
          </summary>
          <div className="help-details-body">
            <p>
              Diese Liste wird aus dem Regelwerk erzeugt, nicht abgetippt. Jede Stelle, die dort mit{' '}
              <code>"assumed": true</code> markiert ist, erscheint hier automatisch.
            </p>
            {rules.assumptions.map((a, i) => (
              <div key={i} className="help-assumption">
                <div className="help-assumption-scope">{a.scope}</div>
                <div>{a.note}</div>
              </div>
            ))}
          </div>
        </details>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

/**
 * Der Abschnitt wird von aussen gehalten (App.tsx), nicht hier.
 *
 * Grund: das Dashboard verweist gezielt auf die Szenarien und muss Tab UND
 * Abschnitt in einem Zug setzen koennen. Mit lokalem State und einem
 * initialSection-Prop bliebe ein zweiter Klick auf denselben Verweis
 * wirkungslos, weil sich der Prop nicht aendert.
 *
 * HelpSection und SECTIONS selbst stehen in content/sections.ts — dort auch
 * von web/src/route.ts gelesen, das kein Modul voller JSX importieren darf.
 */
type Section = HelpSection;

export function Help({
  rules,
  snapshot,
  sensitivity,
  meaningfulFrom,
  historyPoints,
  scenarios,
  section,
  onSectionChange,
}: {
  rules: RulesResponse | null;
  snapshot: Snapshot;
  sensitivity: Sensitivity[];
  /** Fruehester belastbarer Wochenschluessel im Bestand, aus /api/history. */
  meaningfulFrom: string | null;
  /** Der Bestand selbst — der Abschnitt "Anlageklassen" zaehlt daraus, statt Zahlen zu behaupten. */
  historyPoints: HistoryPoint[];
  /** Historische Auswertung der Szenarien; null, wenn /api/scenarios ausfiel. */
  scenarios: ScenarioBacktestReport | null;
  section: Section;
  onSectionChange: (section: Section) => void;
}) {
  if (!rules) {
    return <div className="center-note">Regelwerk wird geladen …</div>;
  }

  return (
    <>
      <div className="help-nav">
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            className={`help-nav-item${section === s.id ? ' active' : ''}`}
            onClick={() => onSectionChange(s.id)}
          >
            {s.label}
          </button>
        ))}
      </div>

      {section === 'mechanik' && <Mechanics rules={rules} />}
      {section === 'indikatoren' && (
        <Indicators rules={rules} snapshot={snapshot} sensitivity={sensitivity} />
      )}
      {section === 'szenarien' && (
        <Scenarios snapshot={snapshot} rules={rules} scenarios={scenarios} />
      )}
      {section === 'anlageklassen' && (
        <AssetPerformanceHelp points={historyPoints} meaningfulFrom={meaningfulFrom} />
      )}
      {section === 'handel' && <Trading rules={rules} snapshot={snapshot} />}
      {section === 'grenzen' && (
        <Limits rules={rules} snapshot={snapshot} meaningfulFrom={meaningfulFrom} />
      )}
    </>
  );
}
