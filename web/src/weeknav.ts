/**
 * Indexrechnung fuer das Blaettern durch die Wochenauswahl.
 *
 * Reine Funktionen, absichtlich getrennt von WeekPicker.tsx: die Logik "wo
 * stehe ich, was ist eine Woche weiter" laesst sich so ohne DOM pruefen.
 *
 * `options` ist neueste zuerst sortiert (wie in App.tsx aufgebaut). Index 0
 * ist damit die juengste Woche — und genau das bildet `'latest'` ab: der
 * Server bevorzugt zwar den woertlichen Wert, aber fuer die Navigation ist
 * "juengste Woche" gleichbedeutend mit Index 0.
 */

export interface WeekOption {
  weekKey: string;
}

/** Position von `selected` in `options`; 'latest' und ein unbekannter Schluessel landen auf 0. */
export function resolveIndex(options: WeekOption[], selected: string): number {
  if (selected === 'latest') return 0;
  const idx = options.findIndex((o) => o.weekKey === selected);
  return idx >= 0 ? idx : 0;
}

/**
 * Einen Schritt aelter oder neuer als `selected`.
 *
 * `null` an einem Rand des Bestands — das ist die Grundlage fuer die
 * `disabled`-Knoepfe in WeekPicker und dafuer, dass ein Tastendruck am Rand
 * folgenlos bleibt statt den Wert zu wiederholen.
 */
export function stepWeek(
  options: WeekOption[],
  selected: string,
  direction: 'older' | 'newer',
): string | null {
  if (options.length === 0) return null;
  const idx = resolveIndex(options, selected);
  const nextIdx = direction === 'older' ? idx + 1 : idx - 1;
  if (nextIdx < 0 || nextIdx >= options.length) return null;
  return options[nextIdx]!.weekKey;
}
