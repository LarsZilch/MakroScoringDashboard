/**
 * Regelwerk von der Platte laden. Der einzige Ort mit Dateizugriff auf rules/;
 * die Pruefung selbst steckt in src/core/rulebook.ts und bleibt I/O-frei.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseRuleBook } from '../core/rulebook.js';
import type { RuleBook } from '../core/types.js';
import { RULES_DIR } from './paths.js';

const cache = new Map<string, RuleBook>();

export function loadRules(version = 'v1'): RuleBook {
  const cached = cache.get(version);
  if (cached) return cached;

  const file = join(RULES_DIR, `${version}.json`);
  let raw: string;
  try {
    raw = readFileSync(file, 'utf8');
  } catch {
    throw new Error(`Regelwerk ${version} nicht gefunden (${file}). Vorhanden: ${listRuleVersions().join(', ') || 'keins'}`);
  }

  const rules = parseRuleBook(JSON.parse(raw));
  if (rules.version !== version) {
    throw new Error(`${file} traegt intern die Version "${rules.version}", erwartet war "${version}"`);
  }
  cache.set(version, rules);
  return rules;
}

export function listRuleVersions(): string[] {
  try {
    return readdirSync(RULES_DIR)
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.replace(/\.json$/, ''))
      .sort();
  } catch {
    return [];
  }
}

/** Neueste Regelwerk-Version (hoechste vN). */
export function latestRuleVersion(): string {
  const versions = listRuleVersions();
  if (versions.length === 0) throw new Error(`Keine Regelwerke in ${RULES_DIR}`);
  return versions.sort((a, b) => {
    const na = Number(a.replace(/^v/, '')) || 0;
    const nb = Number(b.replace(/^v/, '')) || 0;
    return na - nb;
  })[versions.length - 1]!;
}
