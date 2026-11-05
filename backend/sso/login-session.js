import { validateReturnUrl } from "./validation.js";

/**
 * Persist login session state before redirecting to the OAuth provider.
 * @param {import("express-session").Session & { cookie: { domain?: string } }} session
 * @param {{ state: string, returnUrl: string, cookieDomain: string, authUrl: string, loginHost?: string }} params
 * @returns {Promise<string>} the provider URL to redirect to
 */
export function saveLoginSession(session, { state, returnUrl, cookieDomain, authUrl, loginHost }) {
	session.oauthState = state;
	session.returnUrl = validateReturnUrl(returnUrl, cookieDomain, loginHost);
	if (loginHost) {
		// The callback must arrive on the same host that started the login
		session.loginHost = loginHost;
	}

	if (cookieDomain) {
		session.cookie.domain = cookieDomain;
	}

	return new Promise((resolve, reject) => {
		session.save((err) => {
			if (err) {
				return reject(err);
			}
			return resolve(authUrl);
		});
	});
}

/**
 * Persist login session state and redirect once the session is saved.
 * @param {{ session: import("express-session").Session & { cookie: { domain?: string } } }} req
 * @param {{ redirect: (url: string) => void }} res
 * @param {{ state: string, returnUrl: string, cookieDomain: string, authUrl: string, loginHost?: string }} params
 * @returns {Promise<void>}
 */
export async function saveLoginSessionAndRedirect(req, res, params) {
	const redirectUrl = await saveLoginSession(req.session, params);
	res.redirect(redirectUrl);
}
