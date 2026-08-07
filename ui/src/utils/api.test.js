import { describe, expect, it } from 'vitest';
import { createAppUrl } from './api';

describe('createAppUrl', () => {
  it('keeps app API calls under the gateway app prefix', () => {
    expect(createAppUrl('/v1/apps/coding', '/api/projects')).toBe(
      '/v1/apps/coding/api/projects',
    );
  });

  it('does not alter absolute URLs', () => {
    expect(createAppUrl('/v1/apps/coding', 'https://example.test/api')).toBe(
      'https://example.test/api',
    );
  });
});
