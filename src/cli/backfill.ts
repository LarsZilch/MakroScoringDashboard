/**
 * Historie nachtraeglich fuellen.
 *
 *   npm run backfill                          — so weit die Daten reichen
 *   npm run backfill -- --from 2021-W01
 *   npm run backfill -- --from 2024-W01 --to 2026-W30
 *   npm run backfill -- --no-fetch            — auf dem Reihen-Cache rechnen
 *
 * Wichtig zur Einordnung: Backfill-Snapshots sind KEINE veroeffentlichten
 * Staende. Sie beruhen auf heutigen, teils revidierten Daten und haben bei
 * ISM, AAII und Fear & Greed systematische Luecken. Sie tragen deshalb
 * completeness "partial" und einen entsprechenden Hinweis.
 */

import { isoWeekKey, isoWeekOf, isoWeekRange, parseIsoWeekKey, type IsoWeek } from '../core/isoweek.js';
import { fetchAll } from '../pipeline/fetch-all.js';
import { requiredSeriesIds } from '../pipeline/indicators.js';
import { loadRules } from '../pipeline/load-rules.js';
import { loadBundle } from '../pipeline/series-cache.js';
import { buildSnapshot, volatilityFromHistory, type Snapshot } from '../pipeline/snapshot.js';
import { writeSnapshot } from '../pipeline/store.js';

function argValue(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const noFetch = process.argv.includes('--no-fetch');
const rules = loadRules('v1');

if (!noFetch) {
  console.log('Rohdaten holen …');
  const { reports } = await fetchAll({ from: '2010-01-01', yahooRange: 'max' });
  for (const r of reports.filter((x) => !x.ok)) console.log(`  ${r.seriesId}: FEHLER — ${r.error}`);
  console.log();
}

const bundle = loadBundle(requiredSeriesIds());

/** Frueheste Woche, fuer die ueberhaupt Daten vorliegen. */
function earliestWeek(): IsoWeek {
  let earliest = '9999-12-31';
  for (const id of ['NFCI', 'T10Y2Y', 'VIXCLS', 'WALCL']) {
    const first = bundle[id]?.[0]?.date;
    if (first && first < earliest) earliest = first;
  }
  if (earliest === '9999-12-31') throw new Error('Keine Rohdaten im Cache — erst ohne --no-fetch laufen lassen');
  // Drei Monate Vorlauf, damit die 3m-Ableitungen ab der ersten Woche rechnen.
  const start = new Date(`${earliest}T00:00:00Z`);
  start.setUTCMonth(start.getUTCMonth() + 4);
  return isoWeekOf(start);
}

const from = argValue('--from') ? parseIsoWeekKey(argValue('--from')!) : earliestWeek();
const to = argValue('--to') ? parseIsoWeekKey(argValue('--to')!) : isoWeekOf(new Date());

const weeks = isoWeekRange(from, to);
console.log(`Backfill ${isoWeekKey(from)} bis ${isoWeekKey(to)} — ${weeks.length} Wochen\n`);

const built: Snapshot[] = [];
const missingCount = new Map<string, number>();
let full = 0;

for (const week of weeks) {
  const snapshot = buildSnapshot(rules, bundle, week, {
    backfill: true,
    volatility: volatilityFromHistory(built),
  });
  writeSnapshot(snapshot);
  built.push(snapshot);

  if (snapshot.completeness === 'full') full++;
  for (const id of snapshot.missing) missingCount.set(id, (missingCount.get(id) ?? 0) + 1);

  if (built.length % 50 === 0) {
    process.stdout.write(`  ${built.length}/${weeks.length} …\n`);
  }
}

const meaningful = built.filter((s) => s.meaningful);
const sparse = built.filter((s) => !s.meaningful);

console.log(`\n${built.length} Snapshots geschrieben.\n`);
console.log(`  vollstaendig (9/9):        ${String(full).padStart(4)}`);
console.log(`  aussagekraeftig:           ${String(meaningful.length).padStart(4)}  (alle drei Faktoren bestimmbar)`);
console.log(`  nur Datenluecke ("sparse"): ${String(sparse.length).padStart(4)}  (mindestens ein Faktor unbestimmbar)`);

console.log('\nFehlende Indikatoren im Bestand:');
for (const [id, count] of [...missingCount].sort((a, b) => b[1] - a[1])) {
  const pct = ((count / built.length) * 100).toFixed(0);
  console.log(`  ${id.padEnd(14)} in ${String(count).padStart(4)} von ${built.length} Wochen (${pct} %)`);
}
if (missingCount.size === 0) console.log('  keine');

/*
 * Die Regime-Verteilung wird ausschliesslich ueber die aussagekraeftigen
 * Wochen gebildet. Ueber alle Wochen gerechnet waere sie irrefuehrend: fehlt
 * ein Faktor, geht er als 0 in die Summe ein und zieht das Ergebnis Richtung
 * "Neutral". Man wuerde eine Datenluecke als Marktbefund lesen.
 */
if (meaningful.length > 0) {
  const byRegime = new Map<string, number>();
  for (const s of meaningful) byRegime.set(s.regime.label, (byRegime.get(s.regime.label) ?? 0) + 1);
  console.log(`\nRegime-Verteilung (nur die ${meaningful.length} aussagekraeftigen Wochen):`);
  for (const [label, count] of [...byRegime].sort((a, b) => b[1] - a[1])) {
    const pct = ((count / meaningful.length) * 100).toFixed(0);
    console.log(`  ${label.padEnd(10)} ${String(count).padStart(4)} Wochen (${pct} %)`);
  }
  console.log(
    `  Zeitraum: ${meaningful[0]!.weekKey} bis ${meaningful[meaningful.length - 1]!.weekKey}`,
  );
}

if (sparse.length > 0) {
  console.log(
    `\nACHTUNG: ${sparse.length} von ${built.length} Wochen (${((sparse.length / built.length) * 100).toFixed(0)} %) ` +
      `tragen zwar einen Gesamtscore, aber keine Aussage — bei ihnen ist mindestens ein ` +
      `Faktor mangels Daten nicht bestimmbar.`,
  );
  console.log(
    `Ursache: ISM ist oeffentlich nur fuer die juengste Zeit zu bekommen, Fear & Greed erst nach ` +
      `"npm run import:feargreed" ab 2011. Belastbare Historie beginnt daher erst bei ` +
      `${meaningful[0]?.weekKey ?? '—'}.`,
  );
  console.log('Die Verlaufsansicht muss diese Wochen sichtbar von den uebrigen absetzen.');
}

console.log(
  '\nHinweis: Backfill-Staende beruhen auf heutigen, teils revidierten Daten und sind ' +
    'nicht mit veroeffentlichten Wochenstaenden gleichzusetzen.',
);
