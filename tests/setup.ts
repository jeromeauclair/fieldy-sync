// Plugin code uses `window.setTimeout` (popout-window safe in Obsidian).
// Unit tests run in Node, where the global object plays that role.
if (typeof (globalThis as { window?: unknown }).window === 'undefined') {
	(globalThis as { window?: unknown }).window = globalThis;
}
