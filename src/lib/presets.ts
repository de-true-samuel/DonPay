export interface ServicePreset {
  id: string;
  service: string;
  plan: 'FULL' | 'DEPOSIT_BALANCE';
  total: string;
  deposit?: string;
}

const STORAGE_KEY = 'paidar.presets';

export const DEFAULT_PRESETS: ServicePreset[] = [
  { id: '1', service: 'Bridal makeup', plan: 'DEPOSIT_BALANCE', total: '50,000', deposit: '25,000' },
  { id: '2', service: 'Aso-ebi fitting', plan: 'FULL', total: '15,000' },
  { id: '3', service: 'Hair styling', plan: 'FULL', total: '20,000' },
  { id: '4', service: 'Gown alteration', plan: 'FULL', total: '8,000' },
];

export function getSavedPresets(): ServicePreset[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PRESETS;
    const parsed = JSON.parse(raw) as ServicePreset[];
    if (Array.isArray(parsed) && parsed.length > 0) return parsed;
  } catch {
    /* fallback to defaults */
  }
  return DEFAULT_PRESETS;
}

export function savePresets(presets: ServicePreset[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
  } catch {
    /* storage unavailable */
  }
}
