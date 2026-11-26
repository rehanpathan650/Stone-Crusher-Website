/**
 * Shared motion presets (Framer Motion). Short and calm: things settle into place rather than bounce.
 * MotionConfig reducedMotion="user" in App.jsx turns movement off for people who ask their device to reduce motion.
 */
export const ease = [0.22, 1, 0.36, 1];
export const spring = { type: 'spring', stiffness: 520, damping: 40, mass: 0.8 };

export const pageMotion = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.22, ease } },
};

export const menuMotion = {
  initial: { opacity: 0, y: -6, scale: 0.98 },
  animate: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.16, ease } },
  exit: { opacity: 0, y: -4, scale: 0.98, transition: { duration: 0.1 } },
  style: { transformOrigin: 'top right' },
};

export const overlayMotion = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: 0.16 } },
  exit: { opacity: 0, transition: { duration: 0.12 } },
};

export const dialogMotion = {
  initial: { opacity: 0, y: 14, scale: 0.98 },
  animate: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.22, ease } },
  exit: { opacity: 0, y: 8, scale: 0.98, transition: { duration: 0.12 } },
};

/** Parent + child pair for staggered lists (dashboard cards, rows). */
export const stagger = { animate: { transition: { staggerChildren: 0.04 } } };
export const rise = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.28, ease } },
};
