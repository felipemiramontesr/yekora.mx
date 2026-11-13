// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readSidebarOpen, saveSidebarOpen } from './sidebarPreference';

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('sidebar preference (FC 046 T2.3)', () => {
  it('starts folded and remembers it open until folded again', () => {
    expect(readSidebarOpen()).toBe(false);
    saveSidebarOpen(true);
    expect(readSidebarOpen()).toBe(true);
    saveSidebarOpen(false);
    expect(localStorage.getItem('yekora_account_sidebar_open_v1')).toBeNull();
    expect(readSidebarOpen()).toBe(false);
  });

  it('survives blocked storage', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(readSidebarOpen()).toBe(false);
    expect(() => saveSidebarOpen(true)).not.toThrow();
  });
});
