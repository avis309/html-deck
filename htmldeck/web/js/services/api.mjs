// JSON calls to the local HtmlDeck server (htmldeck/server.py).

// The run's session key: the printed link brings it in the address fragment (never sent to a
// server, nor in a Referer), kept in this origin's storage, which another port of 127.0.0.1
// cannot read (a cookie would go to every port), and sent with every call.
const KEY = 'htmldeck_session_key';
let key = null;
try { key = localStorage.getItem(KEY); } catch {}
const given = /^#key=([\w-]+)$/.exec(location.hash)?.[1];
if (given) {
  key = given;
  try { localStorage.setItem(KEY, given); } catch {}
  history.replaceState(history.state, '', location.pathname + location.search);
}
// EventSource cannot send headers: the watch stream takes the key in its query.
export const withKey = url => `${url}${url.includes('?') ? '&' : '?'}key=${encodeURIComponent(key || '')}`;

// fetch() itself throws only when no server answers (stopped, or the machine slept): say that in
// words an end user can act on, instead of the browser's "Failed to fetch".
export const SERVER_DOWN = 'HTML Deck is not running — start it again, then reload this page';
export async function api(url, opts = {}) {
  let res;
  const headers = { ...opts.headers, 'X-HtmlDeck-Key': key || '' };
  try { res = await fetch(url, { ...opts, headers }); } catch { const e = new Error(SERVER_DOWN); e.offline = true; throw e; }
  let data;
  try { data = await res.json(); } catch { data = { error: `HTTP ${res.status}` }; }
  if (!res.ok) { const e = new Error(data.error || `HTTP ${res.status}`); e.status = res.status; e.session = data.session === true; throw e; }
  return data;
}
export const postJSON = (url, body) => api(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
