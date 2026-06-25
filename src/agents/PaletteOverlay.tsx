import { useEffect } from 'react';
import { Palette } from './Palette';

interface PaletteOverlayProps {
  open: boolean;
  onClose: () => void;
}

export function PaletteOverlay({ open, onClose }: PaletteOverlayProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div onClick={onClose}
      style={{
        position: 'absolute', inset: 0,
        background: 'rgba(20, 16, 8, 0.32)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        paddingTop: 132,
        zIndex: 100,
        backdropFilter: 'blur(2px)',
      }}>
      <div onClick={(e) => e.stopPropagation()}>
        <Palette liveInput onClose={onClose} />
      </div>
    </div>
  );
}
