import { getReasoningSummary, formatDuration } from '../opencodeParser';

describe('getReasoningSummary', () => {
  it('returns title and body when first line is bold title', () => {
    const result = getReasoningSummary('**Title**\n\nBody text here');
    expect(result).toEqual({ title: 'Title', body: 'Body text here' });
  });

  it('returns null title when no bold header found', () => {
    const result = getReasoningSummary('Just some plain text');
    expect(result).toEqual({ title: null, body: 'Just some plain text' });
  });

  it('handles multi-word title', () => {
    const result = getReasoningSummary('**My Reasoning Title**\n\nDetailed reasoning body');
    expect(result).toEqual({ title: 'My Reasoning Title', body: 'Detailed reasoning body' });
  });

  it('strips trailing whitespace from body', () => {
    const result = getReasoningSummary('**Title**\n\nBody with spaces   ');
    expect(result).toEqual({ title: 'Title', body: 'Body with spaces' });
  });

  it('returns null title for empty string', () => {
    const result = getReasoningSummary('');
    expect(result).toEqual({ title: null, body: '' });
  });
});

describe('formatDuration', () => {
  it('formats seconds', () => {
    expect(formatDuration(12000)).toBe('12s');
    expect(formatDuration(0)).toBe('0s');
    expect(formatDuration(1000)).toBe('1s');
  });

  it('formats minutes and seconds', () => {
    expect(formatDuration(90000)).toBe('1m 30s');
    expect(formatDuration(120000)).toBe('2m');
    expect(formatDuration(61000)).toBe('1m 1s');
  });

  it('formats hours and minutes', () => {
    expect(formatDuration(7200000)).toBe('2h');
    expect(formatDuration(8100000)).toBe('2h 15m');
  });

  it('handles negative values', () => {
    expect(formatDuration(-100)).toBe('0s');
  });
});
