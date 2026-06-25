import { Hono } from 'hono';
import { db } from '../db/client.js';
import { groupCurrentRosterRows, type CurrentRosterViewRow } from '../nba_rosters/seed.js';
import {
  buildCapSheetDetail,
  groupCapSheetSummaries,
  type CurrentCapSheetMetricRow,
  type CurrentCapSheetPlayerRowRecord,
  type CurrentCapSheetSalaryCellRow,
  type CurrentCapSheetSectionRow,
  type CurrentCapSheetViewRow,
} from '../nba_cap_sheets/seed.js';
import {
  buildPlayerStatTeamDetail,
  groupCurrentPlayerStatRows,
  type CurrentPlayerStatViewRow,
} from '../nba_player_stats/seed.js';

export const nbaRoutes = new Hono();

nbaRoutes.get('/rosters/current', async (c) => {
  const { data, error } = await db
    .from('nba_current_roster_entries')
    .select('*')
    .order('team_id', { ascending: true })
    .order('source_order', { ascending: true });

  if (error) {
    return c.json({ error: 'nba_rosters_query_failed', detail: error.message }, 500);
  }

  return c.json(groupCurrentRosterRows((data ?? []) as CurrentRosterViewRow[]));
});

nbaRoutes.get('/cap-sheets/current', async (c) => {
  const [{ data, error }, playerRows] = await Promise.all([
    db
      .from('nba_current_cap_sheets')
      .select('*')
      .order('team_id', { ascending: true }),
    db
      .from('nba_current_cap_sheet_player_rows')
      .select('id', { count: 'exact', head: true }),
  ]);

  if (error) {
    return c.json({ error: 'nba_cap_sheets_query_failed', detail: error.message }, 500);
  }
  if (playerRows.error) {
    return c.json({ error: 'nba_cap_sheet_player_count_failed', detail: playerRows.error.message }, 500);
  }

  const response = groupCapSheetSummaries((data ?? []) as CurrentCapSheetViewRow[]);
  response.totals.player_row_count = playerRows.count ?? 0;
  return c.json(response);
});

nbaRoutes.get('/player-stats/current', async (c) => {
  const { data, error } = await db
    .from('nba_current_player_stats')
    .select('*')
    .order('team_id', { ascending: true })
    .order('source_order', { ascending: true });

  if (error) {
    return c.json({ error: 'nba_player_stats_query_failed', detail: error.message }, 500);
  }

  return c.json(groupCurrentPlayerStatRows((data ?? []) as CurrentPlayerStatViewRow[]));
});

nbaRoutes.get('/player-stats/current/:teamId', async (c) => {
  const teamId = c.req.param('teamId').toUpperCase();
  const { data, error } = await db
    .from('nba_current_player_stats')
    .select('*')
    .eq('team_id', teamId)
    .order('source_order', { ascending: true });

  if (error) {
    return c.json({ error: 'nba_player_stats_team_query_failed', detail: error.message }, 500);
  }

  const rows = (data ?? []) as CurrentPlayerStatViewRow[];
  const grouped = groupCurrentPlayerStatRows(rows);
  return c.json({
    snapshot: grouped.snapshot,
    team: buildPlayerStatTeamDetail(rows),
  });
});

nbaRoutes.get('/cap-sheets/current/:teamId', async (c) => {
  const teamId = c.req.param('teamId').toUpperCase();
  const sheet = await db
    .from('nba_current_cap_sheets')
    .select('*')
    .eq('team_id', teamId)
    .maybeSingle();

  if (sheet.error) {
    return c.json({ error: 'nba_cap_sheet_query_failed', detail: sheet.error.message }, 500);
  }
  if (!sheet.data) {
    return c.json({ error: 'nba_cap_sheet_not_found', detail: `No current cap sheet for ${teamId}` }, 404);
  }

  const [metrics, playerRows, salaryCells, sections, rosterRows, playerStats] = await Promise.all([
    db
      .from('nba_current_cap_sheet_metrics')
      .select('*')
      .eq('team_id', teamId)
      .order('sort_order', { ascending: true }),
    db
      .from('nba_current_cap_sheet_player_rows')
      .select('*')
      .eq('team_id', teamId)
      .order('source_order', { ascending: true }),
    db
      .from('nba_current_cap_sheet_salary_cells')
      .select('*')
      .eq('team_id', teamId)
      .order('season', { ascending: true }),
    db
      .from('nba_current_cap_sheet_sections')
      .select('*')
      .eq('team_id', teamId)
      .order('sort_order', { ascending: true }),
    db
      .from('nba_current_roster_entries')
      .select('*')
      .eq('team_id', teamId)
      .order('source_order', { ascending: true }),
    db
      .from('nba_current_player_stats')
      .select('*')
      .eq('team_id', teamId)
      .order('source_order', { ascending: true }),
  ]);

  for (const [name, result] of [
    ['metrics', metrics],
    ['player_rows', playerRows],
    ['salary_cells', salaryCells],
    ['sections', sections],
    ['roster_rows', rosterRows],
    ['player_stats', playerStats],
  ] as const) {
    if (result.error) {
      return c.json({ error: `nba_cap_sheet_${name}_query_failed`, detail: result.error.message }, 500);
    }
  }

  const roster = groupCurrentRosterRows((rosterRows.data ?? []) as CurrentRosterViewRow[]).teams[0] ?? null;

  return c.json(buildCapSheetDetail({
    sheet: sheet.data as CurrentCapSheetViewRow,
    metrics: (metrics.data ?? []) as CurrentCapSheetMetricRow[],
    playerRows: (playerRows.data ?? []) as CurrentCapSheetPlayerRowRecord[],
    salaryCells: (salaryCells.data ?? []) as CurrentCapSheetSalaryCellRow[],
    sections: (sections.data ?? []) as CurrentCapSheetSectionRow[],
    roster,
    playerStats: (playerStats.data ?? []) as CurrentPlayerStatViewRow[],
  }));
});
