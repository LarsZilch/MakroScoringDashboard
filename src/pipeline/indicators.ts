/**
 * Bruecke zwischen Rohreihen und Scoring-Eingabe.
 *
 * Fuer jeden der neun Indikatoren steht hier, welche Rohreihen er braucht,
 * wie daraus die bewertete Kennzahl entsteht und ab wann ein Wert als
 * veraltet gilt. Die Bewertung selbst passiert nicht hier, sondern im
 * Regelwerk — dieses Modul liefert nur die Zahl.
 */

import {
  annualizedRateOverMonths,
  changeOverMonths,
  combineSeries,
  lastOnOrBefore,
  rateDirection,
  trailingAverage,
  type Series,
} from '../core/derive.js';
import type { IndicatorId, IndicatorInput, IndicatorRule } from '../core/types.js';
import { monthName, num, shortDate, signed, trendWord } from './format.js';
import { ACCURATE_FROM, HISTORICAL_SERIES_ID } from '../sources/cnn-historical.js';

/** Alle abgerufenen Rohreihen, nach Kennung. */
export type SeriesBundle = Record<string, Series>;

/**
 * Korridortext aus dem Regelwerk statt aus dem Kopf.
 *
 * Diese Zeile stand frueher als Text in den Anzeigezeilen ("Korridor 15–25").
 * Damit gab es sie zweimal: einmal in rules/*.json und einmal hier — und beim
 * Verschieben einer Schwelle wanderte nur die eine Fassung mit. Genau die
 * zweite Wahrheit, die der Hilfe-Tab vermeiden soll.
 */
function corridorText(rule: IndicatorRule | undefined, decimals = 0): string | null {
  if (!rule?.corridor) return null;
  const [lo, hi] = rule.corridor;
  return `Korridor ${num(lo, decimals)} bis ${num(hi, decimals)}`;
}

export interface IndicatorSpec {
  id: IndicatorId;
  /** Rohreihen, ohne die der Indikator nicht berechenbar ist. */
  requires: string[];
  /**
   * Ab welchem Alter der zugrunde liegenden Beobachtung der Wert als veraltet
   * gilt. Bemessen nach Veroeffentlichungsrhythmus plus ueblicher Verzoegerung.
   *
   * Das ist der Schutz gegen den heimtueckischsten Fehler dieser Bauart: eine
   * Quelle liefert stillschweigend nicht mehr, "letzter Wert davor" greift auf
   * einen Monate alten Stand zurueck, und das Dashboard zeigt zuversichtlich
   * eine Zahl an, die niemand mehr aktualisiert.
   */
  maxAgeDays: number;
  /**
   * `rule` ist die Regel dieses Indikators aus dem Regelwerk. Sie wird
   * hereingereicht, damit Korridore und Schwellen in den Anzeigezeilen aus
   * derselben Quelle stammen wie die Bewertung.
   */
  compute(bundle: SeriesBundle, asOf: string, rule?: IndicatorRule): IndicatorInput;
}

const MISSING: IndicatorInput = { measureValue: null, quality: 'missing' };

/** Alter einer Beobachtung in Tagen, bezogen auf den Stichtag. */
export function ageInDays(obsDate: string, asOf: string): number {
  return Math.round(
    (Date.parse(`${asOf}T00:00:00Z`) - Date.parse(`${obsDate}T00:00:00Z`)) / 86_400_000,
  );
}

/**
 * Fed Net Liquidity als Ersatzreihe fuer den Howell GLI.
 *
 * ACHTUNG EINHEITEN: WALCL und WTREGEN stehen bei FRED in Millionen USD,
 * RRPONTSYD dagegen in MILLIARDEN USD. Ohne die Umrechnung waere der
 * Reverse-Repo-Abzug um den Faktor 1000 zu klein und damit praktisch
 * wirkungslos — ein Fehler, der nirgends auffiele, weil das Ergebnis
 * weiterhin plausibel aussaehe.
 */
export function netLiquidity(bundle: SeriesBundle): Series | null {
  const walcl = bundle.WALCL;
  const tga = bundle.WTREGEN;
  const rrp = bundle.RRPONTSYD;
  if (!walcl?.length || !tga?.length || !rrp?.length) return null;

  return combineSeries(walcl, [tga, rrp], (balance, [tgaValue, rrpBillions]) => {
    return balance - tgaValue! - rrpBillions! * 1000;
  });
}

export const INDICATOR_SPECS: Record<IndicatorId, IndicatorSpec> = {
  ism_mfg_pmi: {
    id: 'ism_mfg_pmi',
    requires: ['ISM_MFG_PMI'],
    maxAgeDays: 75, // monatlich, Veroeffentlichung am ersten Werktag des Folgemonats
    compute(bundle, asOf) {
      const series = bundle.ISM_MFG_PMI;
      if (!series?.length) return MISSING;
      const c = changeOverMonths(series, asOf, 3);
      if (!c) return MISSING;
      return {
        measureValue: c.change,
        value: c.current,
        obsDate: c.currentDate,
        derived: { change3m: c.change, previous: c.previous },
        display: {
          primary: `${num(c.current, 1)} (${monthName(c.currentDate)})`,
          secondary: `${signed(c.change, 1)} Pkt vs. ${monthName(c.previousDate)}`,
        },
      };
    },
  },

  nfci: {
    id: 'nfci',
    requires: ['NFCI'],
    maxAgeDays: 21, // woechentlich, mit einer Woche Verzoegerung
    compute(bundle, asOf) {
      const series = bundle.NFCI;
      if (!series?.length) return MISSING;
      const c = changeOverMonths(series, asOf, 3);
      if (!c) return MISSING;
      // Fallende Werte = lockerere Finanzbedingungen.
      const word = trendWord(c.change, 0.02, {
        up: 'straffer',
        down: 'lockerer',
        flat: 'unveraendert',
      });
      return {
        measureValue: c.change,
        value: c.current,
        obsDate: c.currentDate,
        derived: { change3m: c.change },
        display: {
          primary: signed(c.current, 3),
          secondary: `${word} (${signed(c.change, 3)})`,
        },
      };
    },
  },

  t10y2y: {
    id: 't10y2y',
    requires: ['T10Y2Y'],
    maxAgeDays: 10, // taeglich
    compute(bundle, asOf) {
      const series = bundle.T10Y2Y;
      if (!series?.length) return MISSING;
      const c = changeOverMonths(series, asOf, 3);
      if (!c) return MISSING;
      // FRED liefert Prozentpunkte; das Regelwerk bewertet Basispunkte.
      const changeBp = c.change * 100;
      const word = trendWord(changeBp, 3, {
        up: 'steiler',
        down: 'flacher',
        flat: 'unveraendert',
      });
      // "leicht" nur vor eine Richtung setzen — "leicht unveraendert" waere Unsinn.
      const qualifier = word !== 'unveraendert' && Math.abs(changeBp) < 10 ? 'leicht ' : '';
      return {
        measureValue: changeBp,
        value: c.current,
        obsDate: c.currentDate,
        derived: { change3mBp: changeBp, level: c.current },
        display: {
          primary: `${signed(c.current, 2)} %`,
          secondary: `${qualifier}${word} (${signed(changeBp, 0)} bps)`,
        },
      };
    },
  },

  gli: {
    id: 'gli',
    requires: ['WALCL', 'WTREGEN', 'RRPONTSYD'],
    maxAgeDays: 21, // woechentliche Fed-Bilanz
    compute(bundle, asOf) {
      const series = netLiquidity(bundle);
      if (!series?.length) return MISSING;
      const dir = rateDirection(series, asOf, 3, 1);
      const rate = annualizedRateOverMonths(series, asOf, 3);
      const cur = lastOnOrBefore(series, asOf);
      if (!dir || rate === null || !cur) return MISSING;
      const word = trendWord(dir.delta, 0.5, {
        up: 'steigend',
        down: 'fallend',
        flat: 'seitwaerts',
      });
      return {
        measureValue: dir.delta,
        value: rate,
        obsDate: cur.date,
        derived: {
          rate3mAnn: rate,
          rate3mAnnPrev: dir.ratePrev,
          rate3mAnnDelta: dir.delta,
          levelMioUsd: cur.value,
        },
        display: {
          primary: `${num(rate, 1)} % 3m ann.`,
          secondary: word,
        },
      };
    },
  },

  move: {
    id: 'move',
    requires: ['MOVE'],
    maxAgeDays: 10,
    compute(bundle, asOf) {
      const series = bundle.MOVE;
      if (!series?.length) return MISSING;
      const cur = lastOnOrBefore(series, asOf);
      if (!cur) return MISSING;
      return {
        measureValue: cur.value,
        value: cur.value,
        obsDate: cur.date,
        display: {
          primary: `≈ ${num(cur.value, 0)}`,
          secondary: cur.value < 80 ? 'unter 80' : cur.value > 100 ? 'ueber 100' : 'zwischen 80 und 100',
        },
      };
    },
  },

  sofr_iorb: {
    id: 'sofr_iorb',
    requires: ['SOFR', 'IORB_CHAINED'],
    maxAgeDays: 10,
    compute(bundle, asOf) {
      const sofr = bundle.SOFR;
      const iorb = bundle.IORB_CHAINED;
      if (!sofr?.length || !iorb?.length) return MISSING;
      const a = lastOnOrBefore(sofr, asOf);
      const b = lastOnOrBefore(iorb, asOf);
      if (!a || !b) return MISSING;
      // Beide in Prozent; das Regelwerk bewertet Basispunkte.
      const spreadBp = Math.round((a.value - b.value) * 100);
      return {
        measureValue: spreadBp,
        value: spreadBp,
        // Der aeltere der beiden Staende bestimmt die Aktualitaet.
        obsDate: a.date < b.date ? a.date : b.date,
        derived: { sofr: a.value, iorb: b.value, spreadBp },
        display: {
          primary: `${signed(spreadBp, 0)} bp`,
          secondary: `${num(a.value, 2)} vs. ${num(b.value, 2)}`,
        },
      };
    },
  },

  vix: {
    id: 'vix',
    requires: ['VIXCLS'],
    maxAgeDays: 10,
    compute(bundle, asOf, rule) {
      const series = bundle.VIXCLS;
      if (!series?.length) return MISSING;
      const cur = lastOnOrBefore(series, asOf);
      if (!cur) return MISSING;
      return {
        measureValue: cur.value,
        value: cur.value,
        obsDate: cur.date,
        display: {
          primary: num(cur.value, 2),
          secondary: corridorText(rule, 0) ?? 'Level',
        },
      };
    },
  },

  aaii: {
    id: 'aaii',
    requires: ['AAII_BULL_BEAR'],
    maxAgeDays: 21,
    compute(bundle, asOf, rule) {
      const series = bundle.AAII_BULL_BEAR;
      if (!series?.length) return MISSING;
      const avg = trailingAverage(series, asOf, 4);
      const cur = lastOnOrBefore(series, asOf);
      if (!avg || !cur) return MISSING;
      const corridor = corridorText(rule, 0);
      return {
        measureValue: avg.avg,
        value: avg.avg,
        obsDate: cur.date,
        derived: { avg4w: avg.avg, weeksAvailable: avg.count, latestSpread: cur.value },
        display: {
          primary: `${signed(avg.avg, 1)} %`,
          // Die Historie waechst erst mit den Laeufen; solange weniger als vier
          // Wochen vorliegen, ist der "4w-Schnitt" keiner. Das gehoert sichtbar
          // in die Anzeige, nicht in eine Fussnote.
          secondary: [avg.count < 4 ? `nur ${avg.count} von 4 Wochen` : null, corridor]
            .filter(Boolean)
            .join(' · '),
        },
      };
    },
  },

  fear_greed: {
    id: 'fear_greed',
    // CNN_FEAR_GREED_HISTORICAL ist optional: fehlt der Cache (kein Import
    // gelaufen), liefert loadBundle() einfach keine Reihe dafuer, und die
    // Berechnung faellt unten sauber auf "nur live" zurueck.
    requires: ['CNN_FEAR_GREED', HISTORICAL_SERIES_ID],
    maxAgeDays: 10,
    compute(bundle, asOf, rule) {
      // Die Einstufung folgt der Skala von CNN selbst, nicht dem Regelwerk —
      // sie ist Beschreibung des Rohwerts, nicht Teil der Bewertung.
      const ratingOf = (value: number) =>
        value > 75 ? 'Extreme Greed'
        : value > 55 ? 'Greed'
        : value > 45 ? 'Neutral'
        : value > 25 ? 'Fear'
        : 'Extreme Fear';
      const corridor = corridorText(rule, 0) ?? 'Level';

      // 1. Echter CNN-Live-Wert hat immer Vorrang.
      const live = bundle.CNN_FEAR_GREED;
      const liveObs = live?.length ? lastOnOrBefore(live, asOf) : null;
      if (liveObs) {
        return {
          measureValue: liveObs.value,
          value: liveObs.value,
          obsDate: liveObs.date,
          display: { primary: `${num(liveObs.value, 0)} (${ratingOf(liveObs.value)})`, secondary: corridor },
        };
      }

      /*
       * 2. Kein Live-Wert fuer diese Woche (typisch: Wochen vor dem
       * rollierenden ~1-Jahres-Fenster des CNN-Endpunkts) — auf die
       * importierte Community-Rekonstruktion zurueckfallen, falls vorhanden.
       * quality:'proxy' hier ist Absicht: dieselbe Kennzeichnung und dasselbe
       * "ERSATZREIHE"-Badge wie beim GLI, denn genau das ist es — ein Ersatz
       * fuer den nicht verfuegbaren Originalwert von CNN selbst.
       */
      const hist = bundle[HISTORICAL_SERIES_ID];
      const histObs = hist?.length ? lastOnOrBefore(hist, asOf) : null;
      if (histObs) {
        const accurate = histObs.date >= ACCURATE_FROM;
        return {
          measureValue: histObs.value,
          value: histObs.value,
          obsDate: histObs.date,
          quality: 'proxy',
          display: {
            primary: `${num(histObs.value, 0)} (${ratingOf(histObs.value)})`,
            secondary:
              `${corridor} · Rekonstruktion, nicht CNN selbst` +
              (accurate ? '' : ` · vor ${ACCURATE_FROM}, laut Quelle weniger genau`),
          },
        };
      }

      return MISSING;
    },
  },
};

/** Alle Rohreihen, die fuer ein vollstaendiges Scoring gebraucht werden. */
export function requiredSeriesIds(): string[] {
  const set = new Set<string>();
  for (const spec of Object.values(INDICATOR_SPECS)) {
    for (const s of spec.requires) set.add(s);
  }
  return [...set].sort();
}

/** Zusatzhinweis fuer die Anzeige, wenn ein Wert zu alt ist. */
export function stalenessNote(spec: IndicatorSpec, obsDate: string, asOf: string): string | null {
  const age = ageInDays(obsDate, asOf);
  if (age <= spec.maxAgeDays) return null;
  return `Stand ${shortDate(obsDate)} ist ${age} Tage alt (erwartet hoechstens ${spec.maxAgeDays})`;
}
