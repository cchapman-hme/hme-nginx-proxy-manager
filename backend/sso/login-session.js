import { validateReturnUrl } from "./validation.js";

/**
 * Persist login session state before redirecting to the OAuth provider.
 * @param {import("express-session").Session & { cookie: { domain?: string } }} session
 * @param {{ state: string, returnUrl: string, cookieDomain: string, authUrl: string }} params
 * @returns {Promise<string>}
 */
export function saveLoginSession(session, { state, returnUrl, cookieDomain, authUrl }) {
	session.oauthState = state;
	session.returnUrl = validateReturnUrl(returnUrl, cookieDomain);

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
 * @param {{ state: string, returnUrl: string, cookieDomain: string, authUrl: string }} params
 * @returns {Promise<void>}
 */
export async function saveLoginSessionAndRedirect(req, res, params) {
	const redirectUrl = await saveLoginSession(req.session, params);
	res.redirect(redirectUrl);
}