// Cross-module actions, filled in by main.js at startup. UI modules call these instead of
// importing main.js, which keeps the module graph free of cycles.
export const actions = {
  tune: (/* channel, opts */) => {},
  toast: (/* message, ms */) => {},
};
