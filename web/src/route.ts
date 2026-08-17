/**
 * Tab und Hilfe-Abschnitt im URL-Fragment.
 *
 * Warum ueberhaupt: der Zustand lag bisher nur im React-State. Ein Reload warf
 * einen auf das Dashboard zurueck, und es gab keine Moeglichkeit, jemandem
 * einen bestimmten Hilfe-Abschnitt zu schicken. Beides loest ein Fragment,
 * ohne dass ein Router noetig waere.
 *
 * Bewusst NUR Tab und Abschnitt. Die Wochenauswahl gehoert nicht hierhin: sie
 * aendert sich haeufig, wuerde die Verlaufsliste des Browsers zumuellen und
 * einen geteilten Link an eine Woche binden, die der Empfaenger gar nicht
 * meinte.
 *
 * Ein unbekanntes Fragment ist kein Fehler, sondern ein alter oder vertippter
 * Link — er landet still auf dem Dashboard.
 *
 * `section` ist bewusst `HelpSection | null` und NICHT auf einen Default
 * (z. B. "mechanik") normalisiert. "kein Abschnitt im Fragment" und "Fragment
 * nennt ausdruecklich Mechanik" sind unterschiedliche Aussagen: schriebe
 * parseHash("#/dashboard") einen Default-Abschnitt fest, wuerde jeder
 * Tab-Wechsel — der ja `location.hash` neu setzt und damit "hashchange"
 * ausloest — den zuletzt betrachteten Hilfe-Abschnitt ueberschreiben. Das war
 * genau der Fehler der ersten Fassung dieses Moduls: der Dashboard-Klick
 * feuerte "hashchange", der Listener parste "#/dashboard" zu "mechanik" und
 * riss den gemerkten Abschnitt mit sich. Der Aufrufer (App.tsx) muss den
 * gemerkten Wert also nur bei `section !== null` ueberschreiben.
 */

import { SECTIONS, type HelpSection } from './content/sections';

export type { HelpSection } from './content/sections';
export type Tab = 'dashboard' | 'history' | 'help';

export interface Route {
  tab: Tab;
  section: HelpSection | null;
}

export const DEFAULT_ROUTE: Route = { tab: 'dashboard', section: null };

/**
 * Die Beschriftung im Fragment ist deutsch wie die Oberflaeche, der interne
 * Bezeichner englisch wie der Rest des Codes. Diese Tabelle ist die einzige
 * Stelle, an der beides aufeinandertrifft.
 */
const TAB_SLUG: Record<Tab, string> = {
  dashboard: 'dashboard',
  history: 'verlauf',
  help: 'hilfe',
};

const TAB_BY_SLUG = new Map<string, Tab>(
  (Object.entries(TAB_SLUG) as [Tab, string][]).map(([tab, slug]) => [slug, tab]),
);

/** Abschnitts-IDs kommen aus der Hilfe selbst — keine zweite Liste. */
const SECTION_IDS = new Set<string>(SECTIONS.map((s) => s.id));

export function parseHash(hash: string): Route {
  const [tabSlug, sectionSlug] = hash.replace(/^#\/?/, '').split('/');

  const tab = TAB_BY_SLUG.get(tabSlug ?? '');
  if (!tab) return DEFAULT_ROUTE;

  /*
   * Ein Abschnitt wird nur auf dem Hilfe-Tab uebernommen. "#/verlauf/szenarien"
   * waere sonst ein Zustand, der sich beim naechsten Klick auf Hilfe
   * ueberraschend zeigt.
   */
  const section =
    tab === 'help' && sectionSlug && SECTION_IDS.has(sectionSlug)
      ? (sectionSlug as HelpSection)
      : null;

  return { tab, section };
}

/**
 * `section` muss uebergeben werden — nicht optional, damit ein Aufrufer nie
 * versehentlich den zuletzt bekannten Abschnitt aus dem Fragment tilgt, indem
 * er ihn vergisst.
 */
export function formatHash(tab: Tab, section: HelpSection): string {
  return tab === 'help' ? `#/${TAB_SLUG.help}/${section}` : `#/${TAB_SLUG[tab]}`;
}
