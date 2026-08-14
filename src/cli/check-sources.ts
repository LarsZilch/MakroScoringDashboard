/**
 * Live-Test aller Quellen: Erreichbarkeit, Umfang, Aktualitaet.
 *
 *   npm run check:sources
 *
 * Kein Teil der Testsuite — die laeuft ohne Netz gegen Fixtures. Dies hier
 * ist das Betriebswerkzeug fuer die Frage "warum fehlt im Dashboard ein Wert".
 */

import { fetchAll } from '../pipeline/fetch-all.js';
import { INDICATOR_SPECS, ageInDays, requiredSeriesIds } from '../pipeline/indicators.js';
import { HISTORICAL_SERIES_ID } from '../sources/cnn-historical.js';
import type { IndicatorId } from '../core/types.js';

/**
 * Reihen, die requiredSeriesIds() zwar kennt, die aber bewusst NICHT im
 * regulaeren Abruf-Zyklus stehen (siehe fetch-all.ts buildJobs). Ihr Fehlen
 * in der REIHE-Tabelle oben und in den "keine Daten fuer"-Meldungen unten ist
 * kein Fehlschlag, sondern der erwartete Zustand vor einem einmaligen Import.
 */
const OPTIONAL_ONE_TIME_SERIES = new Set([HISTORICAL_SERIES_ID]);

const today = new Date().toISOString().slice(0, 10);

console.log(`Quellen-Check · Stichtag ${today}\n`);

const { bundle, reports } = await fetchAll({ from: '2015-01-01', yahooRange: '5y' });

const pad = (s: string, n: number) => s.padEnd(n).slice(0, n);
console.log(pad('REIHE', 18), pad('STATUS', 8), pad('WERTE', 7), pad('NEU', 5), pad('LETZTER', 12), 'HINWEIS');
console.log('─'.repeat(110));

for (const r of [...reports].sort((a, b) => a.seriesId.localeCompare(b.seriesId))) {
  const status = r.ok ? 'ok' : 'FEHLER';
  const note = r.error ?? r.warning ?? '';
  const age = r.latest ? ageInDays(r.latest, today) : null;
  const latest = r.latest ? `${r.latest}${age !== null && age > 14 ? ` (${age}d)` : ''}` : '—';
  console.log(
    pad(r.seriesId, 18),
    pad(status, 8),
    pad(String(r.observations ?? '—'), 7),
    pad(r.added ? `+${r.added}` : '—', 5),
    pad(latest, 12),
    note.slice(0, 90),
  );
}

console.log('\nIndikatoren am heutigen Stichtag:\n');
console.log(pad('INDIKATOR', 16), pad('WERT', 12), pad('STAND', 12), pad('ALTER', 8), 'ZUSTAND');
console.log('─'.repeat(110));

let missing = 0;
let stale = 0;

for (const id of Object.keys(INDICATOR_SPECS) as IndicatorId[]) {
  const spec = INDICATOR_SPECS[id];
  const input = spec.compute(bundle, today);

  if (input.measureValue === null) {
    missing++;
    // Optionale, einmalig zu importierende Reihen zaehlen hier nicht als
    // Fehlgrund mit — ihr Fehlen vor dem ersten Import ist normal.
    const fehlend = spec.requires.filter(
      (s) => !bundle[s]?.length && !OPTIONAL_ONE_TIME_SERIES.has(s),
    );
    console.log(
      pad(id, 16),
      pad('—', 12),
      pad('—', 12),
      pad('—', 8),
      `FEHLT — ${fehlend.length ? `keine Daten fuer ${fehlend.join(', ')}` : 'zu wenig Historie fuer die Ableitung'}`,
    );
    continue;
  }

  const age = input.obsDate ? ageInDays(input.obsDate, today) : null;
  const isStale = age !== null && age > spec.maxAgeDays;
  if (isStale) stale++;
  console.log(
    pad(id, 16),
    pad(input.measureValue.toFixed(2), 12),
    pad(input.obsDate ?? '—', 12),
    pad(age === null ? '—' : `${age}d`, 8),
    isStale ? `VERALTET (Grenze ${spec.maxAgeDays}d)` : 'ok',
  );
}

const failed = reports.filter((r) => !r.ok).length;
console.log(
  `\n${reports.length - failed}/${reports.length} Reihen abrufbar · ` +
    `${9 - missing}/9 Indikatoren berechenbar · ${stale} veraltet`,
);
const routine = requiredSeriesIds().filter((s) => !OPTIONAL_ONE_TIME_SERIES.has(s));
const optional = requiredSeriesIds().filter((s) => OPTIONAL_ONE_TIME_SERIES.has(s));
console.log(`Regulaer abgerufene Rohreihen: ${routine.join(', ')}`);
if (optional.length > 0) {
  console.log(
    `Optionale, einmalig importierte Reihen: ${optional.join(', ')} ` +
      `(${optional.filter((s) => bundle[s]?.length).length}/${optional.length} bereits importiert — ` +
      'siehe npm run import:feargreed)',
  );
}

if (failed > 0 || missing > 0) process.exitCode = 1;
