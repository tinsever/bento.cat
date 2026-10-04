import { describe, expect, it } from 'vite-plus/test';
import { publicUrl } from '../convex/links.js';

describe('link preview addresses', () => {
  it('accepts ordinary public pages', () => {
    expect(publicUrl('https://example.com/a?b=1')?.hostname).toBe('example.com');
    expect(publicUrl('http://example.com.')?.hostname).toBe('example.com.');
  });
  it('refuses local names, private ranges, odd ports and credentials', () => {
    for (const url of [
      'http://localhost/', 'http://localhost./', 'http://foo.localhost../', 'http://intranet.corp./',
      'http://metadata.google.internal./', 'http://127.0.0.1/', 'http://2130706433/', 'http://0x7f.1/',
      'http://169.254.169.254./', 'http://[::1]/', 'http://10.0.0.1/', 'https://example.com:8443/',
      'https://user:pass@example.com/', 'ftp://example.com/', 'javascript:alert(1)',
    ]) expect(publicUrl(url), url).toBeNull();
  });
});
