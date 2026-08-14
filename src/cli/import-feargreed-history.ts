/**
 * Einmaliger Import der historischen CNN-Fear-&-Greed-Rekonstruktion.
 *
 *   npm run import:feargreed
 *
 * Laeuft NICHT automatisch mit `npm run update` — die Quelle ist ein
 * vergangener, statischer Zeitraum von einem Drittanbieter-Repo ohne
 * Verfuegbarkeitsgarantie. Nach dem Import muss `npm run backfill --no-fetch`
 * laufen, damit die betroffenen historischen Snapshots neu gerechnet werden.
 */

import { ACCURATE_FROM, fetchFearGreedHistorical } from '../sources/cnn-historical.js';
import { writeCachedSeries } from '../pipeline/series-cache.js';

console.log('Historische Fear-&-Greed-Daten werden geladen (github.com/whit3rabbit/fear-greed-data) …\n');

const result = await fetchFearGreedHistorical();
const written = writeCachedSeries(result.seriesId, result.series, result.provenance);

const first = result.series[0]!.date;
const last = result.series[result.series.length - 1]!.date;
const before = result.series.filter((o) => o.date < ACCURATE_FROM).length;
const after = result.series.length - before;

console.log(`Geladen: ${written.total} Beobachtungen, ${first} bis ${last}`);
console.log(`  davon +${written.added} neu, ${written.changed} revidiert gegenueber dem bisherigen Cache`);
console.log(`  ${before} vor ${ACCURATE_FROM} (laut Autor "weniger genau")`);
console.log(`  ${after} ab ${ACCURATE_FROM} (laut Autor "precise")`);
console.log(`\n${result.warning}`);
console.log(
  '\nNaechster Schritt: npm run backfill -- --no-fetch, damit die betroffenen historischen ' +
    'Wochen mit diesem Wert neu gerechnet werden.',
);
