import type { Series } from '../core/derive.js';
import type { Provenance, Quality } from '../core/types.js';

/** Was jeder Konnektor zurueckgibt. */
export interface SourceResult {
  /** Kennung der Rohreihe, zugleich Dateiname im Cache. */
  seriesId: string;
  series: Series;
  provenance: Provenance;
  quality: Quality;
  /** Hinweis fuer den Betrieb, z. B. "Reihe endet vor 40 Tagen". */
  warning?: string;
}

/**
 * Die Parser sind bewusst von den Abrufen getrennt: die reine Parse-Funktion
 * laesst sich gegen eine eingecheckte Beispielantwort testen, ohne Netz. Nur
 * so faellt ein Layoutwechsel bei AAII oder PRNewswire als roter Test auf und
 * nicht als stiller Falschwert.
 */
export type Parser<T> = (raw: string, context?: string) => T;
