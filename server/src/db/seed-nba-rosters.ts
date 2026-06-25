import 'dotenv/config';
import {
  loadNbaRosterSeed,
  seedNbaRosters,
} from '../nba_rosters/seed.js';

async function main() {
  const seedPath = parseSeedPath(process.argv.slice(2));
  const seed = await loadNbaRosterSeed(seedPath ?? undefined);
  const summary = await seedNbaRosters(seed);

  console.log('✓ NBA roster reference data upsert complete');
  console.log(
    `  · snapshot=${summary.snapshot_id} as_of=${summary.as_of_date} ` +
    `${summary.team_count} teams / ${summary.entry_count} roster entries`,
  );
  console.log('  · generated sessions, briefs, chat turns, options, sources, artifacts, agents, monitors, and bookmarks were not touched');
}

function parseSeedPath(args: string[]): string | null {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--help' || arg === '-h') {
      console.log('Usage: npm run seed:nba-rosters -- [--path /absolute/path/to/rosters.json]');
      process.exit(0);
    }
    if (arg === '--path') {
      const value = args[index + 1];
      if (!value) throw new Error('--path requires a file path');
      return value;
    }
    if (arg.startsWith('--path=')) return arg.slice('--path='.length);
    if (!arg.startsWith('-')) return arg;
  }
  return null;
}

main().catch((err) => {
  console.error('✗ NBA roster reference seed failed:', err);
  process.exit(1);
});
