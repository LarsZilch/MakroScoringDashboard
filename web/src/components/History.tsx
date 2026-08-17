/**
 * Verlaufsansicht: Score-Zeitreihe, Faktoren, Regime-Raster, Anlageklassen.
 *
 * Bewusst vollstaendig wochenunabhaengig — anders als der Rest der App haengt
 * hier nichts an der im Dashboard gewaehlten Woche. Die "Veraenderung je
 * Indikator"-Tabelle stand hier frueher, ist aber eine Momentaufnahme der
 * gewaehlten Woche und gehoert deshalb ins Dashboard, wo diese Woche auch
 * umgestellt wird (siehe Dashboard.tsx).
 */

import { useMemo, useState } from 'react';
import type { HistoryResponse } from '../types';
import { AssetSection } from './AssetSection';
import { FactorCharts } from './FactorChart';
import { RegimeHeatmap } from './RegimeHeatmap';
import { ScoreChart } from './ScoreChart';
import { WeekBrush } from './WeekBrush';
import { useZoomPan } from './useZoomPan';
import { weekLabel } from '../format';

type Range = 'meaningful' | '1y' | '3y' | 'all';

const RANGE_LABEL: Record<Range, string> = {
  meaningful: 'nur belastbare Wochen',
  '1y': 'letzte 52 Wochen',
  '3y': 'letzte 3 Jahre',
  all: 'gesamter Bestand',
};

export function History({ history }: { history: HistoryResponse }) {
  const [range, setRange] = useState<Range>('meaningful');

  const points = useMemo(() => {
    const all = history.points;
    switch (range) {
      case 'meaningful':
        return all.filter((p) => p.completeness !== 'sparse');
      case '1y':
        return all.slice(-52);
      case '3y':
        return all.slice(-157);
      default:
        return all;
    }
  }, [history.points, range]);

  /*
   * Gezaehlt wird in der AUSWAHL, nicht im Gesamtbestand. Der Kasten spricht
   * von "den angezeigten Wochen" und darf deshalb nur erscheinen, wenn auch
   * wirklich lueckenhafte Wochen im gewaehlten Zeitraum liegen. Bei "letzte
   * 52 Wochen" ist das der Normalfall nicht: die Luecken sitzen am Anfang des
   * Bestands, weit ausserhalb des Ausschnitts.
   */
  const sparseCount = points.filter((p) => p.completeness === 'sparse').length;

  /*
   * Ein Fenster fuer Score-Verlauf und Faktor-Diagramme gemeinsam: sie zeigen
   * dieselben Wochen und sollen auch nach dem Zoomen dieselben zeigen. Die
   * Heatmap bleibt bewusst aussen vor — sie IST die Gesamtsicht und wuerde
   * ihren Zweck verlieren, wenn man sie beschneidet.
   */
  const zoom = useZoomPan(points.length);
  const visible = useMemo(
    () => points.slice(zoom.window.start, zoom.window.end),
    [points, zoom.window.start, zoom.window.end],
  );

  return (
    <>
      {/*
        Steht bewusst ganz oben: das Raster ist die Uebersicht, aus der sich
        alles Weitere erschliesst. Wer den Verlauf oeffnet, will zuerst sehen,
        wann welches Regime galt — die Kurven darunter erklaeren dann, wie es
        dazu kam.
      */}
      <div className="panel">
        <div className="panel-head">
          <div>
            <div className="panel-title">Regime je Kalenderwoche</div>
            <div className="panel-sub">
              Zeile = Jahr, Spalte = Kalenderwoche
              {!zoom.isFull && ' · zeigt weiterhin den gesamten Zeitraum'}
            </div>
          </div>
        </div>
        <div className="panel-body">
          {/* Bewusst ungezoomt: dieses Raster IST die Gesamtsicht. */}
          <RegimeHeatmap points={points} />
          {history.regimeChanges.length > 0 && (
            <div style={{ marginTop: 18, fontSize: 13.5 }}>
              <strong>Regimewechsel:</strong>{' '}
              {history.regimeChanges
                .slice(-6)
                .map((c) => `${weekLabel(c.weekKey)} ${c.from} → ${c.to}`)
                .join(' · ')}
            </div>
          )}
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <div>
            <div className="panel-title">Gesamtscore im Verlauf</div>
            <div className="panel-sub">
              {zoom.isFull ? (
                <>
                  {points.length} Wochen · {RANGE_LABEL[range]}
                </>
              ) : (
                <>
                  {visible.length} von {points.length} Wochen sichtbar · {RANGE_LABEL[range]}
                </>
              )}
            </div>
          </div>
          <div className="controls">
            <select value={range} onChange={(e) => setRange(e.target.value as Range)}>
              {(Object.keys(RANGE_LABEL) as Range[]).map((r) => (
                <option key={r} value={r}>
                  {RANGE_LABEL[r]}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="panel-body">
          {sparseCount > 0 && (
            <div className="callout warn" style={{ marginBottom: 16 }}>
              <strong>{sparseCount} der angezeigten Wochen sind unvollstaendig.</strong> Bei ihnen
              ist mindestens ein Faktor mangels Daten nicht bestimmbar; der Score ergibt sich dann
              aus der Luecke, nicht aus dem Markt. Sie sind schraffiert unterlegt.
              {history.meaningfulFrom && (
                <> Belastbar wird der Bestand ab {weekLabel(history.meaningfulFrom)}.</>
              )}
            </div>
          )}
          <div className={`zoomable${zoom.dragging ? ' is-dragging' : ''}`} ref={zoom.ref}>
            <ScoreChart points={visible} />
          </div>
          <WeekBrush
            points={points}
            window={zoom.window}
            onChange={zoom.setWindow}
            onReset={zoom.reset}
          />
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <div>
            <div className="panel-title">Die drei Faktoren einzeln</div>
            {!zoom.isFull && (
              <div className="panel-sub">folgt dem Ausschnitt des Gesamtscores</div>
            )}
          </div>
        </div>
        <div className="panel-body">
          <FactorCharts points={visible} />
        </div>
      </div>

      <AssetSection />
    </>
  );
}
