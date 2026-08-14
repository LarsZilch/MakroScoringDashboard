/**
 * Der Abschnitt "Anlageklassen im Regime": Modus-Wahl, Umschalter, Overlay
 * und Kennzahlen-Tabelle.
 *
 * Die Modus-Wahl ist der heikelste Teil der Oberflaeche. Das Vergleichsmodell
 * 2018 rechnet mit einer ANDEREN Methodik als das veroeffentlichte Modell —
 * es darf deshalb nie so aussehen, als sei es dessen Verlaengerung. Der
 * Vorbehalt steht darum nicht in einer Fussnote, sondern direkt unter der
 * Auswahl, sobald das Vergleichsmodell aktiv ist.
 */

import { useEffect, useMemo, useState } from 'react';
import { fetchAssets, fetchPerformance } from '../api';
import type { AssetsResponse, PerformanceResponse, RegimeMode } from '../types';
import { AssetOverlay, LINE_COLORS, MAX_LINES } from './AssetOverlay';
import { RegimePerformance } from './RegimePerformance';
import { ScoreChart } from './ScoreChart';
import { weekLabel } from '../format';

/** Voreinstellung: die vier klassischen Makro-Bausteine. */
const DEFAULT_SELECTION = ['SPX', 'GLD', 'TLT', 'UUP'];

export function AssetSection() {
  const [mode, setMode] = useState<RegimeMode>('live');
  const [selected, setSelected] = useState<string[]>(DEFAULT_SELECTION);
  const [assets, setAssets] = useState<AssetsResponse | null>(null);
  const [perf, setPerf] = useState<PerformanceResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    let stale = false;
    setBusy(true);
    setError(null);
    Promise.all([fetchAssets(mode), fetchPerformance(mode)])
      .then(([a, p]) => {
        if (stale) return;
        setAssets(a);
        setPerf(p);
      })
      .catch((e: unknown) => {
        if (!stale) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!stale) setBusy(false);
      });
    return () => {
      stale = true;
    };
  }, [mode]);

  const toggle = (id: string) => {
    setSelected((cur) =>
      cur.includes(id) ? cur.filter((x) => x !== id) : cur.length >= MAX_LINES ? cur : [...cur, id],
    );
  };

  const grouped = useMemo(() => {
    const groups = new Map<string, { id: string; short: string; label: string }[]>();
    for (const a of assets?.catalogue ?? []) {
      const list = groups.get(a.group) ?? [];
      list.push({ id: a.id, short: a.short, label: a.label });
      groups.set(a.group, list);
    }
    return [...groups];
  }, [assets]);

  const full = selected.length >= MAX_LINES;

  return (
    <div className="panel">
      <div className="panel-head">
        <div>
          <div className="panel-title">Anlageklassen im Regime</div>
          <div className="panel-sub">
            {assets
              ? `${assets.regimes.label} · ${assets.regimes.weeks.length} Wochen${
                  assets.regimes.from && assets.regimes.to
                    ? ` (${weekLabel(assets.regimes.from)} bis ${weekLabel(assets.regimes.to)})`
                    : ''
                }`
              : 'wird geladen …'}
          </div>
        </div>
        <div className="controls">
          <select value={mode} onChange={(e) => setMode(e.target.value as RegimeMode)}>
            <option value="live">Echtes Modell (alle neun Indikatoren)</option>
            <option value="reduced">Vergleichsmodell 2018 (sechs Indikatoren)</option>
          </select>
        </div>
      </div>

      <div className="panel-body">
        {error && <div className="error">{error}</div>}

        {mode === 'reduced' && assets && (
          <div className="callout warn" style={{ marginBottom: 18 }}>
            <strong>Andere Methodik, nicht die Verlaengerung des echten Modells.</strong>{' '}
            {assets.regimes.caveat.replace(
              'ANDERE METHODIK, nicht die Verlaengerung des echten Modells: ',
              '',
            )}
          </div>
        )}

        {mode === 'live' && assets && assets.regimes.weeks.length < 60 && (
          <div className="callout" style={{ marginBottom: 18 }}>
            <strong>Nur {assets.regimes.weeks.length} belastbare Wochen.</strong> Das reicht zum
            Hinschauen, nicht fuer eine Statistik — einzelne Regime kommen nur ein- oder zweimal vor.
            Fuer eine groessere Stichprobe oben auf das Vergleichsmodell umschalten; es rechnet mit
            weniger Indikatoren, dafuer ueber rund 420 Wochen.
          </div>
        )}

        {/* Umschalter, nach Gruppen geordnet */}
        <div className="asset-picker">
          {grouped.map(([group, items]) => (
            <div className="asset-group" key={group}>
              <div className="asset-group-title">{group}</div>
              <div className="asset-chips">
                {items.map((a) => {
                  const idx = selected.indexOf(a.id);
                  const on = idx >= 0;
                  const blocked = !on && full;
                  return (
                    <button
                      key={a.id}
                      className={`asset-chip${on ? ' on' : ''}${blocked ? ' blocked' : ''}`}
                      onClick={() => toggle(a.id)}
                      disabled={blocked}
                      title={
                        blocked
                          ? `Hoechstens ${MAX_LINES} Linien gleichzeitig — die Farben bleiben sonst nicht unterscheidbar`
                          : a.label
                      }
                      style={on ? { borderColor: LINE_COLORS[idx], background: LINE_COLORS[idx] } : undefined}
                    >
                      {a.short}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        <div className="asset-picker-note">
          {full ? (
            <>
              Vier Linien sind das Maximum — mehr Farben lassen sich nicht mehr zuverlaessig
              unterscheiden, auch nicht bei normalem Farbsehen. Zum Wechseln eine abwaehlen.
            </>
          ) : (
            <>Bis zu {MAX_LINES} Anlageklassen gleichzeitig.</>
          )}
        </div>

        {busy && <div className="center-note">Kurse und Regime werden gerechnet …</div>}

        {assets && !busy && (
          <>
            {/*
              Beide Diagramme teilen sich Breite, Raender und Zeitachse aus
              chartGeometry — nur so liegen die Regime-Baender senkrecht
              uebereinander und der Vergleich ist ablesbar.
            */}
            <div className="stacked-charts">
              <div className="stacked-label">Gesamtscore</div>
              <ScoreChart points={assets.regimes.weeks} showRegimeBands />

              <div className="stacked-label">
                Kursverlauf, indexiert auf 100 zu Beginn des Zeitraums
              </div>
              <AssetOverlay
                curves={assets.curves}
                weeks={assets.regimes.weeks}
                selected={selected}
              />
            </div>
          </>
        )}

        {perf && !busy && (
          <div style={{ marginTop: 30 }}>
            <RegimePerformance
              assets={perf.assets}
              regimeOrder={perf.regimeOrder}
              sample={perf.sample}
              label={perf.label}
              caveat={perf.caveat}
              from={perf.from}
              to={perf.to}
              totalWeeks={perf.totalWeeks}
            />
          </div>
        )}
      </div>
    </div>
  );
}
