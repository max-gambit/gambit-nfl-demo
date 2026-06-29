import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type {
  ContextGraphPreferenceVocab,
  ListContextGraphPreferencesResponse,
  TeamContextPreferencePatch,
  TeamContextPreferences,
  TeamContextPreferenceValues,
} from '@shared/types';
import {
  listContextGraphPreferences,
  resetContextGraphPreferences,
  updateContextGraphPreferences,
} from '../api/contextGraph';
import { Icon } from '../ds/Icon';
import { useToasts } from '../store';
import { F, RADIUS, SPACE, TRACKING, TYPE } from '../theme/fenway';

type DraftPath = readonly (string | number)[];
type ContextSectionId = 'ownership' | 'strategic' | 'trade' | 'culture' | 'priorities' | 'relationships';

const EMPTY_VOCAB: ContextGraphPreferenceVocab = {
  team_ids: [],
  spending_posture: [],
  timeframe: [],
  confidence: [],
  priority_type: [],
  priority_timeline: [],
  stability: [],
  player_friendly: [],
  analytics_orientation: [],
  risk_tolerance: [],
  rivalry_type: [],
  seller_posture: [],
};

interface ContextGraphSettingsProps {
  initialTeamId?: string;
  teamId?: string;
  embedded?: boolean;
}

export function ContextGraphSettings({ initialTeamId = 'NYG', teamId, embedded = false }: ContextGraphSettingsProps) {
  const requestedTeamId = (teamId ?? initialTeamId).toUpperCase();
  const [data, setData] = useState<ListContextGraphPreferencesResponse | null>(null);
  const [selectedTeamId, setSelectedTeamId] = useState<string>(requestedTeamId);
  const [draft, setDraft] = useState<TeamContextPreferenceValues | null>(null);
  const [query, setQuery] = useState('');
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { pushToast } = useToasts();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    listContextGraphPreferences()
      .then((res) => {
        if (cancelled) return;
        setData(res);
        const hasRequestedTeam = res.teams.some((team) => team.team_id === requestedTeamId);
        setSelectedTeamId(hasRequestedTeam ? requestedTeamId : res.teams[0]?.team_id ?? '');
        setError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [requestedTeamId]);

  const selectedTeam = useMemo(
    () => data?.teams.find((team) => team.team_id === selectedTeamId) ?? data?.teams[0] ?? null,
    [data, selectedTeamId],
  );

  useEffect(() => {
    setDraft(selectedTeam ? clone(selectedTeam.preferences) : null);
    setEditingKey(null);
    setHoveredKey(null);
  }, [selectedTeam?.team_id, selectedTeam?.override_updated_at]);

  useEffect(() => {
    if (!editingKey) return undefined;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest('[data-context-edit-scope="true"]')) return;
      setEditingKey(null);
      setHoveredKey(null);
    };
    document.addEventListener('pointerdown', handlePointerDown, true);
    return () => document.removeEventListener('pointerdown', handlePointerDown, true);
  }, [editingKey]);

  const filteredTeams = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const teams = data?.teams ?? [];
    if (!needle) return teams;
    return teams.filter((team) => (
      team.team_id.toLowerCase().includes(needle)
      || team.name.toLowerCase().includes(needle)
      || team.conference.toLowerCase().includes(needle)
      || team.division.toLowerCase().includes(needle)
    ));
  }, [data?.teams, query]);

  const dirty = !!selectedTeam && !!draft && stableJson(draft) !== stableJson(selectedTeam.preferences);
  const sourceDirty = !!selectedTeam && !!draft && stableJson(draft) !== stableJson(selectedTeam.source_preferences);
  const dirtyLeafCount = selectedTeam && draft ? countDirtyLeaves(selectedTeam.preferences, draft) : 0;

  const updateDraft = (path: DraftPath, value: unknown) => {
    setDraft((current) => {
      if (!current) return current;
      return setPath(current, path, value);
    });
  };

  const replaceTeam = (team: TeamContextPreferences) => {
    setData((current) => {
      if (!current) return current;
      return {
        ...current,
        teams: current.teams.map((candidate) => (candidate.team_id === team.team_id ? team : candidate)),
      };
    });
  };

  const save = async () => {
    if (!selectedTeam || !draft) return;
    const patch = diffValues(selectedTeam.source_preferences, draft) as TeamContextPreferencePatch | undefined;
    setSaving(true);
    try {
      const updated = patch
        ? await updateContextGraphPreferences(selectedTeam.team_id, patch)
        : await resetContextGraphPreferences(selectedTeam.team_id);
      replaceTeam(updated);
      pushToast({ tone: 'success', message: `${updated.team_id} context saved` });
      setError(null);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      setError(detail);
      pushToast({ tone: 'error', message: 'Context save failed', detail });
    } finally {
      setSaving(false);
    }
  };

  const revert = () => {
    if (!selectedTeam) return;
    setDraft(clone(selectedTeam.preferences));
    setEditingKey(null);
    setHoveredKey(null);
  };

  if (loading) {
    return (
      <div style={embedded ? embeddedSurfaceStyle : surfaceStyle}>
        <div style={centeredStyle}>Loading Intel settings...</div>
      </div>
    );
  }

  if (!data || !selectedTeam || !draft) {
    return (
      <div style={embedded ? embeddedSurfaceStyle : surfaceStyle}>
        <div style={centeredStyle}>{error ?? 'Intel preferences are unavailable.'}</div>
      </div>
    );
  }

  const vocab = data.vocab ?? EMPTY_VOCAB;
  const canRevert = dirty && !saving;
  const canSave = dirty && !saving;
  const showDirtyBar = dirty || saving;
  const sectionDirty = (section: ContextSectionId) => (
    stableJson(sectionSnapshot(selectedTeam.preferences, section)) !== stableJson(sectionSnapshot(draft, section))
  );
  const reviewedAt = draft.strategic_posture.last_reviewed;
  const editContext: InlineEditContext = {
    editingKey,
    setEditingKey,
    hoveredKey,
    setHoveredKey,
    updateDraft,
    isDirtyPath: (path) => !!selectedTeam && !!draft && stableJson(getPath(selectedTeam.preferences, path)) !== stableJson(getPath(draft, path)),
    vocab,
  };
  const editorSurfaceStyle = dirty || saving
    ? { ...(embedded ? embeddedEditorStyle : editorStyle), paddingBottom: embedded ? 112 : 120 }
    : (embedded ? embeddedEditorStyle : editorStyle);

  return (
    <div style={embedded ? embeddedSurfaceStyle : surfaceStyle}>
      {!embedded && (
        <aside style={teamRailStyle}>
          <div style={{ padding: SPACE.lg, borderBottom: `1px solid ${F.border}` }}>
            <div style={eyebrowStyle}>Intel</div>
            <div style={railTitleStyle}>Team preferences</div>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Filter teams"
              style={inputStyle}
            />
          </div>
          <div style={{ overflowY: 'auto', minHeight: 0 }}>
            {filteredTeams.map((team) => (
              <button
                key={team.team_id}
                onClick={() => setSelectedTeamId(team.team_id)}
                style={team.team_id === selectedTeam.team_id ? activeTeamButtonStyle : teamButtonStyle}
              >
                <span style={teamCodeStyle}>{team.team_id}</span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={teamNameStyle}>{team.name}</span>
                  <span style={teamMetaStyle}>{team.conference} / {team.division}</span>
                </span>
                {team.has_overrides && <span style={overrideDotStyle} title="Has local override" />}
                {team.validation.status === 'fail' && <span style={warningBadgeStyle}>{team.validation.error_count}</span>}
              </button>
            ))}
          </div>
        </aside>
      )}

      <main style={editorSurfaceStyle}>
        {!embedded && (
          <div style={editorHeaderStyle}>
            <div>
              <div style={eyebrowStyle}>Intel / team preferences</div>
              <h1 style={titleStyle}>{selectedTeam.name}</h1>
              <div style={subtleTextStyle}>
                {selectedTeam.team_id} / {selectedTeam.market_tier} / as of {selectedTeam.as_of_date}
              </div>
            </div>
          </div>
        )}

        {error && <div style={embedded ? embeddedErrorBannerStyle : errorBannerStyle}>{error}</div>}

        <div style={embedded ? embeddedContentGridStyle : contentGridStyle}>
          <div style={contextLaneGridStyle}>
            <div style={contextLaneStyle}>
              <EditableSection
                id="ownership"
                title="Ownership and posture"
                timestamp={reviewedAt}
                dirty={sectionDirty('ownership')}
                lastEditedKey={editingKey}
              >
                <OwnershipBrief ownership={draft.ownership} edit={editContext} />
              </EditableSection>

              <EditableSection
                id="strategic"
                title="Strategic posture"
                timestamp={reviewedAt}
                dirty={sectionDirty('strategic')}
                lastEditedKey={editingKey}
              >
                <StrategicBrief strategic={draft.strategic_posture} edit={editContext} />
              </EditableSection>

              <EditableSection
                id="relationships"
                title="Relationship notes"
                timestamp={reviewedAt}
                dirty={sectionDirty('relationships')}
                lastEditedKey={editingKey}
              >
                <RelationshipsBrief relationships={draft.team_team_relationships} edit={editContext} />
              </EditableSection>
            </div>

            <div style={contextLaneStyle}>
              <EditableSection
                id="trade"
                title="Trade DNA"
                timestamp={reviewedAt}
                dirty={sectionDirty('trade')}
                lastEditedKey={editingKey}
              >
                <TradeDnaBrief trade={draft.trade_dna} edit={editContext} />
              </EditableSection>

              <EditableSection
                id="culture"
                title="Cultural signals"
                timestamp={reviewedAt}
                dirty={sectionDirty('culture')}
                lastEditedKey={editingKey}
              >
                <CultureBrief cultural={draft.cultural_signals} edit={editContext} />
              </EditableSection>

              <EditableSection
                id="priorities"
                title="Priorities and narrative"
                timestamp={reviewedAt}
                dirty={sectionDirty('priorities')}
                lastEditedKey={editingKey}
              >
                <PrioritiesBrief priorities={draft.near_term_priorities} narrative={draft.narrative_summary} edit={editContext} />
              </EditableSection>
            </div>
          </div>
        </div>
        {showDirtyBar && (
          <StickyDirtyBar
            dirtyCount={dirtyLeafCount}
            saving={saving}
            canRevert={canRevert}
            canSave={canSave}
            saveLabel={sourceDirty ? 'Save overrides' : 'Clear overrides'}
            embedded={embedded}
            onRevert={revert}
            onSave={save}
          />
        )}
      </main>
    </div>
  );
}

function EditableSection({
  id,
  title,
  timestamp,
  dirty,
  lastEditedKey,
  children,
}: {
  id: ContextSectionId;
  title: string;
  timestamp?: string;
  dirty: boolean;
  lastEditedKey: string | null;
  children: React.ReactNode;
}) {
  const active = lastEditedKey?.startsWith(`${id}.`);
  return (
    <section data-testid={`context-section-${id}`} style={{ ...sectionStyle, ...(active ? activeSectionStyle : null) }}>
      <div style={sectionHeaderStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: SPACE.sm, minWidth: 0 }}>
          <h2 style={sectionTitleStyle}>{title}</h2>
          {dirty && <span style={unsavedPillStyle}>Unsaved</span>}
        </div>
        <div style={sectionActionsStyle}>
          {timestamp && <span style={sectionTimestampStyle}>Reviewed {timestamp}</span>}
        </div>
      </div>
      <div style={readSectionBodyStyle}>{children}</div>
    </section>
  );
}

function StickyDirtyBar({
  dirtyCount,
  saving,
  canRevert,
  canSave,
  saveLabel,
  embedded,
  onRevert,
  onSave,
}: {
  dirtyCount: number;
  saving: boolean;
  canRevert: boolean;
  canSave: boolean;
  saveLabel: string;
  embedded: boolean;
  onRevert: () => void;
  onSave: () => void;
}) {
  const countLabel = dirtyCount === 1 ? '1 unsaved field' : `${dirtyCount} unsaved fields`;
  return (
    <div style={stickyBarShellStyle(embedded)}>
      <div style={stickyBarContentStyle}>
        <div style={stickyBarTextStyle}>{saving ? 'Saving Intel changes...' : countLabel}</div>
        <div style={actionRowStyle}>
          <button onClick={onRevert} disabled={!canRevert} style={buttonStyle(secondaryButtonStyle, !canRevert)}>Revert</button>
          <button onClick={onSave} disabled={!canSave} style={buttonStyle(primaryButtonStyle, !canSave, true)}>
            {saving ? 'Saving...' : saveLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

type InlineEditContext = {
  editingKey: string | null;
  setEditingKey: (key: string | null) => void;
  hoveredKey: string | null;
  setHoveredKey: (key: string | null) => void;
  updateDraft: (path: DraftPath, value: unknown) => void;
  isDirtyPath: (path: DraftPath) => boolean;
  vocab: ContextGraphPreferenceVocab;
};

function OwnershipBrief({
  ownership,
  edit,
}: {
  ownership: TeamContextPreferenceValues['ownership'];
  edit: InlineEditContext;
}) {
  return (
    <div style={readStackStyle}>
      <div style={fieldGridStyle}>
        <EditableValue
          label="Spending posture"
          value={ownership.spending_posture}
          displayValue={formatValueLabel(ownership.spending_posture)}
          editKey="ownership.spending_posture"
          path={['ownership', 'spending_posture']}
          edit={edit}
          options={optionsWithCurrent(edit.vocab.spending_posture, ownership.spending_posture)}
          onChange={(value) => edit.updateDraft(['ownership', 'spending_posture'], value)}
        />
        <EditableValue
          label="Recent transition"
          value={ownership.recent_transitions}
          editKey="ownership.recent_transitions"
          path={['ownership', 'recent_transitions']}
          edit={edit}
          multiline
          emptyText="No recent transition recorded"
          onChange={(value) => edit.updateDraft(['ownership', 'recent_transitions'], value)}
        />
      </div>
      <EditableValue
        label="Governance"
        value={ownership.governance_notes}
        editKey="ownership.governance_notes"
        path={['ownership', 'governance_notes']}
        edit={edit}
        multiline
        onChange={(value) => edit.updateDraft(['ownership', 'governance_notes'], value)}
      />
      <EditableList
        label="Evidence"
        values={ownership.spending_posture_evidence}
        editKey="ownership.spending_posture_evidence"
        path={['ownership', 'spending_posture_evidence']}
        edit={edit}
        supporting
        onChange={(values) => edit.updateDraft(['ownership', 'spending_posture_evidence'], values)}
      />
    </div>
  );
}

function StrategicBrief({
  strategic,
  edit,
}: {
  strategic: TeamContextPreferenceValues['strategic_posture'];
  edit: InlineEditContext;
}) {
  return (
    <div style={readStackStyle}>
      <div style={fieldGridStyle}>
        <EditableValue
          label="Timeframe"
          value={strategic.timeframe}
          displayValue={formatValueLabel(strategic.timeframe)}
          editKey="strategic.timeframe"
          path={['strategic_posture', 'timeframe']}
          edit={edit}
          options={optionsWithCurrent(edit.vocab.timeframe, strategic.timeframe)}
          onChange={(value) => edit.updateDraft(['strategic_posture', 'timeframe'], value)}
        />
        <EditableValue
          label="Confidence"
          value={strategic.confidence}
          displayValue={formatValueLabel(strategic.confidence)}
          editKey="strategic.confidence"
          path={['strategic_posture', 'confidence']}
          edit={edit}
          options={optionsWithCurrent(edit.vocab.confidence, strategic.confidence)}
          onChange={(value) => edit.updateDraft(['strategic_posture', 'confidence'], value)}
        />
      </div>
      <EditableList
        label="Derived from"
        values={strategic.derived_from}
        editKey="strategic.derived_from"
        path={['strategic_posture', 'derived_from']}
        edit={edit}
        supporting
        onChange={(values) => edit.updateDraft(['strategic_posture', 'derived_from'], values)}
      />
      <EditableList
        label="Trigger events"
        values={strategic.trigger_events}
        editKey="strategic.trigger_events"
        path={['strategic_posture', 'trigger_events']}
        edit={edit}
        supporting
        onChange={(values) => edit.updateDraft(['strategic_posture', 'trigger_events'], values)}
      />
      <ConstraintsTable rows={strategic.constraints} edit={edit} />
    </div>
  );
}

function TradeDnaBrief({
  trade,
  edit,
}: {
  trade: TeamContextPreferenceValues['trade_dna'];
  edit: InlineEditContext;
}) {
  return (
    <div style={readStackStyle}>
      <EditableValue
        label="Confidence"
        value={trade.confidence}
        displayValue={formatValueLabel(trade.confidence)}
        editKey="trade.confidence"
        path={['trade_dna', 'confidence']}
        edit={edit}
        options={optionsWithCurrent(edit.vocab.confidence, trade.confidence)}
        onChange={(value) => edit.updateDraft(['trade_dna', 'confidence'], value)}
      />
      <EditableList
        label="Frequent partners"
        values={trade.frequent_partners}
        editKey="trade.frequent_partners"
        path={['trade_dna', 'frequent_partners']}
        edit={edit}
        inline
        emptyText="No frequent partners recorded"
        onChange={(values) => edit.updateDraft(['trade_dna', 'frequent_partners'], values)}
      />
      <EditableList
        label="Preferred deal archetypes"
        values={trade.preferred_deal_archetypes}
        editKey="trade.preferred_deal_archetypes"
        path={['trade_dna', 'preferred_deal_archetypes']}
        edit={edit}
        supporting
        onChange={(values) => edit.updateDraft(['trade_dna', 'preferred_deal_archetypes'], values)}
      />
      <TradesTable rows={trade.recent_significant_trades} edit={edit} />
    </div>
  );
}

function CultureBrief({
  cultural,
  edit,
}: {
  cultural: TeamContextPreferenceValues['cultural_signals'];
  edit: InlineEditContext;
}) {
  return (
    <div style={readStackStyle}>
      <EditableValue
        label="Confidence"
        value={cultural.confidence}
        displayValue={formatValueLabel(cultural.confidence)}
        editKey="culture.confidence"
        path={['cultural_signals', 'confidence']}
        edit={edit}
        options={optionsWithCurrent(edit.vocab.confidence, cultural.confidence)}
        onChange={(value) => edit.updateDraft(['cultural_signals', 'confidence'], value)}
      />
      <SignalsTable cultural={cultural} edit={edit} />
      <EditableList
        label="Notable traits"
        values={cultural.notable_traits}
        editKey="culture.notable_traits"
        path={['cultural_signals', 'notable_traits']}
        edit={edit}
        inline
        formatter={formatValueLabel}
        parser={toCodeValue}
        onChange={(values) => edit.updateDraft(['cultural_signals', 'notable_traits'], values)}
      />
      <EditableValue
        label="Rationale"
        value={cultural.rationale}
        editKey="culture.rationale"
        path={['cultural_signals', 'rationale']}
        edit={edit}
        multiline
        supporting
        onChange={(value) => edit.updateDraft(['cultural_signals', 'rationale'], value)}
      />
    </div>
  );
}

function PrioritiesBrief({
  priorities,
  narrative,
  edit,
}: {
  priorities: TeamContextPreferenceValues['near_term_priorities'];
  narrative: TeamContextPreferenceValues['narrative_summary'];
  edit: InlineEditContext;
}) {
  return (
    <div style={wideBriefLayoutStyle}>
      <PrioritiesTable priorities={priorities} edit={edit} />
      <EditableValue
        label="Narrative"
        value={narrative.one_paragraph}
        editKey="priorities.narrative"
        path={['narrative_summary', 'one_paragraph']}
        edit={edit}
        multiline
        supporting
        onChange={(value) => edit.updateDraft(['narrative_summary', 'one_paragraph'], value)}
      />
      <EditableList
        label="Things to watch"
        values={narrative.three_things_to_watch}
        editKey="priorities.things_to_watch"
        path={['narrative_summary', 'three_things_to_watch']}
        edit={edit}
        supporting
        onChange={(values) => edit.updateDraft(['narrative_summary', 'three_things_to_watch'], values)}
      />
    </div>
  );
}

function RelationshipsBrief({
  relationships,
  edit,
}: {
  relationships: TeamContextPreferenceValues['team_team_relationships'];
  edit: InlineEditContext;
}) {
  return (
    <div style={wideBriefLayoutStyle}>
      <RivalriesTable rows={relationships.rivalries} edit={edit} />
      <PersonnelTable rows={relationships.notable_personnel_connections} edit={edit} />
    </div>
  );
}

function EditableValue({
  label,
  value,
  displayValue,
  editKey,
  path,
  edit,
  onChange,
  options,
  multiline = false,
  supporting = false,
  emptyText = 'No value recorded',
}: {
  label: string;
  value: string;
  displayValue?: string;
  editKey: string;
  path: DraftPath;
  edit: InlineEditContext;
  onChange: (value: string) => void;
  options?: string[];
  multiline?: boolean;
  supporting?: boolean;
  emptyText?: string;
}) {
  const active = edit.editingKey === editKey;
  const dirty = edit.isDirtyPath(path);
  const visibleValue = displayValue ?? readableNone(value, emptyText);
  if (active) {
    return (
      <EditableRowFrame label={label} editKey={editKey} edit={edit} active dirty={dirty} supporting={supporting}>
        {options ? (
          <select
            autoFocus
            value={value}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') edit.setEditingKey(null);
            }}
            style={inlineInputStyle}
          >
            {options.map((option) => <option key={option} value={option}>{formatValueLabel(option)}</option>)}
          </select>
        ) : multiline ? (
          <InlineTextarea
            value={value}
            onChange={onChange}
            onEscape={() => edit.setEditingKey(null)}
            rows={3}
          />
        ) : (
          <input
            autoFocus
            value={value}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') edit.setEditingKey(null);
            }}
            style={inlineInputStyle}
          />
        )}
      </EditableRowFrame>
    );
  }
  return (
    <EditableRowFrame label={label} editKey={editKey} edit={edit} dirty={dirty} supporting={supporting}>
      <span style={multiline ? editableParagraphStyle(supporting) : fieldValueStyle(supporting)}>{visibleValue}</span>
    </EditableRowFrame>
  );
}

function EditableList({
  label,
  values,
  editKey,
  path,
  edit,
  onChange,
  inline = false,
  formatter = (value) => value,
  parser = (value) => value,
  supporting = false,
  emptyText = 'No entries recorded',
}: {
  label: string;
  values: string[];
  editKey: string;
  path: DraftPath;
  edit: InlineEditContext;
  onChange: (values: string[]) => void;
  inline?: boolean;
  formatter?: (value: string) => string;
  parser?: (value: string) => string;
  supporting?: boolean;
  emptyText?: string;
}) {
  const active = edit.editingKey === editKey;
  const dirty = edit.isDirtyPath(path);
  const cleanItems = values.filter(isMeaningfulText);
  const formattedItems = cleanItems.map(formatter);
  if (active) {
    return (
      <EditableRowFrame label={label} editKey={editKey} edit={edit} active dirty={dirty} supporting={supporting}>
        <InlineTextarea
          value={formatMultiline(values.map(formatter))}
          onChange={(value) => onChange(parseLines(value).map(parser))}
          onEscape={() => edit.setEditingKey(null)}
          rows={Math.max(3, values.length)}
        />
      </EditableRowFrame>
    );
  }
  return (
    <EditableRowFrame label={label} editKey={editKey} edit={edit} dirty={dirty} supporting={supporting}>
      {formattedItems.length === 0 ? (
        <span style={fieldValueStyle(supporting)}>{emptyText}</span>
      ) : inline ? (
        <span style={fieldValueStyle(supporting)}>{formattedItems.join(', ')}</span>
      ) : (
        <ul style={plainListStyle(supporting)}>
          {formattedItems.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}
        </ul>
      )}
    </EditableRowFrame>
  );
}

function EditableRowFrame({
  label,
  editKey,
  edit,
  active = false,
  dirty = false,
  supporting = false,
  children,
}: {
  label: string;
  editKey: string;
  edit: InlineEditContext;
  active?: boolean;
  dirty?: boolean;
  supporting?: boolean;
  children: React.ReactNode;
}) {
  const hovered = edit.hoveredKey === editKey;
  const visibleAction = active || hovered;
  const content = (
    <>
      <span style={fieldLabelStyle}>{label}</span>
      <span style={editableRowValueStyle(supporting)}>{children}</span>
      <EditIndicator visible={visibleAction} active={active} />
    </>
  );
  if (active) {
    return (
      <div
        data-context-edit-scope="true"
        style={editableRowStyle({ active, dirty, hovered, supporting })}
        onMouseEnter={() => edit.setHoveredKey(editKey)}
        onMouseLeave={() => edit.setHoveredKey(null)}
      >
        {content}
      </div>
    );
  }
  return (
    <button
      data-context-edit-scope="true"
      type="button"
      onClick={() => edit.setEditingKey(editKey)}
      onFocus={() => edit.setHoveredKey(editKey)}
      onBlur={() => edit.setHoveredKey(null)}
      onMouseEnter={() => edit.setHoveredKey(editKey)}
      onMouseLeave={() => edit.setHoveredKey(null)}
      style={editableRowStyle({ active, dirty, hovered, supporting })}
    >
      {content}
    </button>
  );
}

function EditIndicator({ visible, active }: { visible: boolean; active: boolean }) {
  return (
    <span style={editIndicatorStyle(visible, active)} aria-hidden="true">
      <Icon name="edit" size={12} />
    </span>
  );
}

function InlineTextarea({
  value,
  onChange,
  onEscape,
  rows,
}: {
  value: string;
  onChange: (value: string) => void;
  onEscape?: () => void;
  rows: number;
}) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${textarea.scrollHeight + 2}px`;
  }, [value, rows]);

  return (
    <textarea
      ref={textareaRef}
      autoFocus
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'Escape') onEscape?.();
      }}
      rows={rows}
      style={inlineTextareaStyle}
    />
  );
}

function ConstraintsTable({
  rows,
  edit,
}: {
  rows: TeamContextPreferenceValues['strategic_posture']['constraints'];
  edit: InlineEditContext;
}) {
  return (
    <TableShell label="Constraints" headers={['Reason', 'Weight', 'Detail']}>
      {rows.map((row, index) => {
        const editKey = `strategic.constraints.${index}`;
        const active = edit.editingKey === editKey;
        const dirty = edit.isDirtyPath(['strategic_posture', 'constraints', index]);
        const last = index === rows.length - 1;
        const updateRow = (next: typeof row) => edit.updateDraft(['strategic_posture', 'constraints'], replaceAt(rows, index, next));
        return (
          <tr
            key={`${row.reason_code}-${index}`}
            {...editableTableRowProps(edit, editKey, active, dirty)}
          >
            <td style={tableCellStyle(dataCellStyle, last)}>
              {active ? (
                <input value={formatValueLabel(row.reason_code)} onChange={(event) => updateRow({ ...row, reason_code: toCodeValue(event.target.value) })} style={inlineInputStyle} />
              ) : formatValueLabel(row.reason_code)}
            </td>
            <td style={tableCellStyle(dataCellStyle, last)}>
              {active ? (
                <select value={row.weight} onChange={(event) => updateRow({ ...row, weight: event.target.value })} style={inlineInputStyle}>
                  {optionsWithCurrent(edit.vocab.confidence, row.weight).map((option) => (
                    <option key={option} value={option}>{formatValueLabel(option)}</option>
                  ))}
                </select>
              ) : formatValueLabel(row.weight)}
            </td>
            <td style={tableCellStyle(dataDetailCellStyle, last)}>
              {active ? <InlineTextarea value={row.detail} onChange={(detail) => updateRow({ ...row, detail })} onEscape={() => edit.setEditingKey(null)} rows={2} /> : row.detail}
            </td>
            <TableEditCell edit={edit} editKey={editKey} active={active} last={last} />
          </tr>
        );
      })}
    </TableShell>
  );
}

function TradesTable({
  rows,
  edit,
}: {
  rows: TeamContextPreferenceValues['trade_dna']['recent_significant_trades'];
  edit: InlineEditContext;
}) {
  return (
    <TableShell label="Recent significant trades" headers={['Date', 'Summary']}>
      {rows.map((row, index) => {
        const editKey = `trade.recent_significant_trades.${index}`;
        const active = edit.editingKey === editKey;
        const dirty = edit.isDirtyPath(['trade_dna', 'recent_significant_trades', index]);
        const last = index === rows.length - 1;
        const updateRow = (next: typeof row) => edit.updateDraft(['trade_dna', 'recent_significant_trades'], replaceAt(rows, index, next));
        return (
          <tr key={`${row.date}-${index}`} {...editableTableRowProps(edit, editKey, active, dirty)}>
            <td style={tableCellStyle(dateCellStyle, last)}>{active ? <input value={row.date} onChange={(event) => updateRow({ ...row, date: event.target.value })} style={inlineInputStyle} /> : row.date || 'Date TBD'}</td>
            <td style={tableCellStyle(dataDetailCellStyle, last)}>{active ? <InlineTextarea value={row.summary} onChange={(summary) => updateRow({ ...row, summary })} onEscape={() => edit.setEditingKey(null)} rows={2} /> : row.summary}</td>
            <TableEditCell edit={edit} editKey={editKey} active={active} last={last} />
          </tr>
        );
      })}
    </TableShell>
  );
}

function SignalsTable({
  cultural,
  edit,
}: {
  cultural: TeamContextPreferenceValues['cultural_signals'];
  edit: InlineEditContext;
}) {
  const rows = [
    { label: 'Stability', path: ['cultural_signals', 'stability'] as DraftPath, signal: cultural.stability, options: edit.vocab.stability },
    { label: 'Player friendly', path: ['cultural_signals', 'player_friendly'] as DraftPath, signal: cultural.player_friendly, options: edit.vocab.player_friendly },
    { label: 'Analytics', path: ['cultural_signals', 'analytics_orientation'] as DraftPath, signal: cultural.analytics_orientation, options: edit.vocab.analytics_orientation },
    { label: 'Risk tolerance', path: ['cultural_signals', 'risk_tolerance'] as DraftPath, signal: cultural.risk_tolerance, options: edit.vocab.risk_tolerance },
  ];
  return (
    <TableShell label="Signals" headers={['Signal', 'Value', 'Detail']}>
      {rows.map((row, index) => {
        const editKey = `culture.signals.${index}`;
        const active = edit.editingKey === editKey;
        const dirty = edit.isDirtyPath(row.path);
        const last = index === rows.length - 1;
        const updateSignal = (next: { value: string; detail: string }) => edit.updateDraft(row.path, next);
        return (
          <tr key={row.label} {...editableTableRowProps(edit, editKey, active, dirty)}>
            <td style={tableCellStyle(dataCellStrongStyle, last)}>{row.label}</td>
            <td style={tableCellStyle(dataCellStyle, last)}>
              {active ? (
                <select value={row.signal.value} onChange={(event) => updateSignal({ ...row.signal, value: event.target.value })} style={inlineInputStyle}>
                  {optionsWithCurrent(row.options, row.signal.value).map((option) => (
                    <option key={option} value={option}>{formatValueLabel(option)}</option>
                  ))}
                </select>
              ) : formatValueLabel(row.signal.value)}
            </td>
            <td style={tableCellStyle(dataDetailCellStyle, last)}>{active ? <InlineTextarea value={row.signal.detail} onChange={(detail) => updateSignal({ ...row.signal, detail })} onEscape={() => edit.setEditingKey(null)} rows={2} /> : row.signal.detail}</td>
            <TableEditCell edit={edit} editKey={editKey} active={active} last={last} />
          </tr>
        );
      })}
    </TableShell>
  );
}

function PrioritiesTable({
  priorities,
  edit,
}: {
  priorities: TeamContextPreferenceValues['near_term_priorities'];
  edit: InlineEditContext;
}) {
  return (
    <TableShell label="Near-term priorities" headers={['Priority', 'Timeline', 'Type', 'Confidence', 'Detail']}>
      {priorities.map((row, index) => {
        const editKey = `priorities.rows.${index}`;
        const active = edit.editingKey === editKey;
        const dirty = edit.isDirtyPath(['near_term_priorities', index]);
        const last = index === priorities.length - 1;
        const updateRow = (next: typeof row) => edit.updateDraft(['near_term_priorities'], replaceAt(priorities, index, next));
        return (
          <tr key={`${row.priority}-${index}`} {...editableTableRowProps(edit, editKey, active, dirty)}>
            <td style={tableCellStyle(dataCellStrongStyle, last)}>{active ? <input value={row.priority} onChange={(event) => updateRow({ ...row, priority: event.target.value })} style={inlineInputStyle} /> : row.priority}</td>
            <td style={tableCellStyle(dataCellStyle, last)}>{active ? <SelectCell value={row.timeline} options={edit.vocab.priority_timeline} onChange={(timeline) => updateRow({ ...row, timeline })} /> : formatValueLabel(row.timeline)}</td>
            <td style={tableCellStyle(dataCellStyle, last)}>{active ? <SelectCell value={row.type} options={edit.vocab.priority_type} onChange={(type) => updateRow({ ...row, type })} /> : formatValueLabel(row.type)}</td>
            <td style={tableCellStyle(dataCellStyle, last)}>{active ? <SelectCell value={row.confidence} options={edit.vocab.confidence} onChange={(confidence) => updateRow({ ...row, confidence })} /> : formatValueLabel(row.confidence)}</td>
            <td style={tableCellStyle(dataDetailCellStyle, last)}>{active ? <InlineTextarea value={row.detail} onChange={(detail) => updateRow({ ...row, detail })} onEscape={() => edit.setEditingKey(null)} rows={2} /> : row.detail}</td>
            <TableEditCell edit={edit} editKey={editKey} active={active} last={last} />
          </tr>
        );
      })}
    </TableShell>
  );
}

function RivalriesTable({
  rows,
  edit,
}: {
  rows: TeamContextPreferenceValues['team_team_relationships']['rivalries'];
  edit: InlineEditContext;
}) {
  return (
    <TableShell label="Rivalries" headers={['Team', 'Type', 'Basis']}>
      {rows.map((row, index) => {
        const editKey = `relationships.rivalries.${index}`;
        const active = edit.editingKey === editKey;
        const dirty = edit.isDirtyPath(['team_team_relationships', 'rivalries', index]);
        const last = index === rows.length - 1;
        const updateRow = (next: typeof row) => edit.updateDraft(['team_team_relationships', 'rivalries'], replaceAt(rows, index, next));
        return (
          <tr key={`${row.team_id}-${index}`} {...editableTableRowProps(edit, editKey, active, dirty)}>
            <td style={tableCellStyle(dataCellStrongStyle, last)}>{active ? <input value={row.team_id} onChange={(event) => updateRow({ ...row, team_id: event.target.value.toUpperCase() })} style={inlineInputStyle} /> : row.team_id}</td>
            <td style={tableCellStyle(dataCellStyle, last)}>{active ? <SelectCell value={row.type} options={edit.vocab.rivalry_type} onChange={(type) => updateRow({ ...row, type })} /> : formatValueLabel(row.type)}</td>
            <td style={tableCellStyle(dataDetailCellStyle, last)}>{active ? <InlineTextarea value={row.basis} onChange={(basis) => updateRow({ ...row, basis })} onEscape={() => edit.setEditingKey(null)} rows={2} /> : row.basis}</td>
            <TableEditCell edit={edit} editKey={editKey} active={active} last={last} />
          </tr>
        );
      })}
    </TableShell>
  );
}

function PersonnelTable({
  rows,
  edit,
}: {
  rows: TeamContextPreferenceValues['team_team_relationships']['notable_personnel_connections'];
  edit: InlineEditContext;
}) {
  return (
    <TableShell label="Personnel connections" headers={['Person', 'Team', 'Connection', 'Detail']}>
      {rows.map((row, index) => {
        const editKey = `relationships.personnel.${index}`;
        const active = edit.editingKey === editKey;
        const dirty = edit.isDirtyPath(['team_team_relationships', 'notable_personnel_connections', index]);
        const last = index === rows.length - 1;
        const updateRow = (next: typeof row) => edit.updateDraft(['team_team_relationships', 'notable_personnel_connections'], replaceAt(rows, index, next));
        return (
          <tr key={`${row.person}-${row.connected_team}-${index}`} {...editableTableRowProps(edit, editKey, active, dirty)}>
            <td style={tableCellStyle(dataCellStrongStyle, last)}>{active ? <input value={row.person} onChange={(event) => updateRow({ ...row, person: event.target.value })} style={inlineInputStyle} /> : row.person}</td>
            <td style={tableCellStyle(dataCellStyle, last)}>{active ? <SelectCell value={row.connected_team} options={edit.vocab.team_ids} onChange={(connected_team) => updateRow({ ...row, connected_team })} /> : row.connected_team}</td>
            <td style={tableCellStyle(dataCellStyle, last)}>{active ? <input value={formatValueLabel(row.connection_type)} onChange={(event) => updateRow({ ...row, connection_type: toCodeValue(event.target.value) })} style={inlineInputStyle} /> : formatValueLabel(row.connection_type)}</td>
            <td style={tableCellStyle(dataDetailCellStyle, last)}>{active ? <InlineTextarea value={row.detail} onChange={(detail) => updateRow({ ...row, detail })} onEscape={() => edit.setEditingKey(null)} rows={2} /> : row.detail}</td>
            <TableEditCell edit={edit} editKey={editKey} active={active} last={last} />
          </tr>
        );
      })}
    </TableShell>
  );
}

function SelectCell({
  value,
  options,
  onChange,
}: {
  value: string;
  options: string[];
  onChange: (value: string) => void;
}) {
  return (
    <select value={value} onChange={(event) => onChange(event.target.value)} style={inlineInputStyle}>
      {optionsWithCurrent(options, value).map((option) => <option key={option} value={option}>{formatValueLabel(option)}</option>)}
    </select>
  );
}

function TableShell({
  label,
  headers,
  children,
}: {
  label: string;
  headers: string[];
  children: React.ReactNode;
}) {
  return (
    <div style={tableBlockStyle}>
      <div style={fieldLabelStyle}>{label}</div>
      <div style={tableScrollStyle}>
        <table style={dataTableStyle}>
          <thead>
            <tr>
              {headers.map((header) => <th key={header} style={dataHeaderCellStyle}>{header}</th>)}
              <th style={dataActionHeaderCellStyle} aria-label="Edit" />
            </tr>
          </thead>
          <tbody>{children}</tbody>
        </table>
      </div>
    </div>
  );
}

function TableEditCell({
  edit,
  editKey,
  active,
  last,
}: {
  edit: InlineEditContext;
  editKey: string;
  active: boolean;
  last: boolean;
}) {
  const hovered = edit.hoveredKey === editKey;
  return (
    <td style={tableCellStyle(dataActionCellStyle, last)}>
      <EditIndicator visible={active || hovered} active={active} />
    </td>
  );
}

function editableTableRowProps(
  edit: InlineEditContext,
  editKey: string,
  active: boolean,
  dirty: boolean,
): React.HTMLAttributes<HTMLTableRowElement> & { 'data-context-edit-scope': string } {
  const hovered = edit.hoveredKey === editKey;
  return {
    'data-context-edit-scope': 'true',
    tabIndex: 0,
    style: tableRowStyle({ active, dirty, hovered }),
    onClick: () => edit.setEditingKey(editKey),
    onFocus: () => edit.setHoveredKey(editKey),
    onBlur: () => edit.setHoveredKey(null),
    onMouseEnter: () => edit.setHoveredKey(editKey),
    onMouseLeave: () => edit.setHoveredKey(null),
    onKeyDown: (event) => {
      const target = event.target as HTMLElement;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        edit.setEditingKey(editKey);
      }
      if (event.key === 'Escape') edit.setEditingKey(null);
    },
  };
}

function replaceAt<T>(rows: T[], index: number, next: T): T[] {
  return rows.map((row, rowIndex) => (rowIndex === index ? next : row));
}

function tableCellStyle(style: React.CSSProperties, lastRow: boolean): React.CSSProperties {
  return lastRow ? { ...style, borderBottom: 'none' } : style;
}

function formatMultiline(values: string[]): string {
  return values.join('\n\n');
}

function formatValueLabel(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (!trimmed.includes('_') && !/^[a-z]+$/.test(trimmed)) return trimmed;
  return trimmed
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function toCodeValue(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function parseLines(value: string): string[] {
  return value.split('\n').map((line) => line.trim()).filter(Boolean);
}

function optionsWithCurrent(options: string[], current: string): string[] {
  return options.includes(current) || !current ? options : [current, ...options];
}

function sectionSnapshot(values: TeamContextPreferenceValues, section: ContextSectionId): unknown {
  switch (section) {
    case 'ownership':
      return values.ownership;
    case 'strategic':
      return values.strategic_posture;
    case 'trade':
      return values.trade_dna;
    case 'culture':
      return values.cultural_signals;
    case 'priorities':
      return {
        near_term_priorities: values.near_term_priorities,
        narrative_summary: values.narrative_summary,
      };
    case 'relationships':
      return values.team_team_relationships;
    default:
      return values;
  }
}

function countDirtyLeaves(source: unknown, effective: unknown): number {
  if (stableJson(source) === stableJson(effective)) return 0;
  if (Array.isArray(source) && Array.isArray(effective)) {
    const length = Math.max(source.length, effective.length);
    let count = 0;
    for (let index = 0; index < length; index += 1) {
      count += countDirtyLeaves(source[index], effective[index]);
    }
    return count || 1;
  }
  if (isRecord(source) && isRecord(effective)) {
    const keys = new Set([...Object.keys(source), ...Object.keys(effective)]);
    let count = 0;
    keys.forEach((key) => {
      count += countDirtyLeaves(source[key], effective[key]);
    });
    return count || 1;
  }
  return 1;
}

function getPath(value: unknown, path: DraftPath): unknown {
  return path.reduce<unknown>((cursor, key) => {
    if (cursor == null) return undefined;
    if (Array.isArray(cursor) && typeof key === 'number') return cursor[key];
    if (isRecord(cursor)) return cursor[String(key)];
    return undefined;
  }, value);
}

function isMeaningfulText(value: string | null | undefined): value is string {
  const trimmed = value?.trim().toLowerCase();
  return !!trimmed && trimmed !== 'none' && trimmed !== 'n/a';
}

function readableNone(value: string, emptyText = 'No value recorded'): string {
  return isMeaningfulText(value) ? value : emptyText;
}

function diffValues(source: unknown, effective: unknown): unknown {
  if (stableJson(source) === stableJson(effective)) return undefined;
  if (isRecord(source) && isRecord(effective)) {
    const diff: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(effective)) {
      const child = diffValues(source[key], value);
      if (child !== undefined) diff[key] = child;
    }
    return Object.keys(diff).length > 0 ? diff : undefined;
  }
  return clone(effective);
}

function setPath<T>(value: T, path: DraftPath, next: unknown): T {
  const root = clone(value) as Record<string, unknown>;
  let cursor: Record<string, unknown> = root;
  for (let index = 0; index < path.length - 1; index += 1) {
    const key = String(path[index]);
    if (!isRecord(cursor[key])) cursor[key] = {};
    cursor = cursor[key] as Record<string, unknown>;
  }
  cursor[String(path[path.length - 1])] = next;
  return root as T;
}

function stableJson(value: unknown): string {
  return JSON.stringify(value);
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function buttonStyle(base: React.CSSProperties, disabled: boolean, primary = false): React.CSSProperties {
  if (!disabled) return base;
  return {
    ...base,
    background: primary ? F.cream100 : F.cream50,
    border: `1px solid ${F.border}`,
    color: F.fgMuted,
    cursor: 'not-allowed',
    boxShadow: 'none',
  };
}

const surfaceStyle: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  display: 'flex',
  background: F.paper,
};

const embeddedSurfaceStyle: React.CSSProperties = {
  ...surfaceStyle,
  minHeight: '100%',
};

const centeredStyle: React.CSSProperties = {
  margin: 'auto',
  fontFamily: 'var(--font-sans)',
  fontSize: TYPE.body.md,
  color: F.fgMuted,
};

const teamRailStyle: React.CSSProperties = {
  width: 292,
  flexShrink: 0,
  borderRight: `1px solid ${F.border}`,
  background: F.paper,
  display: 'flex',
  flexDirection: 'column',
  minHeight: 0,
};

const editorStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  overflowY: 'auto',
  padding: `${SPACE['2xl']}px ${SPACE['2xl']}px ${SPACE['4xl']}px`,
};

const embeddedEditorStyle: React.CSSProperties = {
  ...editorStyle,
  overflowY: 'visible',
  padding: `${SPACE.lg}px ${SPACE.xl}px ${SPACE['4xl']}px`,
};

const editorHeaderStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'space-between',
  gap: SPACE.xl,
  maxWidth: 1180,
  margin: '0 auto',
  paddingBottom: SPACE.lg,
};

const eyebrowStyle: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: TYPE.meta.sm,
  fontWeight: 700,
  letterSpacing: TRACKING.micro,
  textTransform: 'uppercase',
  color: F.fg,
};

const railTitleStyle: React.CSSProperties = {
  marginTop: SPACE.xs,
  marginBottom: SPACE.md,
  fontFamily: 'var(--font-display)',
  fontSize: TYPE.display.md,
  fontWeight: 600,
  color: F.ink,
};

const titleStyle: React.CSSProperties = {
  margin: `${SPACE.xs}px 0 0`,
  fontFamily: 'var(--font-display)',
  fontSize: TYPE.display.lg,
  fontWeight: 600,
  color: F.ink,
  letterSpacing: TRACKING.tight,
};

const subtleTextStyle: React.CSSProperties = {
  marginTop: SPACE.xs,
  fontFamily: 'var(--font-sans)',
  fontSize: TYPE.body.md,
  color: F.fg,
};

const actionRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: SPACE.sm,
  flexWrap: 'wrap',
  justifyContent: 'flex-end',
};

function stickyBarShellStyle(embedded: boolean): React.CSSProperties {
  return {
    position: 'sticky',
    bottom: embedded ? SPACE.md : SPACE.lg,
    zIndex: 20,
    maxWidth: embedded ? 'none' : 1180,
    margin: `${SPACE.xl}px auto 0`,
  };
}

const stickyBarContentStyle: React.CSSProperties = {
  minHeight: 48,
  padding: `${SPACE.sm}px ${SPACE.md}px`,
  border: `1px solid ${F.borderStrong}`,
  borderRadius: RADIUS.md,
  background: 'rgba(255, 255, 255, 0.96)',
  boxShadow: F.shadowPop,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: SPACE.md,
  backdropFilter: 'blur(8px)',
};

const stickyBarTextStyle: React.CSSProperties = {
  fontFamily: 'var(--font-sans)',
  fontSize: TYPE.body.md,
  fontWeight: 600,
  color: F.ink,
};

const primaryButtonStyle: React.CSSProperties = {
  height: 36,
  padding: `0 ${SPACE.lg}px`,
  border: 'none',
  borderRadius: RADIUS.md,
  background: F.fenway,
  color: F.surface,
  fontFamily: 'var(--font-sans)',
  fontSize: TYPE.body.md,
  fontWeight: 600,
  cursor: 'pointer',
  boxShadow: F.shadowSoft,
};

const secondaryButtonStyle: React.CSSProperties = {
  height: 36,
  padding: `0 ${SPACE.md}px`,
  border: `1px solid ${F.borderStrong}`,
  borderRadius: RADIUS.md,
  background: F.surface,
  color: F.ink,
  fontFamily: 'var(--font-sans)',
  fontSize: TYPE.body.md,
  fontWeight: 500,
  cursor: 'pointer',
  boxShadow: F.shadowSoft,
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  height: 36,
  border: `1px solid ${F.borderStrong}`,
  borderRadius: RADIUS.md,
  background: F.surface,
  color: F.ink,
  padding: `0 ${SPACE.md}px`,
  fontFamily: 'var(--font-sans)',
  fontSize: TYPE.body.md,
  boxSizing: 'border-box',
  boxShadow: 'inset 0 1px 0 rgba(29,66,138,0.03)',
};

const textareaStyle: React.CSSProperties = {
  ...inputStyle,
  height: 'auto',
  minHeight: 88,
  padding: `${SPACE.sm}px ${SPACE.md}px`,
  resize: 'none',
  overflow: 'hidden',
  lineHeight: 1.55,
};

const teamButtonStyle: React.CSSProperties = {
  width: '100%',
  border: 'none',
  borderBottom: `1px solid ${F.border}`,
  background: 'transparent',
  padding: `${SPACE.md}px ${SPACE.lg}px`,
  display: 'flex',
  alignItems: 'center',
  gap: SPACE.md,
  cursor: 'pointer',
  textAlign: 'left',
};

const activeTeamButtonStyle: React.CSSProperties = {
  ...teamButtonStyle,
  background: F.fenwaySoft,
};

const teamCodeStyle: React.CSSProperties = {
  width: 36,
  flexShrink: 0,
  fontFamily: 'var(--font-mono)',
  fontSize: TYPE.meta.md,
  fontWeight: 700,
  color: F.fenway,
  letterSpacing: TRACKING.caps,
};

const teamNameStyle: React.CSSProperties = {
  display: 'block',
  fontFamily: 'var(--font-sans)',
  fontSize: TYPE.body.md,
  color: F.ink,
  fontWeight: 600,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

const teamMetaStyle: React.CSSProperties = {
  display: 'block',
  marginTop: 1,
  fontFamily: 'var(--font-mono)',
  fontSize: TYPE.meta.sm,
  color: F.fgMuted,
};

const warningBadgeStyle: React.CSSProperties = {
  minWidth: 22,
  height: 18,
  padding: `0 ${SPACE.xs}px`,
  borderRadius: RADIUS.sm,
  background: F.redSoft,
  color: F.red,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontFamily: 'var(--font-mono)',
  fontSize: TYPE.meta.sm,
  fontWeight: 700,
};

const overrideDotStyle: React.CSSProperties = {
  width: 8,
  height: 8,
  borderRadius: RADIUS.pill,
  background: F.fenway,
  flexShrink: 0,
};

const errorBannerStyle: React.CSSProperties = {
  maxWidth: 1180,
  margin: `0 auto ${SPACE.lg}px`,
  padding: `${SPACE.md}px ${SPACE.lg}px`,
  border: `1px solid ${F.red}`,
  borderRadius: RADIUS.md,
  background: F.redSoft,
  color: F.red,
  fontFamily: 'var(--font-sans)',
  fontSize: TYPE.body.md,
};

const embeddedErrorBannerStyle: React.CSSProperties = {
  ...errorBannerStyle,
  maxWidth: 'none',
  margin: `0 0 ${SPACE.md}px`,
};

const contentGridStyle: React.CSSProperties = {
  maxWidth: 1180,
  margin: '0 auto',
  display: 'grid',
  gap: SPACE.lg,
};

const embeddedContentGridStyle: React.CSSProperties = {
  ...contentGridStyle,
  maxWidth: 'none',
  margin: 0,
};

const contextLaneGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 420px), 1fr))',
  gap: SPACE.lg,
  alignItems: 'start',
};

const contextLaneStyle: React.CSSProperties = {
  display: 'grid',
  gap: SPACE.lg,
  alignContent: 'start',
};

const sectionStyle: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  background: F.surface,
  border: `1px solid ${F.border}`,
  borderRadius: RADIUS.md,
  padding: `${SPACE.md}px ${SPACE.lg}px ${SPACE.md}px`,
  boxShadow: 'none',
};

const activeSectionStyle: React.CSSProperties = {
  borderColor: F.borderStrong,
  boxShadow: 'inset 2px 0 0 rgba(29, 66, 138, 0.14)',
};

const sectionHeaderStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: SPACE.md,
  marginBottom: SPACE.md,
};

const sectionTitleStyle: React.CSSProperties = {
  margin: 0,
  fontFamily: 'var(--font-sans)',
  fontSize: TYPE.body.lg,
  fontWeight: 700,
  color: F.ink,
};

const sectionActionsStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'flex-end',
  gap: SPACE.sm,
  flexShrink: 0,
};

const sectionTimestampStyle: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: TYPE.meta.sm,
  color: F.fgMuted,
  letterSpacing: TRACKING.caps,
  textTransform: 'uppercase',
  whiteSpace: 'nowrap',
};

const unsavedPillStyle: React.CSSProperties = {
  flexShrink: 0,
  padding: `2px ${SPACE.xs}px`,
  borderRadius: RADIUS.sm,
  background: F.positiveSoft,
  color: F.positive,
  fontFamily: 'var(--font-mono)',
  fontSize: TYPE.meta.xs,
  fontWeight: 700,
  letterSpacing: TRACKING.micro,
  textTransform: 'uppercase',
};

const readSectionBodyStyle: React.CSSProperties = {
  display: 'grid',
  gap: 0,
};

const readStackStyle: React.CSSProperties = {
  display: 'grid',
  gap: 0,
};

const wideBriefLayoutStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr',
  gap: 0,
  alignItems: 'start',
};

const fieldGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 260px), 1fr))',
  gap: 0,
};

const fieldLabelStyle: React.CSSProperties = {
  fontFamily: 'var(--font-sans)',
  fontSize: TYPE.body.sm,
  fontWeight: 600,
  color: F.fgMuted,
  lineHeight: 1.25,
};

function editableRowValueStyle(supporting: boolean): React.CSSProperties {
  return {
    minWidth: 0,
    display: 'block',
    color: supporting ? F.inkSoft : F.ink,
  };
}

function editableRowStyle({
  active,
  dirty,
  hovered,
  supporting,
}: {
  active: boolean;
  dirty: boolean;
  hovered: boolean;
  supporting: boolean;
}): React.CSSProperties {
  return {
    width: '100%',
    minWidth: 0,
    boxSizing: 'border-box',
    display: 'grid',
    gridTemplateColumns: 'minmax(124px, 148px) minmax(0, 1fr) 22px',
    alignItems: 'start',
    gap: SPACE.md,
    padding: supporting ? `${SPACE.sm}px 0` : `${SPACE.md}px 0`,
    border: 'none',
    borderTop: `1px solid ${F.border}`,
    borderRadius: 0,
    background: active ? F.paper : hovered ? F.cream50 : 'transparent',
    color: F.ink,
    cursor: active ? 'default' : 'text',
    textAlign: 'left',
    outline: 'none',
    appearance: 'none',
    boxShadow: dirty ? `inset 2px 0 0 ${F.positive}` : 'none',
  };
}

function fieldValueStyle(supporting = false): React.CSSProperties {
  return {
    fontFamily: 'var(--font-sans)',
    fontSize: supporting ? TYPE.body.sm : TYPE.body.md,
    color: supporting ? F.inkSoft : F.ink,
    fontWeight: supporting ? 400 : 600,
    lineHeight: supporting ? 1.45 : 1.35,
  };
}

function editableParagraphStyle(supporting = false): React.CSSProperties {
  return {
    ...fieldValueStyle(supporting),
    maxWidth: supporting ? 680 : 760,
    fontWeight: 400,
    whiteSpace: 'pre-wrap',
  };
}

function plainListStyle(supporting = false): React.CSSProperties {
  return {
    margin: 0,
    paddingLeft: SPACE.md,
    display: 'grid',
    gap: SPACE.xs,
    fontFamily: 'var(--font-sans)',
    fontSize: supporting ? TYPE.body.sm : TYPE.body.md,
    color: supporting ? F.inkSoft : F.ink,
    lineHeight: supporting ? 1.45 : 1.45,
  };
}

function editIndicatorStyle(visible: boolean, active: boolean): React.CSSProperties {
  return {
    width: 22,
    height: 22,
    borderRadius: RADIUS.sm,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: active ? F.fenway : F.fgMuted,
    background: active ? F.fenwaySoft : 'transparent',
    opacity: visible ? 1 : 0,
    transition: 'opacity 120ms ease, background 120ms ease',
  };
}

const inlineInputStyle: React.CSSProperties = {
  width: '100%',
  minWidth: 120,
  height: 30,
  boxSizing: 'border-box',
  border: `1px solid ${F.borderStrong}`,
  borderRadius: RADIUS.sm,
  background: F.surface,
  color: F.ink,
  padding: `0 ${SPACE.sm}px`,
  fontFamily: 'var(--font-sans)',
  fontSize: TYPE.body.sm,
  lineHeight: 1.3,
  outline: 'none',
};

const inlineTextareaStyle: React.CSSProperties = {
  ...inlineInputStyle,
  height: 'auto',
  minHeight: 62,
  padding: `${SPACE.xs}px ${SPACE.sm}px`,
  resize: 'none',
  overflow: 'hidden',
  lineHeight: 1.45,
};

const tableBlockStyle: React.CSSProperties = {
  display: 'grid',
  gap: SPACE.xs,
  padding: `${SPACE.sm}px 0`,
};

const tableScrollStyle: React.CSSProperties = {
  width: '100%',
  overflowX: 'auto',
};

const dataTableStyle: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  tableLayout: 'auto',
  fontFamily: 'var(--font-sans)',
};

const dataHeaderCellStyle: React.CSSProperties = {
  padding: `${SPACE.xs}px ${SPACE.sm}px ${SPACE.xs}px 0`,
  borderBottom: `1px solid ${F.borderStrong}`,
  color: F.fgMuted,
  fontFamily: 'var(--font-sans)',
  fontSize: TYPE.body.sm,
  fontWeight: 600,
  textAlign: 'left',
  whiteSpace: 'nowrap',
};

const dataActionHeaderCellStyle: React.CSSProperties = {
  ...dataHeaderCellStyle,
  width: 24,
  paddingRight: 0,
};

function tableRowStyle({
  active,
  dirty,
  hovered,
}: {
  active: boolean;
  dirty: boolean;
  hovered: boolean;
}): React.CSSProperties {
  return {
    cursor: active ? 'default' : 'text',
    background: active ? F.paper : hovered ? F.cream50 : 'transparent',
    outline: 'none',
    boxShadow: dirty ? `inset 2px 0 0 ${F.positive}` : 'none',
  };
}

const dataCellStyle: React.CSSProperties = {
  padding: `${SPACE.sm}px ${SPACE.sm}px ${SPACE.sm}px 0`,
  borderBottom: `1px solid ${F.border}`,
  color: F.ink,
  fontFamily: 'var(--font-sans)',
  fontSize: TYPE.body.sm,
  lineHeight: 1.4,
  verticalAlign: 'top',
};

const dataCellStrongStyle: React.CSSProperties = {
  ...dataCellStyle,
  fontWeight: 700,
};

const dataDetailCellStyle: React.CSSProperties = {
  ...dataCellStyle,
  maxWidth: 420,
  color: F.inkSoft,
  lineHeight: 1.45,
};

const dateCellStyle: React.CSSProperties = {
  ...dataCellStyle,
  fontFamily: 'var(--font-mono)',
  fontSize: TYPE.meta.sm,
  color: F.fg,
  whiteSpace: 'nowrap',
};

const dataActionCellStyle: React.CSSProperties = {
  ...dataCellStyle,
  width: 24,
  paddingRight: 0,
  textAlign: 'right',
};
