import { createPortal } from 'react-dom';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { MoreHorizontal } from 'lucide-react';

export function Menu({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ left: number; top?: number; bottom?: number }>({
    left: 0,
    top: 0,
  });
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (
        !ref.current?.contains(event.target as Node) &&
        !menuRef.current?.contains(event.target as Node)
      )
        setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        ref.current?.querySelector('button')?.focus();
      }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    const close = () => setOpen(false);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [open]);
  return (
    <div className="dropdown" ref={ref}>
      <button
        className="icon-button"
        aria-label={label}
        aria-expanded={open}
        onClick={() => {
          const rect = ref.current!.getBoundingClientRect();
          setPosition({
            left: Math.max(8, Math.min(rect.right - 230, window.innerWidth - 238)),
            ...(window.innerHeight - rect.bottom < 270
              ? { bottom: window.innerHeight - rect.top + 6 }
              : { top: rect.bottom + 6 }),
          });
          setOpen(!open);
        }}
      >
        <MoreHorizontal size={20} />
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            className="dropdown-content floating-menu"
            style={{
              ...position,
              position: 'fixed',
              right: 'auto',
              width: 230,
              zIndex: 50,
              maxHeight: 'min(400px, 80vh)',
              overflowY: 'auto',
            }}
            onClick={() => setOpen(false)}
          >
            {children}
          </div>,
          document.body,
        )}
    </div>
  );
}
