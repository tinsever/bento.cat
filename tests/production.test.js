import { describe, expect, it } from 'vite-plus/test';
import { productionErrors } from '../scripts/check-production.mjs';

describe('production preflight', () => {
  it('rejects development keys and non-HTTPS configuration', () => {
    expect(productionErrors({ PUBLIC_CONVEX_URL: 'http://localhost:3210', VITE_CLERK_PUBLISHABLE_KEY: 'pk_test_fake' })).toHaveLength(3);
  });
  it('accepts hosted configuration and requires the HTTP URL for custom deployments', () => {
    const env = { PUBLIC_CONVEX_URL: 'https://app.convex.cloud', VITE_CLERK_PUBLISHABLE_KEY: 'pk_live_fake' };
    expect(productionErrors(env)).toEqual([]);
    expect(productionErrors({ ...env, PUBLIC_CONVEX_URL: 'https://convex.example.com' })).toHaveLength(1);
    expect(productionErrors({ ...env, PUBLIC_CONVEX_URL: 'https://convex.example.com', PUBLIC_CONVEX_SITE_URL: 'https://http.example.com' })).toEqual([]);
  });
});
