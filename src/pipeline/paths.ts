/** Zentrale Pfadauflösung, damit CLI, Server und Tests dieselben Orte treffen. */

import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

/** Projektwurzel: src/pipeline -> src -> Wurzel */
export const ROOT = resolve(here, '..', '..');

export const RULES_DIR = join(ROOT, 'rules');
export const DATA_DIR = join(ROOT, 'data');
export const SNAPSHOT_DIR = join(DATA_DIR, 'snapshots');
/** Rohdaten-Cache, bewusst nicht versioniert. */
export const SERIES_DIR = join(DATA_DIR, 'series');
export const MANUAL_DIR = join(DATA_DIR, 'manual');
export const MANUAL_OVERRIDES = join(MANUAL_DIR, 'overrides.json');
export const DOC_DIR = join(ROOT, 'doc');
