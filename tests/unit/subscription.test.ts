import { describe, it, expect } from 'vitest';
import {
  getPlanLimits,
  canAccessTab,
  isPlanAtLeast,
  getRequiredPlan,
} from '../../src/auth/subscription.js';

describe('getPlanLimits', () => {
  it('free plan has 5 alerts per day', () => {
    expect(getPlanLimits('free').alertsPerDay).toBe(5);
  });

  it('free plan has 50 export rows', () => {
    expect(getPlanLimits('free').exportRows).toBe(50);
  });

  it('pro plan has 100 alerts per day', () => {
    expect(getPlanLimits('pro').alertsPerDay).toBe(100);
  });
});

describe('canAccessTab', () => {
  it('free plan can access spreads tab', () => {
    expect(canAccessTab('free', 'spreads')).toBe(true);
  });

  it('free plan cannot access funding tab', () => {
    expect(canAccessTab('free', 'funding')).toBe(false);
  });

  it('pro plan can access funding tab', () => {
    expect(canAccessTab('pro', 'funding')).toBe(true);
  });

  it('free plan cannot access p2p tab', () => {
    expect(canAccessTab('free', 'p2p')).toBe(false);
  });

  it('elite plan can access p2p tab', () => {
    expect(canAccessTab('elite', 'p2p')).toBe(true);
  });
});

describe('isPlanAtLeast', () => {
  it('pro is at least free', () => {
    expect(isPlanAtLeast('pro', 'free')).toBe(true);
  });

  it('free is not at least pro', () => {
    expect(isPlanAtLeast('free', 'pro')).toBe(false);
  });

  it('elite is at least pro', () => {
    expect(isPlanAtLeast('elite', 'pro')).toBe(true);
  });

  it('ultimate is at least ultimate', () => {
    expect(isPlanAtLeast('ultimate', 'ultimate')).toBe(true);
  });
});

describe('getRequiredPlan', () => {
  it('spreads tab requires free plan', () => {
    expect(getRequiredPlan('spreads')).toBe('free');
  });

  it('funding tab requires pro plan', () => {
    expect(getRequiredPlan('funding')).toBe('pro');
  });

  it('p2p tab requires elite plan', () => {
    expect(getRequiredPlan('p2p')).toBe('elite');
  });
});
