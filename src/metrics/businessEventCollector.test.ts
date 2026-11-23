import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import pg from 'pg';
import {
  businessEventsTotal,
  collectBusinessEvents,
  deRegisterBusinessEventMetrics,
  recordBusinessEventRows,
} from './businessEventCollector.js';
import { logger } from '../lib/logger.js';

describe('businessEventCollector count normalization', () => {
  const fakePool = (rows: Record<string, unknown>[]): pg.Pool =>
    ({ query: async () => ({ rows }) }) as unknown as pg.Pool;

  const getMetricValue = async (eventType: string): Promise<number | undefined> => {
    const metric = await businessEventsTotal.get();
    return metric.values.find((v) => v.labels.event_type === eventType)?.value;
  };

  beforeEach(() => {
    businessEventsTotal.reset();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    businessEventsTotal.reset();
    deRegisterBusinessEventMetrics();
  });

  it('produces the same gauge value for numeric string and finite number counts', async () => {
    await collectBusinessEvents(
      fakePool([
        { event_type: 'stream.created', count: '42' },
        { event_type: 'withdrawal.made', count: '7' },
      ]),
    );
    const stringStreamCount = await getMetricValue('stream.created');
    const stringWithdrawalCount = await getMetricValue('withdrawal.made');

    await collectBusinessEvents(
      fakePool([
        { event_type: 'stream.created', count: 42 },
        { event_type: 'withdrawal.made', count: 7 },
      ]),
    );
    const numberStreamCount = await getMetricValue('stream.created');
    const numberWithdrawalCount = await getMetricValue('withdrawal.made');

    expect(stringStreamCount).toBe(42);
    expect(numberStreamCount).toBe(42);
    expect(stringWithdrawalCount).toBe(7);
    expect(numberWithdrawalCount).toBe(7);
  });

  it('resets the gauge on empty results', async () => {
    await collectBusinessEvents(
      fakePool([{ event_type: 'stream.created', count: 5 }]),
    );
    expect(await getMetricValue('stream.created')).toBe(5);

    await collectBusinessEvents(fakePool([]));
    expect(await getMetricValue('stream.created')).toBeUndefined();
  });

  it('skips invalid and garbage counts without throwing and logs once', async () => {
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});

    expect(() =>
      recordBusinessEventRows([
        { event_type: 'stream.created', count: 'not-a-number' },
        { event_type: 'stream.created', count: '' },
        { event_type: 'stream.created', count: Number.NaN },
        { event_type: 'stream.created', count: Number.POSITIVE_INFINITY },
        { event_type: 'withdrawal.made', count: 12 },
      ]),
    ).not.toThrow();

    expect(await getMetricValue('stream.created')).toBeUndefined();
    expect(await getMetricValue('withdrawal.made')).toBe(12);
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });
});
