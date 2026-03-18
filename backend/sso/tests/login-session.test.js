import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { saveLoginSessionAndRedirect } from "../login-session.js";

describe("saveLoginSessionAndRedirect", () => {
	it("stores OAuth state and waits for session save before redirecting", async () => {
		let redirectUrl = null;
		let saveCalled = false;
		let resolveSave;
		const saveFinished = new Promise((resolve) => {
			resolveSave = resolve;
		});

		const req = {
			session: {
				cookie: {},
				save(callback) {
					saveCalled = true;
					setTimeout(() => {
						callback();
						resolveSave();
					}, 0);
				},
			},
		};
		const res = {
			redirect(url) {
				redirectUrl = url;
			},
		};

		const pending = saveLoginSessionAndRedirect(req, res, {
			state: "state-123",
			returnUrl: "https://discoverylab.hme.com/path?q=1",
			cookieDomain: ".hme.com",
			authUrl: "https://login.microsoftonline.com/example/oauth2/v2.0/authorize",
		});

		assert.equal(saveCalled, true);
		assert.equal(req.session.oauthState, "state-123");
		assert.equal(req.session.returnUrl, "https://discoverylab.hme.com/path?q=1");
		assert.equal(req.session.cookie.domain, ".hme.com");
		assert.equal(redirectUrl, null);

		await saveFinished;
		await pending;

		assert.equal(
			redirectUrl,
			"https://login.microsoftonline.com/example/oauth2/v2.0/authorize",
		);
	});

	it("sanitizes the return URL before saving the session", async () => {
		const req = {
			session: {
				cookie: {},
				save(callback) {
					callback();
				},
			},
		};
		const res = {
			redirect() {},
		};

		await saveLoginSessionAndRedirect(req, res, {
			state: "state-456",
			returnUrl: "https://evil.example.net/steal",
			cookieDomain: ".hme.com",
			authUrl: "https://login.microsoftonline.com/example/oauth2/v2.0/authorize",
		});

		assert.equal(req.session.returnUrl, "/");
	});
});
