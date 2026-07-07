# React Component Rendering Loops

## Infinite Loop from Inline Callback Props
- **Root cause:** Inline arrow functions passed as props create new references on every render, triggering child's `useCallback`/`useEffect` → parent state update → re-render cycle infinitely.
- **Fix:** Wrap all callbacks in `useCallback` in the parent before passing them as props to children that use them in dependency arrays.

## Component Key Reuse Masks State Changes
- **Root cause:** Keying components solely on a constant identifier (e.g. `id='local-workspace'`) reuses instances even when underlying data changes, retaining stale state/props.
- **Fix:** Include changing state qualifiers in the key (e.g. `csId + repositoryName`) to guarantee React unmounts and remounts fresh.

## CPU Starvation from High-Frequency Socket Updates and Heavy Rendering
- **Root cause:** High-frequency socket events (like message deltas arriving every 16ms) triggering parent state updates cause full list and expensive markdown parser re-renders, starving the JS thread.
- **Fix:** Implement a throttled socket delta buffer to queue updates every 100ms, pre-parse message content on snapshot load, and wrap message list components in `React.memo`.

## Synchronous State Updates Inside State Updaters Block Main Thread
- **Root cause:** Calling state setter `setSubtaskSessions` inside the updater callback of `setMessages` queued nested synchronous updates during rendering, causing CPU starvation during streaming.
- **Fix:** Separate the handlers into independent state updates run consecutively over the batch in the SSE event handler loop.


