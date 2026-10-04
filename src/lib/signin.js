import { clerk } from './api.js';
import { callbackUrl, loginUrl } from './login-return.js';

// A Clerk error turned into something a person can act on.
export function clerkMessage(err) {
  const e = err?.errors?.[0];
  const code = e?.code;
  if (code === 'form_code_incorrect') return 'That code didn’t match. Try again, or send another.';
  if (code === 'verification_expired') return 'That code expired. Send another.';
  if (code === 'form_param_format_invalid') return 'That email doesn’t look right.';
  if (code === 'too_many_requests') return 'Too many tries. Wait a minute, then go again.';
  return e?.longMessage || e?.message || err?.message || 'Something went wrong. Try again.';
}

// One field for new and returning people: try to sign in, fall back to sign-up.
export async function sendCode(email) {
  const c = await clerk();
  try {
    const si = await c.client.signIn.create({ identifier: email });
    const factor = si.supportedFirstFactors?.find(f => f.strategy === 'email_code');
    if (!factor) throw new Error('Email codes aren’t switched on for this app.');
    await si.prepareFirstFactor({ strategy: 'email_code', emailAddressId: factor.emailAddressId });
    return 'signIn';
  } catch (err) {
    if (err?.errors?.[0]?.code !== 'form_identifier_not_found') throw err;
    const su = await c.client.signUp.create({ emailAddress: email });
    await su.prepareEmailAddressVerification({ strategy: 'email_code' });
    return 'signUp';
  }
}

export async function resendCode(mode) {
  const c = await clerk();
  if (mode === 'signUp') return c.client.signUp.prepareEmailAddressVerification({ strategy: 'email_code' });
  const factor = c.client.signIn.supportedFirstFactors?.find(f => f.strategy === 'email_code');
  return c.client.signIn.prepareFirstFactor({ strategy: 'email_code', emailAddressId: factor.emailAddressId });
}

export async function verifyCode(mode, code) {
  const c = await clerk();
  const res = mode === 'signUp'
    ? await c.client.signUp.attemptEmailAddressVerification({ code })
    : await c.client.signIn.attemptFirstFactor({ strategy: 'email_code', code });
  if (res.status !== 'complete') throw new Error('Almost there, but Clerk wants one more step we don’t support yet.');
  await c.setActive({ session: res.createdSessionId });
}

export async function withGoogle(open) {
  const c = await clerk();
  await c.client.signIn.authenticateWithRedirect({
    strategy: 'oauth_google',
    redirectUrl: location.origin + callbackUrl(open),
    redirectUrlComplete: location.origin + loginUrl(open, true),
  });
}

export async function finishRedirect(open) {
  const c = await clerk();
  const destination = loginUrl(open, true);
  await c.handleRedirectCallback({
    signInFallbackRedirectUrl: destination,
    signUpFallbackRedirectUrl: destination,
    signInForceRedirectUrl: destination,
    signUpForceRedirectUrl: destination,
  });
}
