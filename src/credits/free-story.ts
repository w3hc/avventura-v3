import { nonNegativeEnv } from './service-fee';

export const DEFAULT_FREE_STORY_LIMIT = 2;

export const freeStoryLimit = (
  value: string | undefined,
  onInvalid: (message: string) => void,
): number =>
  nonNegativeEnv(
    'FREE_STORY_LIMIT',
    value,
    DEFAULT_FREE_STORY_LIMIT,
    onInvalid,
  );
