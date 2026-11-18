// backend/sso/pages.js
// Small self-contained HTML pages the sidecar shows instead of bare status
// text: access denied, signed out and sign-in failures. Every page offers the
// next step (use a different account, sign in again, sign out).

/** Content-Security-Policy for the pages: inline styles only, no scripts. */
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
 * /sso/login link that returns to `returnPath`. `return` must be the last
 * query parameter: the sidecar reads it raw up to the end of the URL.
 * @param {string} returnPath - an already validated return URL
 */
export function loginHref(returnPath) {
	return `/sso/login?return=${encodeURIComponent(returnPath || "/")}`;
}

/**
 * /sso/logout link.
 * @param {string} [returnPath]
 */
export function logoutHref(returnPath) {
	return returnPath && returnPath !== "/" ? `/sso/logout?return=${encodeURIComponent(returnPath)}` : "/sso/logout";
}

const STYLE = `
:root{color-scheme:light dark;--bg:#f6f7f9;--card:#fff;--text:#1a1d23;--muted:#5b6370;--line:#dde1e7;--accent:#2558c9;--accent-text:#fff}
@media (prefers-color-scheme:dark){:root{--bg:#14161a;--card:#1c1f25;--text:#e6e8ec;--muted:#9aa3b0;--line:#2e333b;--accent:#6f9bff;--accent-text:#0d1220}}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px 16px;background:var(--bg);color:var(--text);
font:15px/1.5 Inter,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{width:100%;max-width:440px;background:var(--card);border:1px solid var(--line);border-radius:10px;padding:28px 28px 24px}
.host{margin:0 0 14px;font-size:13px;color:var(--muted)}
h1{margin:0 0 8px;font-size:20px;font-weight:600;letter-spacing:-.01em}
p{margin:0 0 10px}
.who{font-weight:600;overflow-wrap:anywhere}
.note{color:var(--muted);font-size:13px}
.code{font-family:ui-monospace,"JetBrains Mono",Consolas,monospace;font-size:12px;color:var(--muted);overflow-wrap:anywhere}
.actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:20px}
.btn{display:inline-flex;align-items:center;height:36px;padding:0 14px;border-radius:6px;border:1px solid var(--line);
color:var(--text);text-decoration:none;font-weight:500;white-space:nowrap}
.btn:hover{border-color:var(--muted)}
.btn.primary{background:var(--accent);border-color:var(--accent);color:var(--accent-text)}
.btn:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
`;

/**
 * One page: a heading, paragraphs (already-escaped HTML) and action links.
 * @param {{ title: string, host?: string, body: string[], actions?: { label: string, href: string, primary?: boolean }[] }} p
 * @returns {string}
 */
export function renderPage({ title, host, body, actions = [] }) {
	const links = actions
		.map((a) => `<a class="btn${a.primary ? " primary" : ""}" href="${esc(a.href)}">${esc(a.label)}</a>`)
		.join("");
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>${esc(title)}${host ? ` · ${esc(host)}` : ""}</title>
<style>${STYLE}</style>
</head>
<body>
<main>
${host ? `<p class="host">${esc(host)}</p>\n` : ""}<h1>${esc(title)}</h1>
${body.map((b) => `<p>${b}</p>`).join("\n")}
${links ? `<div class="actions">${links}</div>` : ""}
</main>
</body>
</html>
`;
}

/** Display string for a session user. */
function who(user) {
	return user?.email || user?.name || "";
}

/**
 * Access denied (403). `reason` "group": the signed-in account is not in an
 * allowed group; anything else: generic denial (e.g. an IP access list).
 * @param {{ host: string, user?: { name?: string, email?: string } | null, reason?: string, returnPath: string }} p
 */
export function deniedPage({ host, user, reason, returnPath }) {
	const account = who(user);
	const body = [];
	if (account && reason === "group") {
		body.push(`Signed in as <span class="who">${esc(account)}</span>. This account doesn't have access.`);
		body.push(`<span class="note">Use an account that does, or ask the site's owner for access.</span>`);
	} else if (account) {
		body.push(`Signed in as <span class="who">${esc(account)}</span>. You can't open this page.`);
	} else {
		body.push("You can't open this page.");
	}
	const actions = [{ label: "Use a different account", href: loginHref(returnPath), primary: true }];
	if (account) actions.push({ label: "Sign out", href: logoutHref() });
	return renderPage({ title: "No access", host, body, actions });
}

/**
 * Shown after sign-out. If a session still exists (another tab signed in
 * again), say so instead.
 * @param {{ host: string, user?: { name?: string, email?: string } | null }} p
 */
export function signedOutPage({ host, user }) {
	const account = who(user);
	if (account) {
		return renderPage({
			title: "Signed in",
			host,
			body: [`Signed in as <span class="who">${esc(account)}</span>.`],
			actions: [
				{ label: "Continue", href: "/", primary: true },
				{ label: "Sign out", href: logoutHref() },
			],
		});
	}
	return renderPage({
		title: "Signed out",
		host,
		body: ["You're signed out."],
		actions: [{ label: "Sign in", href: loginHref("/"), primary: true }],
	});
}

/** Plain-language text for an OAuth `error` code from Entra ID. */
const PROVIDER_ERRORS = {
	access_denied: "Sign-in was cancelled or blocked.",
	consent_required: "This app needs admin consent before you can sign in.",
	interaction_required: "Microsoft needs you to finish signing in.",
	login_required: "Microsoft needs you to sign in again.",
	temporarily_unavailable: "Microsoft sign-in is busy. Try again in a minute.",
	server_error: "Microsoft sign-in had an error. Try again.",
};

/**
 * The AADSTS code from an Entra ID error_description, e.g. "AADSTS50105".
 * @param {unknown} description
 * @returns {string}
 */
export function aadstsCode(description) {
	const m = /\bAADSTS\d{4,6}\b/.exec(String(description ?? ""));
	return m ? m[0] : "";
}

/**
 * Sign-in failed. `kind`: "provider" (Entra ID returned an error), "state"
 * (stale or reused sign-in link), "token" (code exchange failed), "groups"
 * (membership lookup failed), "config" (host not set up), "server".
 * @param {{ host: string, kind: string, error?: string, description?: string, returnPath?: string }} p
 */
export function signInFailedPage({ host, kind, error, description, returnPath = "/" }) {
	const body = [];
	let title = "Sign-in failed";
	let retry = true;
	switch (kind) {
		case "provider": {
			body.push(esc(PROVIDER_ERRORS[error] || "Microsoft didn't complete the sign-in."));
			const code = aadstsCode(description) || (error ? String(error).slice(0, 64) : "");
			if (code) body.push(`<span class="code">${esc(code)}</span>`);
			break;
		}
		case "state":
			title = "Sign-in expired";
			body.push("This sign-in link expired or was already used.");
			break;
		case "token":
			body.push("Microsoft didn't accept the sign-in. Try again.");
			break;
		case "groups":
			body.push("Couldn't check your group membership. Try again in a minute.");
			break;
		case "config":
			title = "Sign-in unavailable";
			body.push("Sign-in isn't set up for this site.");
			retry = false;
			break;
		default:
			body.push("Something went wrong. Try again.");
	}
	return renderPage({
		title,
		host,
		body,
		actions: retry ? [{ label: "Try again", href: loginHref(returnPath), primary: true }] : [],
	});
}
