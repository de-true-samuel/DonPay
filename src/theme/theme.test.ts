import { describe, expect, it } from 'vitest';
import { normalizeThemePref, resolveFxTier, resolveTheme } from './theme';

describe('resolveTheme (Obsidian Signal)', () => {
  it('defaults to obsidian when system prefers dark or no light preference', () => {
    expect(resolveTheme('system', false)).toBe('obsidian');
    expect(resolveTheme('system', true)).toBe('daylight');
  });

  it('lets an explicit choice win over system', () => {
    expect(resolveTheme('obsidian', true)).toBe('obsidian');
    expect(resolveTheme('daylight', false)).toBe('daylight');
  });

  it('migrates legacy theme strings cleanly', () => {
    expect(normalizeThemePref('dark')).toBe('obsidian');
    expect(normalizeThemePref('light')).toBe('daylight');
    expect(normalizeThemePref(null)).toBe('obsidian');
  });
});

describe('resolveFxTier', () => {
  it('picks min when reduced motion or saveData is on in auto', () => {
    expect(resolveFxTier('auto', { reducedMotion: true, saveData: false, deviceMemory: 8, hardwareConcurrency: 8 })).toBe('min');
    expect(resolveFxTier('auto', { reducedMotion: false, saveData: true, deviceMemory: 8, hardwareConcurrency: 8 })).toBe('min');
  });

  it('picks lite on low-memory/low-core devices or when hints are missing', () => {
    expect(resolveFxTier('auto', { reducedMotion: false, saveData: false, deviceMemory: 2, hardwareConcurrency: 8 })).toBe('lite');
    expect(resolveFxTier('auto', { reducedMotion: false, saveData: false, deviceMemory: 8, hardwareConcurrency: 4 })).toBe('lite');
    expect(resolveFxTier('auto', { reducedMotion: false, saveData: false, deviceMemory: null, hardwareConcurrency: null })).toBe('lite');
  });

  it('picks full when device capabilities exceed thresholds', () => {
    expect(resolveFxTier('auto', { reducedMotion: false, saveData: false, deviceMemory: 8, hardwareConcurrency: 8 })).toBe('full');
  });
});
