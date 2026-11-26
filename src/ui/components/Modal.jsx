'use client';
import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { m } from 'framer-motion';
import Icon from './Icon.jsx';
import { dialogMotion, overlayMotion } from '../lib/motion.js';

/** Dialog: centered on desktop, a bottom sheet on phones (see .modal in styles.css). */
export default function Modal({ title, onClose, children, size = '' }) {
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [onClose]);

  return createPortal(
    <m.div className="overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }} {...overlayMotion}>
      <m.div className={`modal ${size}`} role="dialog" aria-modal="true" aria-label={title} {...dialogMotion}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="x" /></button>
        </div>
        <div className="modal-body">{children}</div>
      </m.div>
    </m.div>,
    document.body
  );
}
