/**
 * Wochenlauf: Quellen abrufen, Snapshot der aktuellen KW bauen, ablegen.
 *
 *   npm run update              — aktuelle Kalenderwoche
 *   npm run update -- 2026-W31  — eine bestimmte Woche
 *   npm run update -- --no-fetch — nur neu rechnen, ohne Quellen zu befragen
 */

import { isoWeekKey, isoWeekOf, parseIsoWeekKey } from '../core/isoweek.js';
import { signed } from '../pipeline/format.js';
import { fetchAll } from '../pipeline/fetch-all.js';
import { requiredSeriesIds } from '../pipeline/indicators.js';
import { loadRules } from '../pipeline/load-rules.js';
import { loadBundle } from '../pipeline/series-cache.js';
import { buildSnapshot, volatilityFromHistory } from '../pipeline/snapshot.js';
import {
  compareWeekOverWeek,
  compareYearOverYear,
  loadAllSnapshots,
  writeSnapshot,
} from '../pipeline/store.js';

const args = process.argv.slice(2);
const noFetch = args.includes('--no-fetch');
const weekArg = args.find((a) => /^\d{4}-W\d{1,2}$/.test(a));

const week = weekArg ? parseIsoWeekKey(weekArg) : isoWeekOf(new Date());
const rules = loadRules('v1');

console.log(`Wochenlauf ${isoWeekKey(week)} · Regelwerk ${rules.version}\n`);

if (!noFetch) {
  const { reports } = await fetchAll({ from: '2015-01-01', yahooRange: '5y' });
  const failed = reports.filter((r) => !r.ok);
  const updated = reports.filter((r) => r.ok && ((r.added ?? 0) > 0 || (r.changed ?? 0) > 0));

  console.log(`Quellen: ${reports.length - failed.length}/${reports.length} abgerufen`);
  for (const r of updated) {
    console.log(`  ${r.seriesId}: +${r.added} neu, ${r.changed} revidiert (Stand ${r.latest})`);
  }
  for (const r of failed) {
    console.log(`  ${r.seriesId}: FEHLER — ${r.error}`);
  }
  if (failed.length > 0) {
    console.log('  → zwischengespeicherte Staende dieser Reihen werden weiterverwendet');
  }
  console.log();
} else {
  console.log('Kein Abruf (--no-fetch), es wird auf dem Reihen-Cache gerechnet\n');
}

const bundle = loadBundle(requiredSeriesIds());
const existing = loadAllSnapshots();
const volatility = volatilityFromHistory(existing);

const snapshot = buildSnapshot(rules, bundle, week, { volatility });
const file = writeSnapshot(snapshot);

console.log(`Gesamtscore ${snapshot.total >= 0 ? '+' : ''}${snapshot.total} · ${snapshot.regime.label} · Cash ${snapshot.regime.cashBand[0]}–${snapshot.regime.cashBand[1]} %`);
console.log(
  `Faktoren: ${Object.values(snapshot.factors).map((f) => `${f.label} ${f.score >= 0 ? '+' : ''}${f.score}`).join(' · ')}`,
);
console.log(`Vollstaendigkeit: ${snapshot.completeness}`);
for (const note of snapshot.notes) console.log(`  ! ${note}`);

// Vergleiche gegen den bestehenden Bestand.
const all = [...existing.filter((s) => s.weekKey !== snapshot.weekKey), snapshot].sort((a, b) =>
  a.weekKey.localeCompare(b.weekKey),
);

const wow = compareWeekOverWeek(snapshot, all);
if (wow.resolved) {
  const delta = wow.totalDelta ?? 0;
  const dir = delta > 0 ? '↑' : delta < 0 ? '↓' : '→';
  console.log(
    `\nVorwoche (${isoWeekKey(wow.resolved)}${wow.substituted ? ', ersatzweise' : ''}): ` +
      `Score ${dir} ${signed(delta, 0)}` +
      (wow.regimeChanged ? ` · Regimewechsel von ${wow.previousRegime}` : ''),
  );
  const changed = wow.indicators.filter((i) => i.scoreChanged);
  for (const c of changed) {
    console.log(`  ${c.label}: ${c.previousScore} → ${c.currentScore}`);
  }
}

const yoy = compareYearOverYear(snapshot, all);
if (yoy.resolved) {
  console.log(
    `Vorjahr (${isoWeekKey(yoy.resolved)}${yoy.substituted ? ', ersatzweise' : ''}): ` +
      `Score ${signed(yoy.totalDelta ?? 0, 0)}` +
      (yoy.regimeChanged ? ` · damals ${yoy.previousRegime}` : ' · gleiches Regime'),
  );
} else {
  console.log('Vorjahr: kein Vergleichswert im Bestand');
}

console.log(`\nGeschrieben: ${file}`);
