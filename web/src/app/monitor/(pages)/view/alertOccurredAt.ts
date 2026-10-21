export const alertOccurredAtFields = ['updated_at', 'start_event_time'] as const;

export type AlertOccurredAtField = (typeof alertOccurredAtFields)[number];

export function resolveAlertOccurredAtField(field?: string | null): AlertOccurredAtField {
  return field === 'start_event_time' ? 'start_event_time' : 'updated_at';
}
