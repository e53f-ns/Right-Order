import { describe, it, expect } from 'vitest';
import { emptyOrderbook } from '../../src/services/orderbook-service.js';

describe('emptyOrderbook', () => {
  it('returns realtime: false', () => {
    expect(emptyOrderbook().realtime).toBe(false);
  });

  it('returns empty asks array', () => {
    expect(emptyOrderbook().asks).toEqual([]);
  });

  it('returns empty bids array', () => {
    expect(emptyOrderbook().bids).toEqual([]);
  });

  it('returns a recent timestamp', () => {
    const before = Date.now();
    const ob = emptyOrderbook();
    const after = Date.now();
    expect(ob.timestamp).toBeGreaterThanOrEqual(before);
    expect(ob.timestamp).toBeLessThanOrEqual(after);
  });

  it('has the correct shape (asks, bids, timestamp, realtime)', () => {
    const ob = emptyOrderbook();
    expect(ob).toHaveProperty('asks');
    expect(ob).toHaveProperty('bids');
    expect(ob).toHaveProperty('timestamp');
    expect(ob).toHaveProperty('realtime');
  });
});
