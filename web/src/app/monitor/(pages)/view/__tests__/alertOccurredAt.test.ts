import { describe, expect, it } from 'vitest';
import { resolveAlertOccurredAtField } from '../alertOccurredAt';

describe('alert occurred at field', () => {
  it('keeps the shared table on updated_at unless start_event_time is requested', () => {
    expect(resolveAlertOccurredAtField()).toBe('updated_at');
    expect(resolveAlertOccurredAtField('updated_at')).toBe('updated_at');
    expect(resolveAlertOccurredAtField('start_event_time')).toBe('start_event_time');
    expect(resolveAlertOccurredAtField('created_at')).toBe('updated_at');
  });
});
