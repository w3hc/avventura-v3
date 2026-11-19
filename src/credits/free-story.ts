import { nonNegativeEnv } from './service-fee';

export const DEFAULT_FREE_STORY_LIMIT = 0.42;
export const DEFAULT_FREE_DAILY_LIMIT = 4.2;

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

export const freeDailyLimit = (
  value: string | undefined,
  onInvalid: (message: string) => void,
): number =>
  nonNegativeEnv(
    'FREE_DAILY_LIMIT',
    value,
    DEFAULT_FREE_DAILY_LIMIT,
    onInvalid,
  );
