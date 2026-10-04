import { v } from 'convex/values';
import { internal } from './_generated/api';
import { internalAction, internalQuery } from './_generated/server';

// Owners hear about each new subscriber by email, sent through Brevo. Without
// BREVO_API_KEY on the deployment nothing is sent and the drawer still works.

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const line = s => String(s ?? '').replace(/\s+/g, ' ').trim();
const FONT = `'Instrument Sans', -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif`;

export function subscriberEmail({ email, title, handle, count, site = 'https://bento.cat' }) {
  site = site.replace(/\/+$/, '');
  const list = line(title).slice(0, 80);
  const host = new URL(site).host;
  const page = `${host}/${handle}`;
  const link = `${site}/edit?open=subscribers`;
  const heading = `Someone joined ${list || 'your list'}`;
  const tally = count > 1 ? `That makes ${count} people on the list.` : 'They’re the first one on the list.';
  const body = `${email} left their email on ${page}. ${tally}`;
  const footer = `You get this because ${page} has a subscribe tile. Turn these notes off under Subscribers in your editor.`;
  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#F4F4F2">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F4F4F2;padding:32px 16px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#FFFFFF;border-radius:24px"><tr><td style="padding:32px;font-family:${FONT};color:#161616">
<img src="${esc(site)}/mail-cat.png" width="36" height="36" alt="bento.cat" style="display:block;border:0">
<h1 style="margin:16px 0 0;font-size:24px;line-height:30px;font-weight:600;letter-spacing:-0.02em">${esc(heading)}</h1>
<p style="margin:16px 0 0;font-size:15px;line-height:22px;color:#3A3A3A">${esc(body)}</p>
<p style="margin:16px 0 0"><a href="${esc(link)}" style="display:inline-block;background:#161616;color:#FFFFFF;text-decoration:none;font-size:15px;line-height:20px;font-weight:600;padding:10px 18px;border-radius:12px">See your subscribers</a></p>
<p style="margin:16px 0 0;padding-top:16px;border-top:1px solid #E8E8E5;font-size:13px;line-height:18px;color:#707070">${esc(footer)}</p>
</td></tr></table>
</td></tr></table>
</body></html>`;
  return {
    subject: list ? `New on ${list}: ${email}` : `New subscriber: ${email}`,
    html,
    text: `${heading}\n\n${body}\n\nSee your subscribers: ${link}\n\n${footer}\n`,
  };
}

// Everything the email needs, or null once it no longer should go out.
export const details = internalQuery({
  args: { subscriberId: v.id('subscribers') },
  handler: async (ctx, { subscriberId }) => {
    const sub = await ctx.db.get(subscriberId);
    const box = sub && await ctx.db.get(sub.boxId);
    if (!box?.ownerId || box.notifySubscribers === false) return null;
    const tile = box.tiles.find(t => t.id === sub.tileId && t.type === 'subscribe');
    const owner = await ctx.db.get(box.ownerId);
    if (!tile || !owner?.email) return null;
    const count = (await ctx.db.query('subscribers').withIndex('by_box_tile_email', q => q.eq('boxId', box._id).eq('tileId', tile.id)).take(10000)).length;
    return { to: owner.email, email: sub.email, title: tile.title ?? '', handle: box.handle, count };
  },
});

export const newSubscriber = internalAction({
  args: { subscriberId: v.id('subscribers') },
  handler: async (ctx, { subscriberId }) => {
    const key = process.env.BREVO_API_KEY;
    if (!key) return;
    const info = await ctx.runQuery(internal.notify.details, { subscriberId });
    if (!info) return;
    const { subject, html, text } = subscriberEmail({ ...info, site: process.env.SITE_URL || undefined });
    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': key, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        sender: { name: process.env.MAIL_FROM_NAME || 'bento.cat', email: process.env.MAIL_FROM || 'hello@bento.cat' },
        to: [{ email: info.to }],
        subject, htmlContent: html, textContent: text,
        headers: { 'Idempotency-Key': `subscriber-${subscriberId}` },
      }),
    });
    if (!response.ok) throw new Error(`Subscriber email returned HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`);
  },
});
