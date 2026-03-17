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
	const { mutateAsync: setSetting } = useSetSetting();
	const [errorMsg, setErrorMsg] = useState<ReactNode | null>(null);
	const [isSubmitting, setIsSubmitting] = useState(false);

	if (ssoEnabled.isLoading) {
		return (
			<div className="card-body">
				<Loading noLogo />
			</div>
		);
	}

	if (ssoEnabled.error) {
		return (
			<div className="card-body">
				<Alert variant="danger">{ssoEnabled.error.message}</Alert>
			</div>
		);
	}

	const onSubmit = async (values: any, { setSubmitting }: any) => {
		if (isSubmitting) return;
		setIsSubmitting(true);
		setErrorMsg(null);
		try {
			await setSetting({
				id: "sso-enabled",
				value: values.enabled ? "true" : "false",
			});
			showObjectSuccess("setting", "saved");
		} catch (err: any) {
			setErrorMsg(<T id={err.message} />);
		} finally {
			setIsSubmitting(false);
			setSubmitting(false);
		}
	};

	return (
		<Formik
			initialValues={{ enabled: ssoEnabled.data?.value === "true" }}
			onSubmit={onSubmit}
		>
			{() => (
				<Form>
					<div className="card-body">
						<Alert
							variant="danger"
							show={!!errorMsg}
							onClose={() => setErrorMsg(null)}
							dismissible
						>
							{errorMsg}
						</Alert>
						<Alert variant="info" show>
							<T id="settings.sso.per-host-info" />
						</Alert>
						<Alert variant="warning" show>
							<T id="settings.sso.save-warning" />
						</Alert>

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
								<T id="settings.sso.killswitch.description" />
							</small>
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
