/**
 * Das modale Fenster hinter den Fragezeichen im Dashboard.
 *
 * Nur die Huelle — Rahmen, Schliessen, Tastatur. Der Inhalt kommt von aussen,
 * und zwar derselbe Baustein, den auch der Hilfe-Tab rendert. Das ist der
 * ganze Zweck der Aufteilung: eine eigene, kuerzere Erklaerung fuer das
 * Dashboard waere eine zweite Wahrheit, die still veraltet.
 *
 * Deshalb traegt das Fenster auch keine eigene Ueberschrift: der Inhalt bringt
 * seinen Kopf schon mit, und ein zweiter Titel darueber stuende doppelt.
 */

import { useEffect, useRef, type ReactNode } from 'react';

export function HelpModal({
  title,
  onClose,
  children,
}: {
  /** Nur fuer Screenreader — sichtbar steht der Titel im Inhalt selbst. */
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  /*
   * Wo die Maus GEDRUECKT wurde, nicht wo losgelassen. Beim Markieren eines
   * Satzes im Fenster landet das Loslassen leicht ausserhalb — ohne diese
   * Unterscheidung schluesse der Text sich selbst weg, sobald man ihn liest.
   */
  const pressedOnBackdrop = useRef(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);

    // Die Seite dahinter darf nicht mitscrollen, sonst ist beim Schliessen die
    // Stelle verloren, an der man war.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    closeRef.current?.focus();

    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        pressedOnBackdrop.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && pressedOnBackdrop.current) onClose();
      }}
    >
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <button ref={closeRef} className="modal-close" onClick={onClose} aria-label="Schliessen">
          ×
        </button>
        {children}
      </div>
    </div>
  );
}
