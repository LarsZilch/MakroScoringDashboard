/**
 * Der kleine Score-Chip (+1 / 0 / −1).
 *
 * Eigene Datei, seit ihn nicht mehr nur der Hilfe-Tab braucht: das Dashboard
 * zeigt dieselben Indikatorkarten in einem modalen Fenster.
 */

import type { Score } from '../types';
import { scoreText } from '../format';

export function ScoreChip({ score }: { score: Score }) {
  const cls = score > 0 ? 'pos' : score < 0 ? 'neg' : 'zero';
  return <span className={`score-chip ${cls}`}>{scoreText(score)}</span>;
}
