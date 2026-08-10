export function createInteractionLock(view) {
  let locked = false;
  return {
    isLocked: () => locked,
    acquire() {
      if (locked) return false;
      locked = true;
      view.setInteractionLocked(true);
      return true;
    },
    release() {
      locked = false;
      view.setInteractionLocked(false);
    },
  };
}
