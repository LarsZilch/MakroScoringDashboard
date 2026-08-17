import type {
  AssetsResponse,
  HistoryResponse,
  PerformanceResponse,
  RegimeMode,
  RulesResponse,
  ScenarioBacktestReport,
  WeekResponse,
} from './types';

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `${path}: HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const fetchWeek = (weekKey = 'latest') => get<WeekResponse>(`/api/week/${weekKey}`);
export const fetchHistory = () => get<HistoryResponse>('/api/history');
export const fetchRules = () => get<RulesResponse>('/api/rules');
export const fetchScenarios = () => get<ScenarioBacktestReport>('/api/scenarios');

export const fetchAssets = (mode: RegimeMode, from?: string) =>
  get<AssetsResponse>(`/api/assets?mode=${mode}${from ? `&from=${from}` : ''}`);

export const fetchPerformance = (mode: RegimeMode) =>
  get<PerformanceResponse>(`/api/regime-performance?mode=${mode}`);

export async function refresh(weekKey?: string): Promise<void> {
  const res = await fetch('/api/refresh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(weekKey ? { weekKey } : {}),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `Aktualisierung fehlgeschlagen (${res.status})`);
  }
}
