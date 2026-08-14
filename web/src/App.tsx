import { useCallback, useEffect, useState } from 'react';
import { fetchHistory, fetchRules, fetchWeek, refresh } from './api';
import type { HistoryResponse, RulesResponse, WeekResponse } from './types';
import { Dashboard } from './components/Dashboard';
import { Help } from './components/Help';
import { History } from './components/History';
import { scoreText, shortDate, weekLabel } from './format';

type Tab = 'dashboard' | 'history' | 'help';

export function App() {
  const [tab, setTab] = useState<Tab>('dashboard');
  const [week, setWeek] = useState<WeekResponse | null>(null);
  const [history, setHistory] = useState<HistoryResponse | null>(null);
  const [rules, setRules] = useState<RulesResponse | null>(null);
  const [selected, setSelected] = useState<string>('latest');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (weekKey: string) => {
    setError(null);
    try {
      const [w, h] = await Promise.all([fetchWeek(weekKey), fetchHistory()]);
      setWeek(w);
      setHistory(h);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  /*
   * Das Regelwerk aendert sich nicht mit der gewaehlten Woche und wird
   * deshalb nur einmal geladen. Ein Fehler hier darf das Dashboard nicht
   * blockieren — dann fehlt lediglich die Hilfe.
   */
  useEffect(() => {
    void fetchRules()
      .then(setRules)
      .catch(() => setRules(null));
  }, []);

  useEffect(() => {
    void load(selected);
  }, [load, selected]);

  const onRefresh = async () => {
    setBusy(true);
    setError(null);
    try {
      await refresh();
      await load('latest');
      setSelected('latest');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  if (error && !week) {
    return (
      <div className="app">
        <div className="error">
          <strong>Keine Daten:</strong> {error}
          <br />
          Laeuft der Server? <code>npm run server</code> — und wurde schon einmal{' '}
          <code>npm run update</code> ausgefuehrt?
        </div>
      </div>
    );
  }

  if (!week || !history) {
    return (
      <div className="app">
        <div className="center-note">Lade …</div>
      </div>
    );
  }

  /*
   * Nur belastbare Wochen zur Auswahl anbieten.
   *
   * Der Bestand enthaelt ueber 800 Backfill-Wochen, bei denen mindestens ein
   * Faktor nicht bestimmbar ist. Sie alle aufzulisten macht die Auswahl
   * unbenutzbar und laedt dazu ein, einen Stand zu oeffnen, der gar keiner
   * ist. Ihr Platz ist die Verlaufsansicht, wo sie als Luecke erkennbar sind.
   */
  const options = week.available.filter((o) => o.meaningful).reverse();
  const hiddenCount = week.available.length - options.length;

  return (
    <div className="app">
      {error && <div className="error">{error}</div>}

      <div className="tabs">
        <button
          className="tab"
          role="tab"
          aria-selected={tab === 'dashboard'}
          onClick={() => setTab('dashboard')}
        >
          Dashboard
        </button>
        <button
          className="tab"
          role="tab"
          aria-selected={tab === 'history'}
          onClick={() => setTab('history')}
        >
          Verlauf
        </button>
        <button
          className="tab"
          role="tab"
          aria-selected={tab === 'help'}
          onClick={() => setTab('help')}
        >
          Hilfe
        </button>
        <div style={{ flex: 1 }} />
        <div className="controls" style={{ paddingBottom: 8 }}>
          <select
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            title={
              hiddenCount > 0
                ? `${hiddenCount} unvollstaendige Backfill-Wochen sind hier ausgeblendet — sie stehen in der Verlaufsansicht`
                : undefined
            }
          >
            <option value="latest">juengste Woche</option>
            {options.map((o) => (
              <option key={o.weekKey} value={o.weekKey}>
                {weekLabel(o.weekKey)} · {scoreText(o.total)} {o.regime}
              </option>
            ))}
          </select>
          <button className="action" onClick={onRefresh} disabled={busy}>
            {busy ? 'Quellen werden abgerufen …' : 'Jetzt aktualisieren'}
          </button>
        </div>
      </div>

      {tab === 'dashboard' && (
        <Dashboard snapshot={week.snapshot} wow={week.wow} sensitivity={week.sensitivity} />
      )}
      {tab === 'history' && <History history={history} wow={week.wow} yoy={week.yoy} />}
      {tab === 'help' && (
        <Help
          rules={rules}
          snapshot={week.snapshot}
          sensitivity={week.sensitivity}
          meaningfulFrom={history.meaningfulFrom}
        />
      )}

      <div className="footer">
        Regelwerk {week.snapshot.rulesVersion} · Snapshot gebaut{' '}
        {shortDate(week.snapshot.builtAt.slice(0, 10))} · {history.total} Wochen im Bestand, davon{' '}
        {history.points.filter((p) => p.completeness !== 'sparse').length} belastbar
        {history.meaningfulFrom && <> (ab {weekLabel(history.meaningfulFrom)})</>}. Die Auswahl oben
        zeigt nur die belastbaren Wochen; die uebrigen {hiddenCount} stehen im Verlauf.
        <br />
        Der Liquiditaets-Indikator ist eine Ersatzreihe (Fed Net Liquidity statt Howell GLI). ISM,
        AAII und Fear &amp; Greed sind oeffentlich nur fuer die juengste Zeit verfuegbar — aeltere
        Wochen bleiben dort leer.
      </div>
    </div>
  );
}
