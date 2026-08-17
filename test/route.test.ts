/**
 * URL-Fragment <-> { tab, section } (web/src/route.ts).
 *
 * Der wichtigste Fall ist der Regressionstest fuer den Fehler aus der ersten
 * Fassung: "#/dashboard" darf NICHT wie "#/hilfe/mechanik" behandelt werden.
 * Sonst ueberschreibt jeder Tab-Wechsel — der ja location.hash neu setzt und
 * damit "hashchange" ausloest — den zuletzt betrachteten Hilfe-Abschnitt mit
 * "mechanik".
 */

import { describe, expect, it } from 'vitest';
import { formatHash, parseHash } from '../web/src/route.js';

describe('parseHash', () => {
  it('liefert section: null fuer Tabs ausserhalb der Hilfe — der Regressionsfall', () => {
    expect(parseHash('#/dashboard')).toEqual({ tab: 'dashboard', section: null });
    expect(parseHash('#/verlauf')).toEqual({ tab: 'history', section: null });
  });

  it('liest Tab und Abschnitt der Hilfe', () => {
    expect(parseHash('#/hilfe/szenarien')).toEqual({ tab: 'help', section: 'szenarien' });
  });

  it('Hilfe ohne Abschnitt bleibt section: null, nicht "mechanik"', () => {
    expect(parseHash('#/hilfe')).toEqual({ tab: 'help', section: null });
  });

  it('ein Abschnitt auf einem anderen Tab zaehlt nicht — er gilt nur fuer Hilfe', () => {
    expect(parseHash('#/verlauf/szenarien')).toEqual({ tab: 'history', section: null });
  });

  it('leeres oder unbekanntes Fragment landet still auf dem Dashboard', () => {
    expect(parseHash('')).toEqual({ tab: 'dashboard', section: null });
    expect(parseHash('#/nirgendwo')).toEqual({ tab: 'dashboard', section: null });
    expect(parseHash('#/hilfe/nirgendwo')).toEqual({ tab: 'help', section: null });
  });
});

describe('formatHash', () => {
  it('haengt den Abschnitt nur fuer Hilfe an', () => {
    expect(formatHash('help', 'szenarien')).toBe('#/hilfe/szenarien');
    expect(formatHash('dashboard', 'mechanik')).toBe('#/dashboard');
    expect(formatHash('history', 'mechanik')).toBe('#/verlauf');
  });

  it('Rundlauf fuer die kanonischen Formen', () => {
    for (const hash of ['#/dashboard', '#/verlauf', '#/hilfe/mechanik', '#/hilfe/szenarien', '#/hilfe/grenzen']) {
      const route = parseHash(hash);
      expect(formatHash(route.tab, route.section ?? 'mechanik')).toBe(hash);
    }
  });
});
