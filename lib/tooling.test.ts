import { expect, it } from 'vitest';

// Guards the test environment prerequisites the route-handler tests rely on:
// vitest's node environment must expose the Web API globals.
it('exposes Web API globals required by route handlers', () => {
  expect(typeof Request).toBe('function');
  expect(typeof Response).toBe('function');
  expect(typeof Headers).toBe('function');
});
