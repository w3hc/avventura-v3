import {
  DEFAULT_FREE_DAILY_LIMIT,
  DEFAULT_FREE_STORY_LIMIT,
  freeDailyLimit,
  freeStoryLimit,
} from './free-story';

describe.each([
  ['FREE_STORY_LIMIT', freeStoryLimit, DEFAULT_FREE_STORY_LIMIT, 0.42],
  ['FREE_DAILY_LIMIT', freeDailyLimit, DEFAULT_FREE_DAILY_LIMIT, 4.2],
])('%s', (name, read, fallback, expectedDefault) => {
  it(`should default to ${expectedDefault}`, () => {
    expect(fallback).toBe(expectedDefault);
  });

  it.each([
    ['2', 2],
    ['0', 0],
    ['0.5', 0.5],
  ])('should read %p as %p', (value, expected) => {
    const onInvalid = jest.fn();
    expect(read(value, onInvalid)).toBe(expected);
    expect(onInvalid).not.toHaveBeenCalled();
  });

  it.each([undefined, ''])('should default %p without a warning', (value) => {
    const onInvalid = jest.fn();
    expect(read(value, onInvalid)).toBe(fallback);
    expect(onInvalid).not.toHaveBeenCalled();
  });

  it.each(['-1', 'two', 'Infinity'])(
    'should default %p with a warning',
    (value) => {
      const onInvalid = jest.fn();
      expect(read(value, onInvalid)).toBe(fallback);
      expect(onInvalid).toHaveBeenCalledWith(
        `Invalid ${name} "${value}", using ${fallback}`,
      );
    },
  );
});
