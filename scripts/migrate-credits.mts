// Imports each story's credits into the database as an opening adjustment,
// then removes the credits keys from stories.json. Safe to run again.
// Usage: pnpm credits:migrate
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { databasePath, openDatabase, toMicro } from '../src/credits/schema.ts';

const DEFAULT_CREDITS = 100;

interface Story {
  slug: string;
  credits?: number;
}

const storiesPath = join(process.cwd(), 'stories', 'stories.json');
const stories = JSON.parse(readFileSync(storiesPath, 'utf-8')) as Story[];

const db = openDatabase();
const createBalance = db.prepare(
  'INSERT INTO balances (owner, amount) VALUES (?, ?) ON CONFLICT DO NOTHING',
);
const insertLedger = db.prepare(
  `INSERT INTO ledger (owner, story, kind, amount, created_at)
   VALUES (?, ?, 'adjustment', ?, ?)`,
);

const imported = db
  .transaction((): string[] =>
    stories.flatMap((story) => {
      const credits = story.credits ?? DEFAULT_CREDITS;
      const amount = toMicro(credits);
      if (createBalance.run(story.slug, amount).changes === 0) {
        return [];
      }
      insertLedger.run(
        story.slug,
        story.slug,
        amount,
        new Date().toISOString(),
      );
      return [`${story.slug} (€${credits})`];
    }),
  )
  .immediate();
db.close();

const stale = stories.filter((story) => story.credits !== undefined);
for (const story of stale) {
  delete story.credits;
}
if (stale.length > 0) {
  writeFileSync(storiesPath, JSON.stringify(stories, null, 4), 'utf-8');
}

console.log(
  `Imported ${imported.length} of ${stories.length} stories into ${databasePath()}` +
    (imported.length > 0 ? `: ${imported.join(', ')}` : ''),
);
