/**
 * Wochenauswahl: Zurueck-Knopf, Dropdown, Vor-Knopf — plus Pfeiltasten.
 *
 * Steht bewusst nur im Dashboard (siehe App.tsx). Die Tastatursteuerung sitzt
 * deshalb hier und nicht global: ein "keydown"-Listener auf window, der nur
 * lebt, waehrend diese Komponente gemountet ist, raeumt sich beim Tab-Wechsel
 * von selbst auf — kein zusaetzliches "bin ich aktiv"-Flag noetig.
 */

import { useEffect } from 'react';
import { scoreText, weekLabel } from '../format';
import { stepWeek, type WeekOption } from '../weeknav';

export function WeekPicker({
  options,
  selected,
  hiddenCount,
  onSelect,
}: {
  options: (WeekOption & { total: number; regime: string })[];
  selected: string;
  hiddenCount: number;
  onSelect: (weekKey: string) => void;
}) {
  const older = stepWeek(options, selected, 'older');
  const newer = stepWeek(options, selected, 'newer');

  /*
   * Zwei Wachen, beide notwendig: Modifikatortasten durchlassen (sonst
   * bricht z. B. Strg+Pfeil in den Browser-Werkzeugen), und Tastendruecke aus
   * Eingabefeldern ignorieren — sonst wuerde ein Pfeildruck im geoeffneten
   * Dropdown die Woche zusaetzlich zur Browser-eigenen Listennavigation
   * verschieben.
   */
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return;
      }
      if (e.key === 'ArrowLeft' && older) {
        e.preventDefault();
        onSelect(older);
      } else if (e.key === 'ArrowRight' && newer) {
        e.preventDefault();
        onSelect(newer);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [older, newer, onSelect]);

  return (
    <div className="controls">
      <button
        className="step"
        onClick={() => older && onSelect(older)}
        disabled={!older}
        aria-label="Eine Woche zurueck"
        title="Eine Woche zurueck (Pfeiltaste links)"
      >
        ←
      </button>
      <select
        value={selected}
        onChange={(e) => onSelect(e.target.value)}
        title={
          hiddenCount > 0
            ? `${hiddenCount} unvollstaendige Backfill-Wochen sind hier ausgeblendet — sie stehen in der Verlaufsansicht`
            : undefined
        }
      >
        <option value="latest">juengste Woche</option>
        {options.map((o) => (
          <option key={o.weekKey} value={o.weekKey}>
            {weekLabel(o.weekKey)} · {scoreText(o.total)} {o.regime}
          </option>
        ))}
      </select>
      <button
        className="step"
        onClick={() => newer && onSelect(newer)}
        disabled={!newer}
        aria-label="Eine Woche vor"
        title="Eine Woche vor (Pfeiltaste rechts)"
      >
        →
      </button>
    </div>
  );
}
