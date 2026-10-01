// Sets "credits": 100 on every story that has no credits key yet.
// Usage: pnpm credits:init
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const DEFAULT_CREDITS = 100;

interface Story {
  slug: string;
  credits?: number;
}

const storiesPath = join(process.cwd(), 'stories', 'stories.json');
const stories = JSON.parse(readFileSync(storiesPath, 'utf-8')) as Story[];

const missing = stories.filter((story) => story.credits === undefined);
for (const story of missing) {
  story.credits = DEFAULT_CREDITS;
}

if (missing.length > 0) {
  writeFileSync(storiesPath, JSON.stringify(stories, null, 4), 'utf-8');
}

console.log(
  `Set credits to ${DEFAULT_CREDITS} on ${missing.length} of ${stories.length} stories` +
    (missing.length > 0
      ? `: ${missing.map((story) => story.slug).join(', ')}`
      : ''),
);
