import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  BRIEF_TEMPLATE_DEFINITIONS,
  CUSTOM_BASE_TEMPLATE_IDS,
  getBriefTemplateDefinition,
  inferBriefTemplateFromQuestion,
  MAX_CUSTOM_TEMPLATE_INSTRUCTIONS,
  MAX_SAVED_TEMPLATE_NAME,
} from '@shared/briefTemplates';
import type { BriefTemplateId, BriefTemplateSelection, SavedBriefTemplate } from '@shared/types';
import { listBriefTemplates, saveBriefTemplate } from '../api/briefs';
import { Icon } from '../ds/Icon';
import { F, RADIUS, SPACE, TRACKING, TYPE } from '../theme/fenway';

const TEMPLATE_PICKER_META: Record<Exclude<BriefTemplateId, 'custom'>, { icon: string; hint: string }> = {
  decision_brief: { icon: 'doc', hint: 'Working thesis' },
  comparison_matrix: { icon: 'merge', hint: 'Side-by-side' },
  options_table: { icon: 'grid', hint: 'Viable paths' },
  evidence_report: { icon: 'shield', hint: 'Evidence first' },
  staff_packet: { icon: 'clipboard', hint: 'Staff asks' },
  data_table: { icon: 'pulse', hint: 'Data tables' },
};

interface BriefTemplatePickerProps {
  selected: BriefTemplateSelection;
  onChange: (selection: BriefTemplateSelection) => void;
  draftQuestion?: string;
  suggestedTemplateId?: BriefTemplateId;
  disabled?: boolean;
  align?: 'left' | 'right';
  placement?: 'above' | 'below';
}

export function BriefTemplatePicker({
  selected,
  onChange,
  draftQuestion = '',
  suggestedTemplateId,
  disabled = false,
  align = 'left',
  placement = 'above',
}: BriefTemplatePickerProps) {
  const [open, setOpen] = useState(false);
  const [savedTemplates, setSavedTemplates] = useState<SavedBriefTemplate[]>([]);
  const [savedTemplatesLoaded, setSavedTemplatesLoaded] = useState(false);
  const [loadingSaved, setLoadingSaved] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [customInstructions, setCustomInstructions] = useState(selected.instructions ?? '');
  const [customName, setCustomName] = useState('');
  const [customBaseId, setCustomBaseId] = useState<BriefTemplateId>(
    selected.template_id === 'custom' && selected.base_template_id ? selected.base_template_id : 'decision_brief',
  );
  const shellRef = useRef<HTMLDivElement>(null);

  const inferredTemplateId = suggestedTemplateId ?? inferBriefTemplateFromQuestion(draftQuestion);
  const activeDefinition = getBriefTemplateDefinition(selected.template_id === 'custom' ? 'custom' : selected.template_id);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (shellRef.current && !shellRef.current.contains(target)) setOpen(false);
    };
    window.addEventListener('mousedown', onClick);
    return () => window.removeEventListener('mousedown', onClick);
  }, [open]);

  useEffect(() => {
    if (!open || savedTemplatesLoaded) return;
    let cancelled = false;
    setLoadError(null);
    setLoadingSaved(true);
    listBriefTemplates()
      .then((response) => {
        if (!cancelled) setSavedTemplates(response.saved_templates);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : 'Could not load saved templates.');
      })
      .finally(() => {
        if (!cancelled) {
          setSavedTemplatesLoaded(true);
          setLoadingSaved(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open, savedTemplatesLoaded]);

  useEffect(() => {
    if (selected.template_id !== 'custom') return;
    setCustomInstructions(selected.instructions ?? '');
    if (selected.base_template_id) setCustomBaseId(selected.base_template_id);
  }, [selected]);

  const customCharsLeft = MAX_CUSTOM_TEMPLATE_INSTRUCTIONS - customInstructions.length;
  const canUseCustom = customInstructions.trim().length > 0 && customCharsLeft >= 0;
  const canSaveCustom = canUseCustom && customName.trim().length > 0 && customName.trim().length <= MAX_SAVED_TEMPLATE_NAME;

  const savedById = useMemo(() => new Map(savedTemplates.map((template) => [template.id, template])), [savedTemplates]);
  const savedLabel = selected.custom_template_id ? savedById.get(selected.custom_template_id)?.name : null;
  const buttonLabel = selected.template_id === 'custom'
    ? (savedLabel ?? 'Custom')
    : activeDefinition.short_label;

  const chooseTemplate = (template_id: BriefTemplateId) => {
    onChange({ template_id });
    setOpen(false);
  };

  const chooseSaved = (template: SavedBriefTemplate) => {
    onChange({
      template_id: 'custom',
      base_template_id: template.base_template_id,
      custom_template_id: template.id,
      instructions: template.instructions,
    });
    setOpen(false);
  };

  const useCustom = () => {
    if (!canUseCustom) return;
    onChange({
      template_id: 'custom',
      base_template_id: customBaseId,
      instructions: customInstructions.trim(),
    });
    setOpen(false);
  };

  const saveCustom = async () => {
    if (!canSaveCustom || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      const saved = await saveBriefTemplate({
        name: customName.trim(),
        base_template_id: customBaseId,
        instructions: customInstructions.trim(),
      });
      setLoadError(null);
      setSavedTemplatesLoaded(true);
      setSavedTemplates((current) => [saved, ...current.filter((template) => template.id !== saved.id)]);
      setCustomName('');
      chooseSaved(saved);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Could not save template.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div ref={shellRef} style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', minWidth: 0 }}>
      <button
        type="button"
        disabled={disabled}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((value) => !value);
        }}
        title={`Answer template: ${activeDefinition.label}`}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: SPACE.xs + 2,
          minHeight: 28,
          maxWidth: 220,
          padding: `${SPACE.xs}px ${SPACE.sm + 2}px`,
          border: `1px solid ${open ? F.fenway : F.border}`,
          borderRadius: RADIUS.pill,
          background: selected.template_id === inferredTemplateId ? F.surface : F.fenwaySoft,
          color: F.ink,
          fontFamily: 'var(--font-sans)',
          fontSize: TYPE.body.sm,
          fontWeight: 600,
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.55 : 1,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
        }}
      >
        <Icon name="grid" size={12} color={F.fenway} />
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{buttonLabel}</span>
        <span style={{ fontFamily: 'var(--font-mono)', color: F.fgMuted, fontSize: TYPE.meta.xs }}>⌄</span>
      </button>

      {open && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'absolute',
            zIndex: 70,
            ...(placement === 'above'
              ? { bottom: 'calc(100% + 8px)' }
              : { top: 'calc(100% + 8px)' }),
            [align]: 0,
            width: 380,
            maxWidth: 'min(92vw, 380px)',
            maxHeight: 'min(50vh, 360px)',
            overflowY: 'auto',
            background: F.surface,
            border: `1px solid ${F.borderStrong}`,
            borderRadius: RADIUS.md,
            boxShadow: F.shadowPop,
            padding: SPACE.sm,
          }}
        >
          <div style={{
            display: 'flex',
            alignItems: 'baseline',
            gap: SPACE.sm,
            padding: `${SPACE.xs}px ${SPACE.xs}px ${SPACE.xs + 2}px`,
            borderBottom: `1px solid ${F.border}`,
          }}>
            <div style={{
              fontFamily: 'var(--font-mono)',
              fontSize: TYPE.meta.xs,
              color: F.fgMuted,
              fontWeight: 700,
              letterSpacing: TRACKING.micro,
              textTransform: 'uppercase',
            }}>Answer template</div>
          </div>

          <div style={{ display: 'grid', gap: SPACE.xs, padding: `${SPACE.sm}px 0` }}>
            {BRIEF_TEMPLATE_DEFINITIONS.filter((template) => template.id !== 'custom').map((template) => {
              const active = selected.template_id === template.id;
              const suggested = inferredTemplateId === template.id;
              const meta = TEMPLATE_PICKER_META[template.id as Exclude<BriefTemplateId, 'custom'>];
              return (
                <button
                  key={template.id}
                  type="button"
                  onClick={() => chooseTemplate(template.id)}
                  style={templateRowStyle(active)}
                >
                  <span style={templateIconStyle(active)}>
                    <Icon name={meta.icon} size={14} color={active ? F.fenway : F.fgMuted} />
                  </span>
                  <span style={{ minWidth: 0, display: 'grid', gap: 1 }}>
                    <span style={{ fontFamily: 'var(--font-sans)', fontSize: TYPE.body.sm, color: F.ink, fontWeight: 750, lineHeight: 1.2 }}>
                      {template.label}
                    </span>
                    <span style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: TYPE.meta.xs,
                      color: F.fgMuted,
                      letterSpacing: TRACKING.micro,
                      textTransform: 'uppercase',
                      lineHeight: 1.2,
                    }}>{meta.hint}</span>
                  </span>
                  {suggested && <span style={tagStyle}>Suggested</span>}
                </button>
              );
            })}
          </div>

          {(savedTemplates.length > 0 || loadingSaved || loadError) && (
            <div style={{ borderTop: `1px solid ${F.border}`, paddingTop: SPACE.sm, display: 'grid', gap: SPACE.xs }}>
              <SectionLabel>Saved custom</SectionLabel>
              {loadingSaved && <div style={mutedStyle}>Loading saved templates...</div>}
              {!loadingSaved && loadError && <div style={{ ...mutedStyle, color: F.red }}>Could not load saved templates.</div>}
              {savedTemplates.map((template) => (
                <button key={template.id} type="button" onClick={() => chooseSaved(template)} style={templateRowStyle(selected.custom_template_id === template.id)}>
                  <span style={templateIconStyle(selected.custom_template_id === template.id)}>
                    <Icon name="edit" size={14} color={selected.custom_template_id === template.id ? F.fenway : F.fgMuted} />
                  </span>
                  <span style={{ fontFamily: 'var(--font-sans)', fontSize: TYPE.body.sm, color: F.ink, fontWeight: 700 }}>{template.name}</span>
                  <span style={{ fontFamily: 'var(--font-sans)', fontSize: TYPE.meta.md, color: F.fgMuted }}>
                    {getBriefTemplateDefinition(template.base_template_id).short_label}
                  </span>
                </button>
              ))}
            </div>
          )}

          <div style={{ borderTop: `1px solid ${F.border}`, marginTop: SPACE.sm, paddingTop: SPACE.sm, display: 'grid', gap: SPACE.xs + 2 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: SPACE.sm }}>
              <SectionLabel>Custom format</SectionLabel>
              <div style={{ flex: 1 }} />
              <select
                value={customBaseId}
                onChange={(e) => setCustomBaseId(e.target.value as BriefTemplateId)}
                style={selectStyle}
              >
                {CUSTOM_BASE_TEMPLATE_IDS.map((id) => (
                  <option key={id} value={id}>{getBriefTemplateDefinition(id).label}</option>
                ))}
              </select>
            </div>
            <textarea
              value={customInstructions}
              onChange={(e) => setCustomInstructions(e.target.value)}
              placeholder="Describe the format..."
              style={textareaStyle(customCharsLeft < 0)}
              rows={3}
            />
            <div style={{ display: 'flex', alignItems: 'center', gap: SPACE.xs }}>
              <input
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
                placeholder="Optional saved name"
                maxLength={MAX_SAVED_TEMPLATE_NAME}
                style={inputStyle}
              />
              <button type="button" onClick={() => void saveCustom()} disabled={!canSaveCustom || saving} style={smallButtonStyle(canSaveCustom && !saving)}>
                {saving ? 'Saving...' : 'Save'}
              </button>
              <button type="button" onClick={useCustom} disabled={!canUseCustom} style={smallButtonStyle(canUseCustom)}>
                Use
              </button>
            </div>
            {(customInstructions.length > 0 || saveError) && (
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                fontFamily: 'var(--font-mono)',
                fontSize: TYPE.meta.xs,
                color: customCharsLeft < 0 ? F.red : F.fgFaint,
              }}>
                <span>{customCharsLeft} chars left</span>
                {saveError && <span style={{ color: F.red, textAlign: 'right' }}>{saveError}</span>}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function SectionLabel({ children }: { children: string }) {
  return (
    <div style={{
      fontFamily: 'var(--font-mono)',
      fontSize: TYPE.meta.xs,
      color: F.fgMuted,
      fontWeight: 700,
      letterSpacing: TRACKING.micro,
      textTransform: 'uppercase',
    }}>{children}</div>
  );
}

function templateRowStyle(active: boolean): CSSProperties {
  return {
    display: 'grid',
    gridTemplateColumns: '24px minmax(0, 1fr) auto',
    alignItems: 'center',
    gap: SPACE.sm,
    width: '100%',
    minWidth: 0,
    textAlign: 'left',
    minHeight: 48,
    padding: `${SPACE.xs + 2}px ${SPACE.sm}px`,
    border: `1px solid ${active ? F.fenway : F.border}`,
    borderRadius: RADIUS.md,
    background: active ? F.fenwaySoft : F.surface,
    cursor: 'pointer',
  };
}

function templateIconStyle(active: boolean): CSSProperties {
  return {
    width: 24,
    height: 24,
    borderRadius: RADIUS.md,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: active ? F.surface : F.cream50,
    border: `1px solid ${active ? F.fenway : F.border}`,
  };
}

const tagStyle: CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: TYPE.meta.xs,
  color: F.fenway,
  background: F.fenwaySoft,
  border: `1px solid ${F.fenway}`,
  borderRadius: RADIUS.pill,
  padding: `1px ${SPACE.xs}px`,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: TRACKING.micro,
  flexShrink: 0,
};

const mutedStyle: CSSProperties = {
  fontFamily: 'var(--font-sans)',
  fontSize: TYPE.meta.md,
  color: F.fgMuted,
};

const selectStyle: CSSProperties = {
  width: 164,
  minWidth: 0,
  border: `1px solid ${F.border}`,
  borderRadius: RADIUS.md,
  background: F.surface,
  color: F.ink,
  padding: `${SPACE.xs}px ${SPACE.sm}px`,
  fontFamily: 'var(--font-sans)',
  fontSize: TYPE.meta.md,
};

function textareaStyle(error: boolean): CSSProperties {
  return {
    width: '100%',
    boxSizing: 'border-box',
    resize: 'vertical',
    minHeight: 74,
    maxHeight: 150,
    border: `1px solid ${error ? F.red : F.border}`,
    borderRadius: RADIUS.md,
    padding: SPACE.sm,
    fontFamily: 'var(--font-sans)',
    fontSize: TYPE.body.sm,
    color: F.ink,
    lineHeight: 1.45,
  };
}

const inputStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
  border: `1px solid ${F.border}`,
  borderRadius: RADIUS.md,
  padding: `${SPACE.xs}px ${SPACE.sm}px`,
  fontFamily: 'var(--font-sans)',
  fontSize: TYPE.body.sm,
  color: F.ink,
};

function smallButtonStyle(enabled: boolean): CSSProperties {
  return {
    padding: `${SPACE.xs}px ${SPACE.sm}px`,
    border: `1px solid ${enabled ? F.fenway : F.border}`,
    borderRadius: RADIUS.md,
    background: enabled ? F.fenway : F.cream50,
    color: enabled ? F.surface : F.fgMuted,
    fontFamily: 'var(--font-sans)',
    fontSize: TYPE.body.sm,
    fontWeight: 700,
    cursor: enabled ? 'pointer' : 'not-allowed',
    whiteSpace: 'nowrap',
  };
}
