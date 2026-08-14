/**
 * Wie sich die Anlageklassen in den jeweiligen Regimen geschlagen haben.
 *
 * Drei Vorkehrungen gegen die naheliegende Fehllesung, hier stuende eine
 * belastbare Statistik:
 *
 * 1. GEMESSEN WIRD DIE FOLGEWOCHE. Das Regime der Woche W steht erst an deren
 *    Ende fest; die Rendite derselben Woche zuzuordnen waere ein Blick in die
 *    Zukunft und liesse jede Zahl besser aussehen, als sie ist.
 *
 * 2. DIE WOCHENZAHL STEHT IMMER DABEI, und unter acht Wochen erscheint gar
 *    keine Zahl.
 *
 * 3. DIE ZAHL DER EPISODEN steht daneben. Sie ist das ehrlichere Mass: im
 *    Vergleichsmodell stammen ueber die Haelfte der Risk-On-Wochen aus einer
 *    einzigen Phase 2020/21. "n = 73" sieht robust aus, ist aber im Kern eine
 *    Beobachtung.
 */

import type { AssetPerformanceView, RegimeSampleView } from '../types';
import { num, signed } from '../format';
import { REGIME_COLOR } from './viz';

function Cell({ stats }: { stats: AssetPerformanceView['byRegime'][number] }) {
  if (stats.weeks === 0) {
    return <td className="num perf-empty">—</td>;
  }
  if (stats.annualized === null) {
    return (
      <td className="num perf-empty">
        <span className="perf-nodata">zu wenige Daten</span>
        <span className="perf-n">n = {stats.weeks}</span>
      </td>
    );
  }

  const positive = stats.annualized > 0;
  return (
    <td className={`num perf-cell${stats.confidence === 'weak' ? ' is-weak' : ''}`}>
      <span className={`perf-value ${positive ? 'up' : 'down'}`}>
        {signed(stats.annualized * 100, 1)} %
      </span>
      <span className="perf-meta">
        {stats.hitRate !== null && <>{num(stats.hitRate * 100, 0)} % Treffer · </>}
        n = {stats.weeks}
        {stats.concentrated && <span className="perf-flag" title="Ueber die Haelfte der Wochen stammt aus einer einzigen zusammenhaengenden Phase">*</span>}
      </span>
    </td>
  );
}

export function RegimePerformance({
  assets,
  regimeOrder,
  sample,
  label,
  caveat,
  from,
  to,
  totalWeeks,
}: {
  assets: AssetPerformanceView[];
  regimeOrder: string[];
  sample: RegimeSampleView[];
  label: string;
  caveat: string;
  from: string | null;
  to: string | null;
  totalWeeks: number;
}) {
  const sampleByRegime = new Map(sample.map((s) => [s.regime, s]));
  const anyConcentrated = sample.some((s) => s.concentrated && s.weeks >= 8);

  return (
    <>
      <div className="callout" style={{ marginBottom: 18 }}>
        <strong>Gemessen wird die Rendite der Folgewoche.</strong> Das Regime einer Woche steht erst
        an deren Ende fest. Wer danach handelt, ist in der Woche darauf investiert — deshalb wird
        diese gemessen und nicht dieselbe. Die naive Zuordnung derselben Woche wuerde Wissen aus der
        Zukunft benutzen und jede Zahl schoenrechnen.
      </div>

      {anyConcentrated && (
        <div className="callout warn" style={{ marginBottom: 18 }}>
          <strong>Eine Zahl mit Stern haengt an einer einzigen Phase.</strong> Bei diesen Regimen
          stammt mehr als die Haelfte aller Wochen aus einer zusammenhaengenden Episode. Die
          Wochenzahl sieht dann nach einer breiten Stichprobe aus, tatsaechlich handelt es sich um
          wenige unabhaengige Beobachtungen desselben Marktereignisses.
        </div>
      )}

      <table className="perf-table">
        <thead>
          <tr>
            <th rowSpan={2} style={{ verticalAlign: 'bottom' }}>
              Anlageklasse
            </th>
            {regimeOrder.map((r) => (
              <th key={r} className="num">
                <span className="regime-dot" style={{ background: REGIME_COLOR[r] ?? '#ccc' }} />
                {r}
              </th>
            ))}
            <th className="num">Alle Wochen</th>
          </tr>
          <tr>
            {regimeOrder.map((r) => {
              const s = sampleByRegime.get(r);
              return (
                <th key={r} className="num perf-sample">
                  {s ? (
                    <>
                      {s.weeks} {s.weeks === 1 ? 'Woche' : 'Wochen'}
                      <br />
                      {s.episodes} {s.episodes === 1 ? 'Episode' : 'Episoden'}
                    </>
                  ) : (
                    '—'
                  )}
                </th>
              );
            })}
            <th className="num perf-sample">
              {totalWeeks} Wochen
              <br />
              durchgehend
            </th>
          </tr>
        </thead>
        <tbody>
          {assets.map((a) => (
            <tr key={a.assetId}>
              <td>{a.label}</td>
              {a.byRegime.map((s) => (
                <Cell key={s.regime} stats={s} />
              ))}
              <Cell stats={a.overall} />
            </tr>
          ))}
        </tbody>
      </table>

      <div className="perf-footnote">
        <div>
          <strong>Grundlage:</strong> {label}
          {from && to && (
            <>
              , {from.replace('-W', '/')} bis {to.replace('-W', '/')}
            </>
          )}
          . Renditen annualisiert und geometrisch gerechnet, so als waere man ausschliesslich in den
          Wochen des jeweiligen Regimes investiert gewesen. Ertraege sind
          ausschuettungsbereinigt — ohne das waeren die Anleihe-Klassen systematisch
          schlechtgerechnet.
        </div>
        <div style={{ marginTop: 8 }}>{caveat}</div>
        <div style={{ marginTop: 8 }}>
          Blass dargestellte Zahlen beruhen auf weniger als 26 Wochen. Unter acht Wochen wird gar
          keine Zahl gezeigt. Ein Stern kennzeichnet Ergebnisse, die von einer einzelnen Phase
          getragen werden.
        </div>
      </div>
    </>
  );
}
