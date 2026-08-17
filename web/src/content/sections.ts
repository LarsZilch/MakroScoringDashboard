/**
 * Die Abschnitte des Hilfe-Tabs.
 *
 * Eigenes Modul statt in Help.tsx: web/src/route.ts braucht diese Liste, um
 * ein URL-Fragment gegen gueltige Abschnitts-IDs zu pruefen, darf dafuer aber
 * kein Modul voller JSX importieren.
 */

export type HelpSection =
  | 'mechanik'
  | 'indikatoren'
  | 'szenarien'
  | 'anlageklassen'
  | 'handel'
  | 'grenzen';

export const SECTIONS: { id: HelpSection; label: string }[] = [
  { id: 'mechanik', label: 'Mechanik' },
  { id: 'indikatoren', label: 'Die neun Indikatoren' },
  { id: 'szenarien', label: 'Szenarien' },
  { id: 'anlageklassen', label: 'Anlageklassen im Regime' },
  { id: 'handel', label: 'Ableitung fuer den Handel' },
  { id: 'grenzen', label: 'Grenzen' },
];
