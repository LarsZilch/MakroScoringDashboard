/**
 * Gemeinsamer HTTP-Zugriff fuer alle Konnektoren.
 *
 * Grundhaltung: ein Fehlschlag ist ein erwarteter Betriebszustand, keine
 * Ausnahme. Die Quellen sind teils inoffiziell (CNN), teils gescrapt (AAII,
 * ISM) - sie werden ausfallen. Die App muss das aushalten und sichtbar
 * machen, statt daran zu sterben.
 */

/** Ein handelsueblicher Browser-Kennstring. Mehrere Quellen weisen andere ab. */
const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

export interface HttpOptions {
  headers?: Record<string, string>;
  timeoutMs?: number;
  retries?: number;
  /** Bezeichnung fuer Fehlermeldungen. */
  label?: string;
}

export class HttpError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly url?: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchOnce(url: string, opts: HttpOptions): Promise<Response> {
  const res = await fetch(url, {
    headers: {
      'User-Agent': BROWSER_UA,
      'Accept-Language': 'en-US,en;q=0.9',
      ...opts.headers,
    },
    signal: AbortSignal.timeout(opts.timeoutMs ?? 30_000),
    redirect: 'follow',
  });
  if (!res.ok) {
    throw new HttpError(
      `${opts.label ?? url} antwortete mit HTTP ${res.status} ${res.statusText}`,
      res.status,
      url,
    );
  }
  return res;
}

/**
 * Abruf mit Wiederholung bei voruebergehenden Fehlern.
 * 4xx ausser 429 wird nicht wiederholt - das ist kein Wackler, sondern ein
 * echtes Problem (Endpunkt weg, Bot-Sperre, Pfad falsch).
 */
export async function httpGet(url: string, opts: HttpOptions = {}): Promise<Response> {
  const retries = opts.retries ?? 2;
  let last: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fetchOnce(url, opts);
    } catch (err) {
      last = err;
      const status = err instanceof HttpError ? err.status : undefined;
      const permanent = status !== undefined && status >= 400 && status < 500 && status !== 429;
      if (permanent || attempt === retries) break;
      await sleep(500 * Math.pow(2, attempt));
    }
  }
  throw last instanceof Error
    ? last
    : new HttpError(`${opts.label ?? url}: Abruf fehlgeschlagen`, undefined, url);
}

export async function httpGetText(url: string, opts: HttpOptions = {}): Promise<string> {
  return (await httpGet(url, opts)).text();
}

/** Fuer Quellen, die eine Datei statt Text liefern (AAII gibt eine Arbeitsmappe). */
export async function httpGetBuffer(url: string, opts: HttpOptions = {}): Promise<Buffer> {
  return Buffer.from(await (await httpGet(url, opts)).arrayBuffer());
}

export async function httpGetJson<T = unknown>(url: string, opts: HttpOptions = {}): Promise<T> {
  const res = await httpGet(url, { ...opts, headers: { Accept: 'application/json', ...opts.headers } });
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new HttpError(
      `${opts.label ?? url}: Antwort ist kein gueltiges JSON (${text.slice(0, 120)}…)`,
      res.status,
      url,
    );
  }
}
