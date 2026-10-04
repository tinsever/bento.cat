import { parseFragment } from 'parse5';

const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// The same inert HTML parser on the server and in the browser keeps notes safe
// and ensures hydration sees exactly the markup that the server rendered.
export function sanitize(html) {
  let out = '';
  const walk = node => {
    for (const child of node.childNodes || []) {
      if (child.nodeName === '#text') { out += escape(child.value); continue; }
      const tag = child.tagName;
      if (tag === 'br') { out += '<br>'; continue; }
      if (['b', 'strong', 'i', 'em'].includes(tag)) {
        const allowed = tag === 'b' || tag === 'strong' ? 'b' : 'i';
        out += `<${allowed}>`; walk(child); out += `</${allowed}>`;
      } else {
        if (['div', 'p', 'cite'].includes(tag) && out && !out.endsWith('<br>')) out += '<br>';
        walk(child);
      }
    }
  };
  walk(parseFragment(String(html || '')));
  return out.replace(/(<br>)+$/, '').replace(/<b><\/b>|<i><\/i>/g, '').trim();
}

export function htmlText(html) {
  const walk = node => (node.childNodes || []).map(child => {
    if (child.nodeName === '#text') return child.value;
    if (child.tagName === 'br') return '\n';
    return walk(child) + (['div', 'p'].includes(child.tagName) ? '\n' : '');
  }).join('');
  return walk(parseFragment(String(html || '')));
}
