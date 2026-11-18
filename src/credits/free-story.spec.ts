import { DEFAULT_FREE_STORY_LIMIT, freeStoryLimit } from './free-story';

describe('freeStoryLimit', () => {
  it.each([
    ['2', 2],
    ['0', 0],
    ['0.5', 0.5],
  ])('should read %p as %p', (value, expected) => {
    const onInvalid = jest.fn();
    expect(freeStoryLimit(value, onInvalid)).toBe(expected);
    expect(onInvalid).not.toHaveBeenCalled();
  });

  it.each([undefined, ''])('should default %p without a warning', (value) => {
    const onInvalid = jest.fn();
    expect(freeStoryLimit(value, onInvalid)).toBe(DEFAULT_FREE_STORY_LIMIT);
    expect(onInvalid).not.toHaveBeenCalled();
  });

  it.each(['-1', 'two', 'Infinity'])(
    'should default %p with a warning',
    (value) => {
      const onInvalid = jest.fn();
      expect(freeStoryLimit(value, onInvalid)).toBe(DEFAULT_FREE_STORY_LIMIT);
      expect(onInvalid).toHaveBeenCalledWith(
        `Invalid FREE_STORY_LIMIT "${value}", using 2`,
      );
    },
  );
});
