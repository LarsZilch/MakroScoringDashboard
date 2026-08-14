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

import { useMemo, useState } from 'react';
import { aggregateFactor, resolveRegime } from '../../../src/core/scoring.js';
import type { ScoredIndicator as CoreScoredIndicator, RuleBook as CoreRuleBook } from '../../../src/core/types.js';
import type {
  RulesResponse,
  ScoredIndicator,
  Score,
  Sensitivity,
  Snapshot,
} from '../types';
import { num, scoreText, signed, weekLabel } from '../format';
import { REGIME_COLOR } from './viz';
import { BandScale } from './BandScale';
import { FACTOR_HELP, INDICATOR_HELP, SCENARIOS, type Scenario } from '../content/help';
import { LEAD_LAG, PLAYBOOKS, PLAYBOOK_DISCLAIMER } from '../content/playbooks';

/** Reihenfolge wie in der Vorlage, nicht alphabetisch. */
const FACTOR_ORDER = ['business_cycle', 'liquidity', 'sentiment'] as const;
const INDICATOR_ORDER: Record<string, string[]> = {
  business_cycle: ['ism_mfg_pmi', 'nfci', 't10y2y'],
  liquidity: ['gli', 'move', 'sofr_iorb'],
  sentiment: ['vix', 'aaii', 'fear_greed'],
};

function ScoreChip({ score }: { score: Score }) {
  const cls = score > 0 ? 'pos' : score < 0 ? 'neg' : 'zero';
  return <span className={`score-chip ${cls}`}>{scoreText(score)}</span>;
}

/**
 * Die Messgroessen der Kalibrierung tragen im Regelwerk technische Namen.
 * In einem Hilfetext haben rohe Feldnamen nichts verloren.
 */
const CALIBRATION_LABEL: Record<string, string> = {
  standardDeviation: 'Standardabweichung',
  absPercentile33: '33. Perzentil des Betrags',
  absPercentile50: 'Median des Betrags (50. Perzentil)',
};

function calibrationLabel(key: string): string {
  return CALIBRATION_LABEL[key] ?? key;
}

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

function IndicatorCard({
  id,
  rules,
  indicator,
  sensitivity,
}: {
  id: string;
  rules: RulesResponse;
  indicator?: ScoredIndicator;
  sensitivity?: Sensitivity;
}) {
  const rule = rules.rules.indicators[id];
  const help = INDICATOR_HELP[id];
  if (!rule || !help) return null;

  const missing = !indicator || indicator.quality === 'missing';
  const label = rule.quality === 'proxy' && rule.proxyLabel ? rule.proxyLabel : rule.label;

  return (
    <div className="help-card">
      <div className="help-card-head">
        <div>
          <div className="help-card-title">
            {label}
            {rule.quality === 'proxy' && <span className="quality-tag quality-proxy">Ersatzreihe</span>}
            {rule.contrarian && <span className="quality-tag quality-manual">kontrarisch</span>}
            {rule.invertedScale && <span className="quality-tag quality-manual">invertiert</span>}
          </div>
          <div className="help-card-short">{help.short}</div>
        </div>
        {!missing && <ScoreChip score={indicator!.score} />}
      </div>

      <div className="help-card-body">
        <p>{help.measures}</p>

        <div className="help-why">
          <span className="help-why-label">Warum im Modell</span>
          {help.why}
        </div>

        {help.twist && (
          <div className="help-twist">
            <strong>Achtung, Richtung:</strong> {help.twist}
          </div>
        )}

        <div className="help-reading">
          <div>
            <span className="help-arrow up">steigt</span>
            {help.reading.up}
          </div>
          <div>
            <span className="help-arrow down">faellt</span>
            {help.reading.down}
          </div>
        </div>

        <div className="help-scale-wrap">
          <div className="help-scale-label">
            Bewertungsstufen{' '}
            <span className="help-scale-hint">
              — gerendert aus dem Regelwerk, Marke zeigt den aktuellen Stand
            </span>
          </div>
          <BandScale
            bands={rule.bands}
            value={missing ? null : indicator!.measureValue}
            unit={rule.unit}
            decimals={rule.decimals}
          />
        </div>

        {missing ? (
          <div className="help-current missing">
            Fuer diese Woche liegt kein Wert vor — der Indikator geht nicht in die Mehrheit ein.
          </div>
        ) : (
          <div className="help-current">
            <strong>Aktuell:</strong> {indicator!.display?.primary ?? num(indicator!.measureValue ?? 0, rule.decimals)}
            {indicator!.display?.secondary ? ` · ${indicator!.display.secondary}` : ''}
            {sensitivity && (
              <>
                {' '}— bis zur naechsten Stufe fehlen{' '}
                <strong>
                  {num(sensitivity.gap, rule.decimals)} {rule.unit}
                </strong>{' '}
                ({sensitivity.direction === 'up' ? 'nach oben' : 'nach unten'}), dann{' '}
                <ScoreChip score={sensitivity.toScore} />
                {sensitivity.changesRegime && (
                  <em> — und das Regime wechselt zu {sensitivity.resultingRegime}.</em>
                )}
              </>
            )}
          </div>
        )}

        <details className="help-details">
          <summary>Datenherkunft, Annahmen und Einschraenkungen</summary>
          <div className="help-details-body">
            <p>
              <strong>Quelle.</strong> {help.source}
            </p>

            {help.watchOut && (
              <p>
                <strong>Beim Lesen beachten.</strong> {help.watchOut}
              </p>
            )}

            {rule.proxyNote && (
              <p>
                <strong>Ersatzreihe.</strong> {rule.proxyNote}
              </p>
            )}

            {rule.calibration && (
              <div className="help-calibration">
                <strong>Kalibrierung der Schwelle.</strong> Diese Schwelle wurde an der Reihe selbst
                gemessen, nicht gegriffen.
                <ul>
                  <li>Grundlage: {rule.calibration.basis}</li>
                  <li>Gemessen am: {rule.calibration.measuredOn}</li>
                  {Object.entries(rule.calibration.observed).map(([k, v]) => (
                    <li key={k}>
                      {calibrationLabel(k)}: {num(v, 1)} {rule.unit}
                    </li>
                  ))}
                  <li>Gewaehlte Schwelle: ±{num(rule.calibration.chosenThreshold, 1)}</li>
                  <li>Ergebnis: {rule.calibration.resultingSplit}</li>
                </ul>
                <p className="help-calibration-warn">{rule.calibration.warning}</p>
              </div>
            )}

            {rule.assumed && rule.assumptionNote && (
              <p>
                <strong>Gesetzte Annahme.</strong> {rule.assumptionNote}
              </p>
            )}
          </div>
        </details>
      </div>
    </div>
  );
}

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

interface ScenarioResult {
  scenario: Scenario;
  factors: { id: string; label: string; before: Score; after: Score }[];
  totalBefore: number;
  totalAfter: number;
  regimeBefore: string;
  regimeAfter: string;
  cashAfter: [number, number];
  changed: boolean;
  affected: { id: string; label: string; before: Score; after: Score }[];
}

/**
 * Ein Szenario auf die aktuelle Lage anwenden.
 *
 * Gerechnet wird mit aggregateFactor() und resolveRegime() aus dem echten
 * Scoring-Kern — derselbe Code, der die Snapshots erzeugt. Eine zweite
 * Implementierung im Frontend koennte auseinanderlaufen; das ist der Grund,
 * warum src/core/ ohne Datei- und Netzzugriff gebaut ist.
 */
function runScenario(
  scenario: Scenario,
  snapshot: Snapshot,
  rules: RulesResponse,
): ScenarioResult | null {
  const core = rules.rules as unknown as CoreRuleBook;
  const minCount = rules.rules.factorAggregation.minCount;

  const factors: ScenarioResult['factors'] = [];
  const affected: ScenarioResult['affected'] = [];
  let totalAfter = 0;

  for (const factorId of FACTOR_ORDER) {
    const snapFactor = snapshot.factors[factorId];
    if (!snapFactor) return null;

    const members = (INDICATOR_ORDER[factorId] ?? []).map((id) => {
      const ind = snapshot.indicators[id];
      const override = scenario.overrides[id];
      if (override !== undefined && ind) {
        if (ind.score !== override) {
          affected.push({ id, label: ind.label, before: ind.score, after: override });
        }
        return { ...ind, score: override } as unknown as CoreScoredIndicator;
      }
      return ind as unknown as CoreScoredIndicator;
    });

    const after = aggregateFactor(
      factorId as never,
      snapFactor.label,
      members.filter(Boolean),
      minCount,
    );
    factors.push({
      id: factorId,
      label: snapFactor.label,
      before: snapFactor.score,
      after: after.score,
    });
    totalAfter += after.score;
  }

  const regimeAfter = resolveRegime(core, totalAfter);

  return {
    scenario,
    factors,
    totalBefore: snapshot.total,
    totalAfter,
    regimeBefore: snapshot.regime.label,
    regimeAfter: regimeAfter.label,
    cashAfter: regimeAfter.cashBand,
    changed: regimeAfter.label !== snapshot.regime.label,
    affected,
  };
}

function Scenarios({ snapshot, rules }: { snapshot: Snapshot; rules: RulesResponse }) {
  const results = useMemo(
    () =>
      SCENARIOS.map((s) => runScenario(s, snapshot, rules)).filter(
        (r): r is ScenarioResult => r !== null,
      ),
    [snapshot, rules],
  );

  return (
    <div className="panel">
      <div className="panel-head">
        <div>
          <div className="panel-title">Szenarien</div>
          <div className="panel-sub">
            gerechnet von der Lage in {weekLabel(snapshot.weekKey)} aus, mit demselben Scoring-Kern
            wie die Snapshots
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

        <div className="help-scenarios">
          {results.map((r) => (
            <div key={r.scenario.id} className={`help-scenario${r.changed ? ' flips' : ''}`}>
              <div className="help-scenario-title">{r.scenario.title}</div>
              <div className="help-scenario-trigger">{r.scenario.trigger}</div>

              <div className="help-scenario-moves">
                {r.affected.length === 0 ? (
                  <em>
                    Die angenommenen Werte entsprechen bereits dem aktuellen Stand — dieses Szenario
                    ist eingetreten.
                  </em>
                ) : (
                  r.affected.map((a) => (
                    <div key={a.id}>
                      {a.label}: <ScoreChip score={a.before} /> →{' '}
                      <ScoreChip score={a.after} />
                    </div>
                  ))
                )}
              </div>

              <div className="help-scenario-factors">
                {r.factors.map((f) => (
                  <span key={f.id} className={f.before !== f.after ? 'moved' : ''}>
                    {f.label} <ScoreChip score={f.after} />
                  </span>
                ))}
              </div>

              <div className="help-scenario-result">
                <span>
                  Gesamtscore {scoreText(r.totalBefore)} → <strong>{scoreText(r.totalAfter)}</strong>
                </span>
                <span
                  className="help-scenario-regime"
                  style={{ borderColor: REGIME_COLOR[r.regimeAfter] ?? '#ccc' }}
                >
                  {r.changed ? (
                    <>
                      {r.regimeBefore} → <strong>{r.regimeAfter}</strong> · Cash {r.cashAfter[0]}–
                      {r.cashAfter[1]} %
                    </>
                  ) : (
                    <>Regime bleibt {r.regimeAfter}</>
                  )}
                </span>
              </div>

              <div className="help-scenario-narrative">{r.scenario.narrative}</div>
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
 * Rein erklaerender Abschnitt, ohne eigene Daten. Die tatsaechliche Auswertung
 * mit den aktuellen Zahlen liegt im Tab "Verlauf" unter der Delta-Tabelle
 * (web/src/components/AssetSection.tsx) — dort stehen auch die Live-Hinweise
 * zu Stichprobe und Konzentration, die hier nicht wiederholt, sondern
 * eingeordnet werden.
 */
function AssetPerformanceHelp() {
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

        <div className="callout warn">
          <strong>Zwei Modi, unterschiedliche Aussagekraft.</strong> Das echte Modell hat nur 53
          belastbare Wochen — Risk Off kommt darin zweimal vor, das reicht zum Hinschauen, nicht
          fuer eine Statistik. Das Vergleichsmodell 2018 rechnet stattdessen mit sechs statt neun
          Indikatoren und reicht rund 420 Wochen zurueck. Das ist eine ANDERE METHODIK, nicht die
          Verlaengerung des echten Modells: sein Sentiment-Faktor besteht allein aus dem VIX, sein
          Business-Cycle-Faktor nur aus NFCI und Zinskurve. Er wird nie gespeichert, sondern bei
          Bedarf aus den Rohdaten neu gerechnet.
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
            ISM und AAII sind oeffentlich nur fuer die juengste Zeit zu bekommen. Aeltere Wochen
            tragen zwar einen Gesamtscore, aber bei ihnen ist mindestens ein Faktor nicht
            bestimmbar. Die Verlaufsansicht setzt sie schraffiert ab. Fear &amp; Greed laesst sich
            per <code>npm run import:feargreed</code> optional bis 2011 zurueck nachladen (siehe
            dessen Karte im Abschnitt „Die neun Indikatoren") — das allein schliesst die Sentiment-
            Luecke fuer den ueberwiegenden Teil der Historie, ISM und AAII bleiben davon unberuehrt.
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

type Section = 'mechanik' | 'indikatoren' | 'szenarien' | 'anlageklassen' | 'handel' | 'grenzen';

const SECTIONS: { id: Section; label: string }[] = [
  { id: 'mechanik', label: 'Mechanik' },
  { id: 'indikatoren', label: 'Die neun Indikatoren' },
  { id: 'szenarien', label: 'Szenarien' },
  { id: 'anlageklassen', label: 'Anlageklassen im Regime' },
  { id: 'handel', label: 'Ableitung fuer den Handel' },
  { id: 'grenzen', label: 'Grenzen' },
];

export function Help({
  rules,
  snapshot,
  sensitivity,
  meaningfulFrom,
}: {
  rules: RulesResponse | null;
  snapshot: Snapshot;
  sensitivity: Sensitivity[];
  /** Fruehester belastbarer Wochenschluessel im Bestand, aus /api/history. */
  meaningfulFrom: string | null;
}) {
  const [section, setSection] = useState<Section>('mechanik');

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
            onClick={() => setSection(s.id)}
          >
            {s.label}
          </button>
        ))}
      </div>

      {section === 'mechanik' && <Mechanics rules={rules} />}
      {section === 'indikatoren' && (
        <Indicators rules={rules} snapshot={snapshot} sensitivity={sensitivity} />
      )}
      {section === 'szenarien' && <Scenarios snapshot={snapshot} rules={rules} />}
      {section === 'anlageklassen' && <AssetPerformanceHelp />}
      {section === 'handel' && <Trading rules={rules} snapshot={snapshot} />}
      {section === 'grenzen' && (
        <Limits rules={rules} snapshot={snapshot} meaningfulFrom={meaningfulFrom} />
      )}
    </>
  );
}
