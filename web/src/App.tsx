import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchHistory, fetchRules, fetchScenarios, fetchWeek, refresh } from './api';
import type {
  HistoryResponse,
  RulesResponse,
  ScenarioBacktestReport,
  WeekResponse,
} from './types';
import { Dashboard } from './components/Dashboard';
import { Help, type HelpSection } from './components/Help';
import { History } from './components/History';
import { shortDate, weekLabel } from './format';
import { formatHash, parseHash, type Tab } from './route';

export function App() {
  const initial = parseHash(window.location.hash);
  const [tab, setTab] = useState<Tab>(initial.tab);
  const [week, setWeek] = useState<WeekResponse | null>(null);
  const [history, setHistory] = useState<HistoryResponse | null>(null);
  const [rules, setRules] = useState<RulesResponse | null>(null);
  const [scenarios, setScenarios] = useState<ScenarioBacktestReport | null>(null);
  const [helpSection, setHelpSection] = useState<HelpSection>(initial.section ?? 'mechanik');
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
   * Regelwerk und Szenario-Backtest aendern sich nicht mit der gewaehlten
   * Woche und werden deshalb nur einmal geladen — nicht in load(), sonst
   * holte jeder Wochenwechsel unveraenderte Daten neu. Ein Fehler hier darf
   * das Dashboard nicht blockieren: dann fehlen lediglich Hilfe und die
   * historische Einordnung der Szenarien.
   */
  useEffect(() => {
    void fetchRules()
      .then(setRules)
      .catch(() => setRules(null));
    void fetchScenarios()
      .then(setScenarios)
      .catch(() => setScenarios(null));
  }, []);

  /** Vom Dashboard in den Szenarien-Abschnitt der Hilfe springen. */
  const showScenarioHelp = () => {
    setTab('help');
    setHelpSection('szenarien');
  };

  /*
   * Zustand ins Fragment schreiben.
   *
   * Der Vergleich mit dem aktuellen Fragment ist nicht optional: ohne ihn
   * loesen Schreiben und hashchange-Listener einander im Kreis aus.
   *
   * Beim ersten Lauf wird ersetzt statt angehaengt. Sonst entstuende gleich
   * beim Laden ein zweiter Verlaufseintrag, und die Zurueck-Taste fuehrte
   * scheinbar nirgendwohin.
   */
  const synced = useRef(false);
  useEffect(() => {
    const next = formatHash(tab, helpSection);
    if (window.location.hash === next) {
      synced.current = true;
      return;
    }
    if (synced.current) {
      window.location.hash = next;
    } else {
      window.history.replaceState(null, '', next);
    }
    synced.current = true;
  }, [tab, helpSection]);

  /*
   * Vor und Zurueck im Browser — der einzige Weg, wie das Fragment von aussen
   * kommt. route.section ist null, wenn das Fragment keinen Abschnitt nennt
   * (z. B. "#/dashboard") — dann bleibt der zuletzt betrachtete Hilfe-
   * Abschnitt unangetastet, statt auf "mechanik" zurueckzuspringen.
   */
  useEffect(() => {
    const onHashChange = () => {
      const route = parseHash(window.location.hash);
      setTab(route.tab);
      if (route.section) setHelpSection(route.section);
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
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
          <button className="action" onClick={onRefresh} disabled={busy}>
            {busy ? 'Quellen werden abgerufen …' : 'Jetzt aktualisieren'}
          </button>
        </div>
      </div>

      {tab === 'dashboard' && (
        <Dashboard
          snapshot={week.snapshot}
          wow={week.wow}
          yoy={week.yoy}
          sensitivity={week.sensitivity}
          rules={rules}
          scenarios={scenarios}
          onShowScenarioHelp={showScenarioHelp}
          weekOptions={options}
          selectedWeek={selected}
          hiddenWeekCount={hiddenCount}
          onSelectWeek={setSelected}
        />
      )}
      {tab === 'history' && <History history={history} />}
      {tab === 'help' && (
        <Help
          rules={rules}
          snapshot={week.snapshot}
          sensitivity={week.sensitivity}
          meaningfulFrom={history.meaningfulFrom}
          historyPoints={history.points}
          scenarios={scenarios}
          section={helpSection}
          onSectionChange={setHelpSection}
        />
      )}

      <div className="footer">
        Regelwerk {week.snapshot.rulesVersion} · Snapshot gebaut{' '}
        {shortDate(week.snapshot.builtAt.slice(0, 10))} · {history.total} Wochen im Bestand, davon{' '}
        {history.points.filter((p) => p.completeness !== 'sparse').length} belastbar
        {history.meaningfulFrom && <> (ab {weekLabel(history.meaningfulFrom)})</>}. Die Wochenauswahl
        im Dashboard zeigt nur die belastbaren Wochen; die uebrigen {hiddenCount} stehen im Verlauf.
        <br />
        Der Liquiditaets-Indikator ist eine Ersatzreihe (Fed Net Liquidity statt Howell GLI). ISM,
        AAII und Fear &amp; Greed sind oeffentlich nur fuer die juengste Zeit verfuegbar — aeltere
        Wochen bleiben dort leer.
      </div>
    </div>
  );
}
