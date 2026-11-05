// The callback must only be accepted on the host that started the login.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { saveLoginSession } from "../login-session.js";

describe("saveLoginSession", () => {
	it("records the login host and keeps same-host absolute return URLs", async () => {
		const session = {
			cookie: {},
			save(cb) {
				cb();
			},
		};
		await saveLoginSession(session, {
			state: "s",
			returnUrl: "https://app.example.com/deep?x=1",
			cookieDomain: "",
			authUrl: "https://login.microsoftonline.com/x",
			loginHost: "app.example.com",
		});
		assert.equal(session.loginHost, "app.example.com");
		assert.equal(session.returnUrl, "https://app.example.com/deep?x=1");
		assert.equal(session.cookie.domain, undefined);
	});
});
