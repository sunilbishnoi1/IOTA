# React Component Rendering Loops

## Infinite Loop from Inline Callback Props
- **Root cause:** Inline arrow functions passed as props create new references on every render, triggering child's `useCallback`/`useEffect` → parent state update → re-render cycle infinitely.
- **Fix:** Wrap all callbacks in `useCallback` in the parent before passing them as props to children that use them in dependency arrays.

## Component Key Reuse Masks State Changes
- **Root cause:** Keying components solely on a constant identifier (e.g. `id='local-workspace'`) reuses instances even when underlying data changes, retaining stale state/props.
- **Fix:** Include changing state qualifiers in the key (e.g. `csId + repositoryName`) to guarantee React unmounts and remounts fresh.
