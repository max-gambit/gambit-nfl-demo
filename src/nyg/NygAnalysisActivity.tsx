import { useEffect, useRef, useState } from 'react';
import { presentAnalysisActivity, type AnalysisActivity } from '@shared/nflAnalysisActivity';

export function NygAnalysisActivity({ items, live = false }: { items: AnalysisActivity[]; live?: boolean }) {
  const [open, setOpen] = useState(live);
  const feed = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const visibleItems = presentAnalysisActivity(items, live);
  useEffect(() => {
    if (open && follow.current && feed.current) feed.current.scrollTop = feed.current.scrollHeight;
  }, [items, open]);
  if (!live && !visibleItems.length) return null;
  return <section className="gc-analysis-activity" aria-label={live ? 'Live analysis' : 'Analysis summary'}>
    <button className="gc-analysis-toggle" aria-expanded={open} onClick={() => setOpen(value => !value)}>
      <span>{live ? 'Live analysis' : 'Analysis'}</span><small>{open ? 'Hide' : 'Show'}</small>
    </button>
    {open && <div className="gc-analysis-feed" ref={feed} onScroll={() => { const el = feed.current; if (el) follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40; }}>
      {visibleItems.some(item => item.kind === 'reasoning') && <p className="gc-analysis-note">Working analysis</p>}
      {visibleItems.map(item => <div key={item.id} className={`gc-analysis-entry gc-analysis-${item.kind}`} data-activity-id={item.id}>
        {item.kind === 'reasoning' ? <p>{item.text.split(/(\*\*[^*]+\*\*)/g).map((part, index) => part.startsWith('**') && part.endsWith('**') ? <strong key={index}>{part.slice(2, -2)}</strong> : part)}</p> : <p><span aria-hidden="true">{item.status === 'failed' ? '○' : item.status === 'done' ? '✓' : '·'}</span> {item.text}{item.status === 'failed' ? ' · unavailable' : ''}</p>}
      </div>)}
    </div>}
  </section>;
}
