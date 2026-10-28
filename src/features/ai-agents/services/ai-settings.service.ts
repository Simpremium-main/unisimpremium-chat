import { api } from '@/lib/api';

export type Weekday =
  | 'monday'
  | 'tuesday'
  | 'wednesday'
  | 'thursday'
  | 'friday'
  | 'saturday'
  | 'sunday';

export interface BusinessHoursDay {
  enabled: boolean;
  windows?: Array<[string, string]>; // ["09:00","18:00"]
}
export type BusinessHoursConfig = Partial<Record<Weekday, BusinessHoursDay>>;

export interface WatchdogConfig {
  delayBotMin?: number;
  delayPendingMin?: number;
  delayHumanIdleMin?: number;
  maxAttempts?: number;
}

export const DEFAULT_WATCHDOG_CONFIG: Required<WatchdogConfig> = {
  delayBotMin: 15,
  delayPendingMin: 15,
  delayHumanIdleMin: 60,
  maxAttempts: 3,
};

export interface OrganizationAiSettings {
  id: string;
  name: string;
  aiEnabled: boolean;
  aiTimezone: string;
  aiBusinessHours: BusinessHoursConfig | null;
  aiOutOfHoursMessage: string | null;
  aiBusinessNotes: string | null;
  aiAutoDisableOnHuman: boolean;
  aiMonthlyTokenCap: number | null;
  watchdogEnabled: boolean;
  watchdogBusinessHours: BusinessHoursConfig | null;
  watchdogConfig: WatchdogConfig | null;
  /** Lista de domínios permitidos em URLs que a IA pode mandar pro cliente.
   *  null/[] = permissivo (não bloqueia, só warning). Match por sufixo. */
  allowedUrlDomains: string[] | null;
}

export interface UpdateAiSettingsInput {
  aiEnabled?: boolean;
  aiTimezone?: string;
  aiBusinessHours?: BusinessHoursConfig | null;
  aiOutOfHoursMessage?: string;
  aiBusinessNotes?: string | null;
  aiAutoDisableOnHuman?: boolean;
  aiMonthlyTokenCap?: number | null;
  watchdogEnabled?: boolean;
  watchdogBusinessHours?: BusinessHoursConfig | null;
  watchdogConfig?: WatchdogConfig | null;
  allowedUrlDomains?: string[] | null;
}

export const aiSettingsService = {
  async get(): Promise<OrganizationAiSettings> {
    const { data } = await api.get('/organizations/current');
    return data.data ?? data;
  },

  async update(input: UpdateAiSettingsInput): Promise<OrganizationAiSettings> {
    const { data } = await api.patch('/organizations/current', input);
    return data.data ?? data;
  },
};

export const WEEKDAYS: Array<{ key: Weekday; label: string }> = [
  { key: 'monday', label: 'Segunda' },
  { key: 'tuesday', label: 'Terça' },
  { key: 'wednesday', label: 'Quarta' },
  { key: 'thursday', label: 'Quinta' },
  { key: 'friday', label: 'Sexta' },
  { key: 'saturday', label: 'Sábado' },
  { key: 'sunday', label: 'Domingo' },
];

export const DEFAULT_BUSINESS_HOURS: BusinessHoursConfig = {
  monday: { enabled: true, windows: [['09:00', '18:00']] },
  tuesday: { enabled: true, windows: [['09:00', '18:00']] },
  wednesday: { enabled: true, windows: [['09:00', '18:00']] },
  thursday: { enabled: true, windows: [['09:00', '18:00']] },
  friday: { enabled: true, windows: [['09:00', '18:00']] },
  saturday: { enabled: false, windows: [] },
  sunday: { enabled: false, windows: [] },
};
