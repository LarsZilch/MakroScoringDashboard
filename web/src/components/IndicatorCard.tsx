/**
 * Die Erklaerung eines Indikators — Bedeutung, Lesart, Bewertungsstufen,
 * aktueller Stand, Datenherkunft.
 *
 * Stand frueher in Help.tsx. Sie liegt jetzt fuer sich, weil das Dashboard
 * dieselbe Karte im Hilfe-Fenster hinter dem Fragezeichen zeigt. Wichtig ist
 * dabei, dass es EINE Karte bleibt: eine gekuerzte Zweitfassung fuer das
 * Dashboard waere genau die zweite Wahrheit, die der Hilfe-Tab vermeidet.
 *
 * Wie dort gilt auch hier: keine Schwellenwerte im Text. Die Stufen rendert
 * BandScale aus dem Regelwerk, der erzaehlende Teil kommt aus content/help.ts.
 */

import type { RulesResponse, ScoredIndicator, Sensitivity } from '../types';
import { num } from '../format';
import { BandScale } from './BandScale';
import { ScoreChip } from './ScoreChip';
import { INDICATOR_HELP } from '../content/help';

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

export function IndicatorCard({
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
