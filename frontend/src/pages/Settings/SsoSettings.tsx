import cn from "classnames";
import { Field, Form, Formik } from "formik";
import { type ReactNode, useState } from "react";
import { Alert } from "react-bootstrap";
import { Button, Loading } from "src/components";
import { useSetSetting, useSetting } from "src/hooks";
import { T } from "src/locale";
import { showObjectSuccess } from "src/notifications";

export default function SsoSettings() {
	const ssoEnabled = useSetting("sso-enabled");
	const ssoTenantId = useSetting("sso-tenant-id");
	const ssoClientId = useSetting("sso-client-id");
	const ssoClientSecret = useSetting("sso-client-secret");
	const ssoCookieDomain = useSetting("sso-cookie-domain");
	const ssoRedirectUri = useSetting("sso-redirect-uri");
	const ssoAllowedGroups = useSetting("sso-allowed-groups");

	const { mutateAsync: setSetting } = useSetSetting();
	const [errorMsg, setErrorMsg] = useState<ReactNode | null>(null);
	const [isSubmitting, setIsSubmitting] = useState(false);

	const settings = [ssoEnabled, ssoTenantId, ssoClientId, ssoClientSecret, ssoCookieDomain, ssoRedirectUri, ssoAllowedGroups];
	const isLoading = settings.some((s) => s.isLoading);
	const loadError = settings.find((s) => s.error)?.error;

	const onSubmit = async (values: any, { setSubmitting }: any) => {
		if (isSubmitting) return;
		setIsSubmitting(true);
		setErrorMsg(null);

		try {
			// Save all settings except sso-enabled first
			const settingsToSave: Array<{ id: string; value: string }> = [
				{ id: "sso-tenant-id", value: values.tenantId },
				{ id: "sso-client-id", value: values.clientId },
				{ id: "sso-client-secret", value: values.clientSecret },
				{ id: "sso-cookie-domain", value: values.cookieDomain },
				{ id: "sso-redirect-uri", value: values.redirectUri },
				{ id: "sso-allowed-groups", value: values.allowedGroups },
			];

			for (const setting of settingsToSave) {
				await setSetting(setting);
			}

			// Save sso-enabled LAST — it triggers the config cascade
			await setSetting({ id: "sso-enabled", value: values.enabled ? "true" : "false" });

			showObjectSuccess("setting", "saved");
		} catch (err: any) {
			setErrorMsg(<T id={err.message} />);
		} finally {
			setIsSubmitting(false);
			setSubmitting(false);
		}
	};

	if (!isLoading && loadError) {
		return (
			<div className="card-body">
				<div className="mb-3">
					<Alert variant="danger" show>
						{loadError.message}
					</Alert>
				</div>
			</div>
		);
	}

	if (isLoading) {
		return (
			<div className="card-body">
				<div className="mb-3">
					<Loading noLogo />
				</div>
			</div>
		);
	}

	return (
		<Formik
			initialValues={{
				enabled: ssoEnabled.data?.value === "true",
				tenantId: ssoTenantId.data?.value || "",
				clientId: ssoClientId.data?.value || "",
				clientSecret: ssoClientSecret.data?.value || "",
				cookieDomain: ssoCookieDomain.data?.value || "",
				redirectUri: ssoRedirectUri.data?.value || "",
				allowedGroups: ssoAllowedGroups.data?.value || "",
			}}
			onSubmit={onSubmit}
		>
			{() => (
				<Form>
					<div className="card-body">
						<Alert variant="danger" show={!!errorMsg} onClose={() => setErrorMsg(null)} dismissible>
							{errorMsg}
						</Alert>
						<Alert variant="warning" show>
							<T id="settings.sso.save-warning" />
						</Alert>
						<Alert variant="info" show>
							<T id="settings.sso.https-note" />
						</Alert>

						<div className="mb-3">
							<label className="form-label">
								<T id="settings.sso.description" />
							</label>
						</div>

						<div className="mb-3">
							<Field name="enabled" type="checkbox">
								{({ field }: any) => (
									<label className="form-check form-switch">
										<input
											{...field}
											id="ssoEnabled"
											className={cn("form-check-input", {
												"bg-lime": field.checked,
											})}
											type="checkbox"
										/>
										<span className="form-check-label">
											<T id="settings.sso.enabled" />
										</span>
									</label>
								)}
							</Field>
							<small className="form-hint">
								<T id="settings.sso.enabled.description" />
							</small>
						</div>

						<div className="mb-3">
							<label className="form-label" htmlFor="tenantId">
								<T id="settings.sso.tenant-id" />
							</label>
							<Field
								id="tenantId"
								name="tenantId"
								type="text"
								className="form-control"
								placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
							/>
						</div>

						<div className="mb-3">
							<label className="form-label" htmlFor="clientId">
								<T id="settings.sso.client-id" />
							</label>
							<Field
								id="clientId"
								name="clientId"
								type="text"
								className="form-control"
								placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
							/>
						</div>

						<div className="mb-3">
							<label className="form-label" htmlFor="clientSecret">
								<T id="settings.sso.client-secret" />
							</label>
							<Field
								id="clientSecret"
								name="clientSecret"
								type="password"
								className="form-control"
							/>
						</div>

						<div className="mb-3">
							<label className="form-label" htmlFor="cookieDomain">
								<T id="settings.sso.cookie-domain" />
							</label>
							<Field
								id="cookieDomain"
								name="cookieDomain"
								type="text"
								className="form-control"
								placeholder=".example.com"
							/>
						</div>

						<div className="mb-3">
							<label className="form-label" htmlFor="redirectUri">
								<T id="settings.sso.redirect-uri" />
							</label>
							<Field
								id="redirectUri"
								name="redirectUri"
								type="text"
								className="form-control"
								placeholder="https://auth.example.com/oauth2/callback"
							/>
						</div>

						<div className="mb-3">
							<label className="form-label" htmlFor="allowedGroups">
								<T id="settings.sso.allowed-groups" />
							</label>
							<Field
								id="allowedGroups"
								name="allowedGroups"
								type="text"
								className="form-control"
								placeholder="group-id-1, group-id-2"
							/>
						</div>
					</div>
					<div className="card-footer text-end">
						<Button
							type="submit"
							actionType="primary"
							className="bg-lime"
							isLoading={isSubmitting}
							disabled={isSubmitting}
						>
							<T id="save" />
						</Button>
					</div>
				</Form>
			)}
		</Formik>
	);
}
