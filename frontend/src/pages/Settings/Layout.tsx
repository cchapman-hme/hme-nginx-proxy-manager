import { useState } from "react";
import { T } from "src/locale";
import DefaultSite from "./DefaultSite";
import SsoSettings from "./SsoSettings";

export default function Layout() {
	// Taken from https://preview.tabler.io/settings.html
	// Refer to that when updating this content

	const [activeTab, setActiveTab] = useState<"default-site" | "sso">("default-site");

	return (
		<div className="card mt-4">
			<div className="card-status-top bg-teal" />
			<div className="card-table">
				<div className="card-header">
					<div className="row w-full">
						<h2 className="mt-1 mb-0">
							<T id="settings" />
						</h2>
					</div>
				</div>
				<div className="row g-0">
					<div className="col-12 col-md-3 border-end">
						<div className="card-body mt-0 pt-0">
							<div className="list-group list-group-transparent">
								<a
									href="#"
									className={`list-group-item list-group-item-action d-flex align-items-center${activeTab === "default-site" ? " active" : ""}`}
									onClick={(e) => {
										e.preventDefault();
										setActiveTab("default-site");
									}}
								>
									<T id="settings.default-site" />
								</a>
								<a
									href="#"
									className={`list-group-item list-group-item-action d-flex align-items-center${activeTab === "sso" ? " active" : ""}`}
									onClick={(e) => {
										e.preventDefault();
										setActiveTab("sso");
									}}
								>
									<T id="settings.sso" />
								</a>
							</div>
						</div>
					</div>
					<div className="col-12 col-md-9 d-flex flex-column">
						{activeTab === "default-site" && <DefaultSite />}
						{activeTab === "sso" && <SsoSettings />}
					</div>
				</div>
			</div>
		</div>
	);
}
