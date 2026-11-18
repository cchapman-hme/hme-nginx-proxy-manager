// backend/sso/pages.js
// The access-denied page nginx shows on SSO hosts instead of its bare 403
// (error_page 403 = @sso_denied → /sso/denied). Self-contained HTML: inline
// styles, no scripts, no external resources.

/** Content-Security-Policy for the page: inline styles only, no scripts. */
export const PAGE_CSP =
	"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

/**
 * Escape text for HTML element content and double-quoted attributes.
 * @param {unknown} value
 * @returns {string}
 */
export function esc(value) {
	return String(value ?? "").replace(
		/[&<>"']/g,
		(c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
	);
}

/**
 * Up to two initials for the account badge: from the display name, else the
 * email's local part. Code-point safe.
 * @param {{ name?: string, email?: string }} user
 * @returns {string}
 */
export function initials(user) {
	const name = String(user?.name || "").trim();
	const words = name ? name.split(/\s+/) : [String(user?.email || "").split("@")[0]];
	const letters = words
		.filter(Boolean)
		.slice(0, 2)
		.map((w) => Array.from(w)[0] || "");
	return letters.join("").toUpperCase() || "?";
}

/**
 * Sign-in URL that comes back to `path` on `host`, built like nginx's
 * @sso_redirect: the login must start on the host's first concrete domain
 * (the one the registered callback uses), or /sso/callback rejects the state.
 * Entra ID always shows its account picker (prompt=select_account), so this
 * is also the "use a different account" link.
 * @param {{ scheme?: string, host: string, redirectUri?: string | null, path: string }} p
 *   `path` must already be a validated relative path
 * @returns {string}
 */
export function loginUrlFor({ scheme, host, redirectUri, path }) {
	const proto = scheme === "http" ? "http" : "https";
	let loginHost = host;
	if (redirectUri) {
		try {
			loginHost = new URL(redirectUri).host;
		} catch (_err) {
			// fall back to this host
		}
	}
	// `return` must be the last parameter: /sso/login reads it raw to the end
	return `${proto}://${loginHost}/sso/login?return=${encodeURIComponent(`${proto}://${host}${path}`)}`;
}

/** "2026-11-18 15:04 UTC" */
function utcStamp(date) {
	return `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

const STYLE = `
:root{color-scheme:light dark;--bg:#f4f5f7;--card:#fff;--text:#1b1e24;--muted:#5d6471;--line:#e1e4ea;--soft:#f7f8fa;
--accent:#2457c5;--accent-hover:#1d48a6;--accent-text:#fff;--warn-bg:#fdf1e3;--warn-fg:#b25e09;--badge-bg:#e6ecf8;--badge-fg:#2457c5}
@media (prefers-color-scheme:dark){:root{--bg:#121418;--card:#1b1e24;--text:#e7e9ed;--muted:#a0a7b3;--line:#2d323b;--soft:#16191e;
--accent:#6f9bff;--accent-hover:#8daeff;--accent-text:#0c1222;--warn-bg:#3a2a16;--warn-fg:#f3b066;--badge-bg:#26324a;--badge-fg:#a9c1ff}}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:32px 16px;
background:var(--bg);color:var(--text);font:15px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",sans-serif}
main{width:100%;max-width:480px;background:var(--card);border:1px solid var(--line);border-radius:14px;
padding:32px 32px 28px;box-shadow:0 1px 2px rgba(16,24,40,.04),0 8px 24px rgba(16,24,40,.06)}
.top{display:flex;align-items:center;gap:12px;margin-bottom:20px}
.icon{flex:none;width:44px;height:44px;border-radius:12px;display:grid;place-items:center;background:var(--warn-bg);color:var(--warn-fg)}
.site{min-width:0;font-size:13px;color:var(--muted);overflow-wrap:anywhere}
.site strong{display:block;color:var(--text);font-size:14px;font-weight:600}
h1{margin:0 0 8px;font-size:21px;line-height:1.3;font-weight:650;letter-spacing:-.01em}
p{margin:0 0 12px}
.lead{color:var(--muted)}
.lead strong{color:var(--text);font-weight:600;overflow-wrap:anywhere}
.account{display:flex;align-items:center;gap:12px;margin:18px 0;padding:12px 14px;border:1px solid var(--line);border-radius:10px;background:var(--soft)}
.avatar{flex:none;width:38px;height:38px;border-radius:50%;display:grid;place-items:center;background:var(--badge-bg);color:var(--badge-fg);font-weight:650;font-size:14px}
.who{min-width:0;line-height:1.35}
.who .name{display:block;font-weight:600;overflow-wrap:anywhere}
.who .email{display:block;font-size:13px;color:var(--muted);overflow-wrap:anywhere}
h2{margin:22px 0 8px;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;color:var(--muted)}
ul.steps{margin:0;padding:0;list-style:none}
ul.steps li{position:relative;padding:0 0 10px 18px}
ul.steps li::before{content:"";position:absolute;left:2px;top:.62em;width:6px;height:6px;border-radius:50%;background:var(--accent)}
ul.steps strong{font-weight:600}
.actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:20px}
.btn{display:inline-flex;align-items:center;justify-content:center;min-height:40px;padding:0 16px;border-radius:8px;
border:1px solid var(--line);color:var(--text);background:var(--card);text-decoration:none;font-weight:550}
.btn:hover{border-color:var(--muted)}
.btn.primary{background:var(--accent);border-color:var(--accent);color:var(--accent-text)}
.btn.primary:hover{background:var(--accent-hover);border-color:var(--accent-hover)}
.btn:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.details{margin:24px 0 0;padding:12px 14px;border-radius:10px;background:var(--soft);border:1px solid var(--line);font-size:13px}
.details dl{display:grid;grid-template-columns:auto 1fr;gap:4px 14px;margin:0}
.details dt{color:var(--muted)}
.details dd{margin:0;min-width:0;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12.5px;overflow-wrap:anywhere}
.details .label{margin:0 0 8px;font-weight:600;color:var(--muted)}
@media (max-width:420px){main{padding:24px 20px 22px}.actions .btn{flex:1 1 100%}}
`;

const LOCK_ICON =
	'<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
	'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="10" width="16" height="11" rx="2"/>' +
	'<path d="M8 10V7a4 4 0 0 1 8 0v3"/><path d="M12 14.5v2.5"/></svg>';

/**
 * The access-denied page.
 *
 * `reason` "group": the signed-in account is not in any of the host's allowed
 * groups. Anything else is a generic denial (an access list, a blocked path),
 * with or without a signed-in account.
 *
 * @param {{
 *   host: string,
 *   user?: { name?: string, email?: string } | null,
 *   reason?: string,
 *   path?: string,
 *   loginUrl: string,
 *   logoutUrl: string,
 *   now?: Date,
 * }} p
 * @returns {string}
 */
export function deniedPage({ host, user, reason, path = "/", loginUrl, logoutUrl, now = new Date() }) {
	const signedIn = !!(user && (user.email || user.name));
	const groupDenied = signedIn && reason === "group";
	const site = esc(host);

	let title;
	let lead;
	let steps;
	if (groupDenied) {
		title = "This account doesn't have access";
		lead = `You're signed in, but <strong>${site}</strong> is only open to members of specific groups, and this account isn't in any of them.`;
		steps = [
			"<strong>Use a different account.</strong> If you have another work account that has access, sign in with that one instead.",
			"<strong>Ask for access.</strong> Contact the person who manages this site, or your IT help desk, and include the details below.",
			"<strong>Just been given access?</strong> Sign in again and choose the same account. Group membership is checked when you sign in.",
		];
	} else if (signedIn) {
		title = "You can't open this page";
		lead = `You're signed in, but access to this page on <strong>${site}</strong> is restricted.`;
		steps = [
			"<strong>Use a different account</strong> if you have another one that should have access.",
			"<strong>Think this is a mistake?</strong> Contact the person who manages this site and include the details below.",
		];
	} else {
		title = "You can't open this page";
		lead = `Access to this page on <strong>${site}</strong> is restricted.`;
		steps = [
			"<strong>Sign in</strong> with an account that has access.",
			"<strong>Think this is a mistake?</strong> Contact the person who manages this site and include the details below.",
		];
	}

	const account = signedIn
		? `<div class="account">
<div class="avatar" aria-hidden="true">${esc(initials(user))}</div>
<div class="who">${user.name ? `<span class="name">${esc(user.name)}</span>` : ""}${
				user.email ? `<span class="email">${esc(user.email)}</span>` : ""
			}</div>
</div>
`
		: "";

	const actions = [
		`<a class="btn primary" href="${esc(loginUrl)}">${signedIn ? "Sign in with a different account" : "Sign in"}</a>`,
	];
	if (signedIn) actions.push(`<a class="btn" href="${esc(logoutUrl)}">Sign out</a>`);

	const details = [
		["Site", host],
		["Page", path],
		...(signedIn ? [["Account", user.email || user.name]] : []),
		["Reason", groupDenied ? "Not in an allowed group" : "Access restricted"],
		["Time", utcStamp(now)],
	];

	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>Access denied · ${site}</title>
<style>${STYLE}</style>
</head>
<body>
<main>
<div class="top">
<div class="icon">${LOCK_ICON}</div>
<div class="site"><strong>Access denied</strong>${site}</div>
</div>
<h1>${title}</h1>
<p class="lead">${lead}</p>
${account}<h2>What you can do</h2>
<ul class="steps">
${steps.map((s) => `<li>${s}</li>`).join("\n")}
</ul>
<div class="actions">${actions.join("")}</div>
<div class="details">
<p class="label">Details for your administrator</p>
<dl>
${details.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join("\n")}
</dl>
</div>
</main>
</body>
</html>
`;
}
