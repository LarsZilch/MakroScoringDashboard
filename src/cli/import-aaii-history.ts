/**
 * Einmaliger Import der offiziellen AAII-Historie.
 *
 *   npm run import:aaii
 *
 * Laeuft NICHT automatisch mit `npm run update`: die Arbeitsmappe ist 440 kB
 * fuer einen Zeitraum, der sich nicht mehr aendert. Nach dem Import muss
 * `npm run backfill -- --no-fetch` laufen, damit die historischen Snapshots
 * den Indikator auch wirklich tragen.
 *
 * Anders als beim Fear-&-Greed-Import ist die Quelle hier AAII selbst — es
 * gibt keinen Genauigkeitsvorbehalt zu vermelden, nur eine Zeitgrenze.
 */

import { fetchAaiiHistory } from '../sources/aaii-history.js';
import { writeCachedSeries } from '../pipeline/series-cache.js';

console.log('Offizielle AAII-Historie wird geladen (aaii.com/files/surveys/sentiment.xlsx) …\n');

const result = await fetchAaiiHistory();
const written = writeCachedSeries(result.seriesId, result.series, result.provenance);

const first = result.series[0]!.date;
const last = result.series[result.series.length - 1]!.date;

console.log(`Geladen: ${result.series.length} Wochen, ${first} bis ${last}`);
console.log(
  `  Bestand danach: ${written.total} Beobachtungen ` +
    `(+${written.added} neu, ${written.changed} gegenueber dem bisherigen Cache geaendert)`,
);
console.log(`\n${result.warning}`);
console.log(
  '\nNaechste Schritte: npm run update (schliesst die Luecke bis zur laufenden Woche), ' +
    'danach npm run backfill -- --no-fetch.',
);
