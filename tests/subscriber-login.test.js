import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { editorUrl, loginUrl } from '../src/lib/login-return.js';
import { finishRedirect, withGoogle } from '../src/lib/signin.js';

const { client } = vi.hoisted(() => ({ client: {
  client: { signIn: { authenticateWithRedirect: vi.fn() } },
  handleRedirectCallback: vi.fn(),
} }));
vi.mock('../src/lib/api.js', () => ({ clerk: async () => client }));
afterEach(() => { vi.clearAllMocks(); vi.unstubAllGlobals(); });

describe('subscriber email sign-in destination', () => {
  it('survives the Google callback and returns to the subscribers drawer', async () => {
    vi.stubGlobal('location', { origin: 'https://bento.cat' });
    const login = new URL(loginUrl('subscribers'), location.origin);
    await withGoogle(login.searchParams.get('open'));
    const redirect = client.client.signIn.authenticateWithRedirect.mock.calls[0][0];
    const callback = new URL(redirect.redirectUrl);
    await finishRedirect(callback.searchParams.get('open'));
    const destination = client.handleRedirectCallback.mock.calls[0][0];
    expect(destination.signInForceRedirectUrl).toBe('/login?step=after&open=subscribers');
    expect(destination.signUpForceRedirectUrl).toBe(destination.signInForceRedirectUrl);
    expect(redirect.redirectUrlComplete).toBe(location.origin + destination.signInForceRedirectUrl);
    expect(editorUrl(new URL(destination.signInForceRedirectUrl, location.origin).searchParams.get('open'))).toBe('/edit?open=subscribers');
  });

  it.each([undefined, '//evil.example', 'https://evil.example', 'subscribers&redirect_url=https://evil.example'])('never carries an arbitrary redirect through sign-in: %s', async open => {
    vi.stubGlobal('location', { origin: 'https://bento.cat' });
    await withGoogle(open);
    await finishRedirect(open);
    expect(client.client.signIn.authenticateWithRedirect).toHaveBeenCalledWith({
      strategy: 'oauth_google', redirectUrl: 'https://bento.cat/login/callback', redirectUrlComplete: 'https://bento.cat/login?step=after',
    });
    expect(client.handleRedirectCallback.mock.calls[0][0].signInForceRedirectUrl).toBe('/login?step=after');
    expect(editorUrl(open)).toBe('/edit');
  });
});
