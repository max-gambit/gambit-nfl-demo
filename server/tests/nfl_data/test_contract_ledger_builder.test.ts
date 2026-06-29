import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildPublicMetricIndex, parseOtcCapYearsFromHtml, summarizeContractLedger } from '../../src/nfl_data/build_reviewed_snapshot.js';

const OTC_FIXTURE = `
  <div class="salary-cap-container" id="y2026">
    <table class="salary-cap-table contracted-players">
      <tbody>
        <tr>
          <td><a href="/player/sample-veteran/12345">Sample Veteran</a></td>
          <td>$10,000,000</td>
          <td>$2,000,000</td>
          <td>$0</td>
          <td>$500,000</td>
          <td>$0</td>
          <td>$100,000</td>
          <td>$0</td>
          <td></td>
          <td>$8,000,000</td>
          <td></td>
          <td>$12,600,000</td>
          <td></td>
          <td>
            <div class="cut">$9,000,000</div>
            <div class="june_1_cut">$4,000,000</div>
            <div class="trade">$6,000,000</div>
            <div class="june_1_trade">$3,000,000</div>
          </td>
          <td>
            <div class="cut">$3,600,000</div>
            <div class="june_1_cut">$8,600,000</div>
            <div class="trade">$6,600,000</div>
            <div class="june_1_trade">$9,600,000</div>
            <div class="restructure">$7,500,000</div>
            <div class="extension">$5,250,000</div>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
  <div class="salary-cap-container" id="y2027">
    <table class="salary-cap-table contracted-players">
      <tbody>
        <tr>
          <td><a href="/player/sample-veteran/12345">Sample Veteran</a></td>
          <td>$11,000,000</td>
          <td>$2,000,000</td>
          <td>$0</td>
          <td>$0</td>
          <td>$0</td>
          <td>$100,000</td>
          <td>$0</td>
          <td></td>
          <td>$0</td>
          <td></td>
          <td>$13,100,000</td>
          <td></td>
          <td><div class="cut">$2,000,000</div></td>
          <td><div class="cut">$11,100,000</div></td>
        </tr>
      </tbody>
    </table>
  </div>
  <div class="salary-cap-container" id="y2028">
    <table class="salary-cap-table contracted-players">
      <tbody>
        <tr>
          <td><a href="/player/sample-veteran/12345">Sample Veteran</a></td>
          <td>$0</td>
          <td>$1,500,000</td>
          <td>$0</td>
          <td>$0</td>
          <td>$0</td>
          <td>$0</td>
          <td>$0</td>
          <td></td>
          <td>$0</td>
          <td></td>
          <td>$1,500,000</td>
          <td></td>
          <td><div class="cut">$1,500,000</div></td>
          <td><div class="cut">$0</div></td>
        </tr>
      </tbody>
    </table>
  </div>
`;

test('OTC contract ledger parser captures future rows and hidden transaction values', () => {
  const rows = parseOtcCapYearsFromHtml(OTC_FIXTURE, 'https://overthecap.com/salary-cap/test');
  assert.equal(rows.length, 3);

  const current = rows.find((row) => row.season === '2026');
  assert.equal(current?.player_name, 'Sample Veteran');
  assert.equal(current?.post_june_1_dead_money_cut, 4_000_000);
  assert.equal(current?.post_june_1_cut_savings, 8_600_000);
  assert.equal(current?.trade_dead_money, 6_000_000);
  assert.equal(current?.trade_savings, 6_600_000);
  assert.equal(current?.post_june_1_trade_dead_money, 3_000_000);
  assert.equal(current?.post_june_1_trade_savings, 9_600_000);
  assert.equal(current?.restructure_savings, 7_500_000);
  assert.equal(current?.extension_savings, 5_250_000);
});

test('OTC contract ledger summarizer computes years voids value and confidence', () => {
  const rows = parseOtcCapYearsFromHtml(OTC_FIXTURE, 'https://overthecap.com/salary-cap/test');
  const summary = summarizeContractLedger(rows);

  assert.equal(summary.contract_end_year, 2027);
  assert.equal(summary.contract_years_remaining, 2);
  assert.equal(summary.void_year_count, 1);
  assert.equal(summary.void_years_source_status, 'captured');
  assert.equal(summary.total_value_remaining, 21_700_000);
  assert.equal(summary.contract_ledger_status, 'captured');
  assert.equal(summary.contract_ledger_confidence, 'captured');
  assert.equal(summary.contract_years.length, 3);
  assert.equal(summary.contract_years.some((row) => row.void_year_candidate === true), true);
});

test('public player metric parser joins snap counts and player production', () => {
  const statsCsv = [
    'player_id,player_name,player_display_name,position,season,season_type,recent_team,games,passing_yards,rushing_yards,receiving_yards,def_tackles_solo,def_tackles_with_assist,def_sacks,def_interceptions,passing_tds,rushing_tds,receiving_tds,def_tds',
    '00-TEST,Sample Defender,Sample Defender,DT,2025,REG,NYG,17,0,0,0,12,21,6.5,1,0,0,0,1',
  ].join('\n');
  const snapsCsv = [
    'game_id,pfr_game_id,season,game_type,week,player,pfr_player_id,position,team,opponent,offense_snaps,offense_pct,defense_snaps,defense_pct,st_snaps,st_pct',
    '2025_01_NYG_DAL,202509010nyg,2025,REG,1,Sample Defender,TestSa00,DT,NYG,DAL,0,0%,44,73%,2,8%',
    '2025_02_NYG_PHI,202509080nyg,2025,REG,2,Sample Defender,TestSa00,DT,NYG,PHI,0,0%,36,60%,1,4%',
  ].join('\n');

  const index = buildPublicMetricIndex(statsCsv, snapsCsv);
  const row = index.byTeamName.get('NYG:sampledefender');

  assert.ok(row);
  assert.equal(row.defense_snaps_2025, 80);
  assert.equal(row.special_teams_snaps_2025, 3);
  assert.equal(row.games_2025, 17);
  assert.equal(row.tackles_2025, 33);
  assert.equal(row.sacks_2025, 6.5);
  assert.equal(row.interceptions_2025, 1);
  assert.equal(row.touchdowns_2025, 1);
  assert.equal(row.source_families.has('nflverse_snap_counts'), true);
  assert.equal(row.source_families.has('nflverse_stats_player'), true);
});
