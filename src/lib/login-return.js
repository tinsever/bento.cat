// Only this editor destination can be carried through sign-in.
export const editorUrl = open => open === 'subscribers' ? '/edit?open=subscribers' : '/edit';
export function loginUrl(open, after = false) {
  const params = new URLSearchParams();
  if (after) params.set('step', 'after');
  if (open === 'subscribers') params.set('open', open);
  return '/login' + (params.size ? `?${params}` : '');
}
export const callbackUrl = open => '/login/callback' + (open === 'subscribers' ? '?open=subscribers' : '');
