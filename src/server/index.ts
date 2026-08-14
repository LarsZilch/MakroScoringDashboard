/**
 * Lokaler Server: liefert Snapshots und Regelwerk an das Dashboard und
 * kapselt die Quellen-Abrufe.
 *
 * Warum ueberhaupt ein Server statt einer rein statischen Seite: FRED,
 * Yahoo, CNN und AAII senden keine CORS-Header. Eine reine Browser-App kann
 * sie schlicht nicht abrufen. Der Server ist der Umweg darum herum — und
 * zugleich der einzige Prozess mit Schreibrecht auf die Snapshots.
 */

import express from 'express';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { analyzeSensitivity } from '../core/scoring.js';
import { isoWeekOf, parseIsoWeekKey } from '../core/isoweek.js';
import { listAssumptions } from '../core/rulebook.js';
import { fetchAll } from '../pipeline/fetch-all.js';
import { requiredSeriesIds } from '../pipeline/indicators.js';
import { latestRuleVersion, listRuleVersions, loadRules } from '../pipeline/load-rules.js';
import { ROOT } from '../pipeline/paths.js';
import { loadBundle } from '../pipeline/series-cache.js';
import { buildSnapshot, volatilityFromHistory } from '../pipeline/snapshot.js';
import { ASSETS } from '../sources/assets.js';
import {
  liveRegimeSeries,
  reducedRegimeSeries,
  type RegimeMode,
} from '../pipeline/regime-history.js';
import {
  REGIME_ORDER,
  buildCurves,
  buildPerformance,
  loadAssetBundle,
  sampleInfo,
} from '../pipeline/regime-assets.js';
import {
  buildHistory,
  compareWeekOverWeek,
  compareYearOverYear,
  findRegimeChanges,
  loadAllSnapshots,
  writeSnapshot,
} from '../pipeline/store.js';

const app = express();
// Bewusst eine eigene Variable: PORT wird von Startskripten haeufig auf den
// Port des Frontends gesetzt -- dann kollidierten Vite und API-Server.
const PORT = Number(process.env.API_PORT ?? 5178);

app.use(express.json());

/** Fehler als JSON statt als HTML-Stacktrace. */
function wrap(handler: (req: express.Request, res: express.Response) => unknown) {
  return async (req: express.Request, res: express.Response) => {
    try {
      await handler(req, res);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  };
}

app.get('/api/health', (_req, res) => {
  const snapshots = loadAllSnapshots();
  res.json({
    ok: true,
    snapshots: snapshots.length,
    meaningful: snapshots.filter((s) => s.meaningful).length,
    latest: snapshots[snapshots.length - 1]?.weekKey ?? null,
    rules: listRuleVersions(),
  });
});

/** Regelwerk samt Liste aller gesetzten Annahmen. */
app.get('/api/rules', wrap((req, res) => {
  const version = typeof req.query.version === 'string' ? req.query.version : latestRuleVersion();
  const rules = loadRules(version);
  res.json({ rules, assumptions: listAssumptions(rules) });
}));

/** Alle Wochen als kompakter Verlauf. */
app.get('/api/history', wrap((_req, res) => {
  const snapshots = loadAllSnapshots();
  res.json({
    points: buildHistory(snapshots),
    regimeChanges: findRegimeChanges(snapshots.filter((s) => s.meaningful)),
    meaningfulFrom: snapshots.find((s) => s.meaningful)?.weekKey ?? null,
    total: snapshots.length,
  });
}));

/**
 * Eine Woche mit allem Drum und Dran: Snapshot, Vergleiche, Grenzfaelle.
 * "latest" liefert die juengste vorhandene Woche.
 */
app.get('/api/week/:weekKey', wrap((req, res) => {
  const snapshots = loadAllSnapshots();
  const key = req.params.weekKey;

  const snapshot =
    key === 'latest'
      ? snapshots[snapshots.length - 1]
      : snapshots.find((s) => s.weekKey === key);

  if (!snapshot) {
    res.status(404).json({ error: `Keine Daten fuer ${key}` });
    return;
  }

  const rules = loadRules(snapshot.rulesVersion);
  res.json({
    snapshot,
    wow: compareWeekOverWeek(snapshot, snapshots),
    yoy: compareYearOverYear(snapshot, snapshots),
    sensitivity: analyzeSensitivity(rules, {
      rulesVersion: snapshot.rulesVersion,
      indicators: snapshot.indicators,
      factors: snapshot.factors as never,
      total: snapshot.total,
      regime: snapshot.regime,
      degraded: snapshot.completeness !== 'full',
      missing: snapshot.missing,
      undeterminableFactors: snapshot.undeterminableFactors as never,
      meaningful: snapshot.meaningful,
    }),
    available: snapshots.map((s) => ({
      weekKey: s.weekKey,
      total: s.total,
      regime: s.regime.label,
      meaningful: s.meaningful,
    })),
  });
}));

/** Quellen neu abrufen und die angegebene Woche neu bauen. */
app.post('/api/refresh', wrap(async (req, res) => {
  const weekKey = typeof req.body?.weekKey === 'string' ? req.body.weekKey : null;
  const week = weekKey ? parseIsoWeekKey(weekKey) : isoWeekOf(new Date());

  const { reports } = await fetchAll({ from: '2015-01-01', yahooRange: '5y' });
  const bundle = loadBundle(requiredSeriesIds());
  const existing = loadAllSnapshots();

  const rules = loadRules(latestRuleVersion());
  const snapshot = buildSnapshot(rules, bundle, week, {
    volatility: volatilityFromHistory(existing),
  });
  writeSnapshot(snapshot);

  res.json({ snapshot, reports });
}));

/**
 * Regime-Reihe, Kurskurven und Kennzahlen fuer die Auswertung gegen
 * Anlageklassen.
 *
 * `mode=reduced` liefert das Vergleichsmodell 2018. Es wird hier gerechnet und
 * NICHT gespeichert — der Snapshot-Bestand bleibt dem echten Modell
 * vorbehalten.
 */
app.get('/api/assets', wrap((req, res) => {
  const mode: RegimeMode = req.query.mode === 'reduced' ? 'reduced' : 'live';
  const from = typeof req.query.from === 'string' ? req.query.from : undefined;

  const assetBundle = loadAssetBundle();
  const regimes =
    mode === 'reduced'
      ? reducedRegimeSeries(loadRules(latestRuleVersion()), loadBundle(requiredSeriesIds()))
      : liveRegimeSeries();

  res.json({
    mode,
    regimes: {
      label: regimes.label,
      caveat: regimes.caveat,
      omitted: regimes.omitted,
      from: regimes.from,
      to: regimes.to,
      weeks: from ? regimes.weeks.filter((w) => w.weekKey >= from) : regimes.weeks,
    },
    curves: buildCurves(regimes, assetBundle, from),
    catalogue: ASSETS,
  });
}));

app.get('/api/regime-performance', wrap((req, res) => {
  const mode: RegimeMode = req.query.mode === 'reduced' ? 'reduced' : 'live';
  const regimes =
    mode === 'reduced'
      ? reducedRegimeSeries(loadRules(latestRuleVersion()), loadBundle(requiredSeriesIds()))
      : liveRegimeSeries();

  res.json({
    mode,
    label: regimes.label,
    caveat: regimes.caveat,
    from: regimes.from,
    to: regimes.to,
    totalWeeks: regimes.weeks.length,
    regimeOrder: REGIME_ORDER,
    sample: sampleInfo(regimes),
    assets: buildPerformance(regimes, loadAssetBundle()),
  });
}));

/** Rohreihe einer Kennung, fuer die Einzelcharts. */
app.get('/api/series/:id', wrap((req, res) => {
  const id = String(req.params.id ?? '');
  // Nur bekannte Kennungen zulassen — der Parameter landet sonst in einem Dateinamen.
  if (!requiredSeriesIds().includes(id)) {
    res.status(404).json({ error: `Unbekannte Reihe "${id}"` });
    return;
  }
  const series = loadBundle([id])[id];
  if (!series) {
    res.status(404).json({ error: `Reihe ${id} nicht im Cache` });
    return;
  }
  res.json({ seriesId: id, observations: series });
}));

// Gebautes Frontend ausliefern, sofern vorhanden.
const dist = join(ROOT, 'dist');
if (existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/.*/, (_req, res) => res.sendFile(join(dist, 'index.html')));
}

app.listen(PORT, () => {
  const snapshots = loadAllSnapshots();
  console.log(`Server auf http://localhost:${PORT}`);
  console.log(
    `${snapshots.length} Snapshots im Bestand, davon ${snapshots.filter((s) => s.meaningful).length} aussagekraeftig`,
  );
  if (!existsSync(dist)) console.log('Frontend im Dev-Modus: npm run web (Vite proxied /api hierher)');
});
