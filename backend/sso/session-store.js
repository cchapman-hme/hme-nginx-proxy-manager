// backend/sso/session-store.js
// SQLite-backed session store for the SSO sidecar.

import session from "express-session";
import Database from "better-sqlite3";
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const SESSION_DB_PATH = process.env.SSO_SESSION_DB_PATH || "/data/sso/sessions.db";

export class SsoSessionStore extends session.Store {
	constructor() {
		super();
		const dir = dirname(SESSION_DB_PATH);
		if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
		this.db = new Database(SESSION_DB_PATH);
		this.db.pragma("journal_mode = WAL");
		this.db.exec(`
			CREATE TABLE IF NOT EXISTS sessions (
				sid TEXT PRIMARY KEY,
				data TEXT NOT NULL,
				expires INTEGER NOT NULL
			)
		`);
		this.db.exec("CREATE INDEX IF NOT EXISTS idx_sso_expires ON sessions(expires)");
		this._get = this.db.prepare("SELECT data FROM sessions WHERE sid = ? AND expires > ?");
		this._set = this.db.prepare("INSERT OR REPLACE INTO sessions (sid, data, expires) VALUES (?, ?, ?)");
		this._del = this.db.prepare("DELETE FROM sessions WHERE sid = ?");
		this._prune = this.db.prepare("DELETE FROM sessions WHERE expires <= ?");
		this._pruneInterval = setInterval(() => this.prune(), 15 * 60 * 1000);
	}

	get(sid, cb) {
		try {
			const row = this._get.get(sid, Date.now());
			cb(null, row ? JSON.parse(row.data) : null);
		} catch (e) {
			cb(e);
		}
	}

	set(sid, data, cb) {
		try {
			const maxAge = data.cookie?.maxAge || 8 * 60 * 60 * 1000;
			this._set.run(sid, JSON.stringify(data), Date.now() + maxAge);
			cb?.(null);
		} catch (e) {
			cb?.(e);
		}
	}

	destroy(sid, cb) {
		try {
			this._del.run(sid);
			cb?.(null);
		} catch (e) {
			cb?.(e);
		}
	}

	prune() {
		this._prune.run(Date.now());
	}

	close() {
		clearInterval(this._pruneInterval);
		this.db.close();
	}
}
