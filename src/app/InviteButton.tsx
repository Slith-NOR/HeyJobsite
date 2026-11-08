"use client";

import { useActionState } from "react";
import { createInviteAction, type InviteState } from "./actions";

type Props = {
  companyId: string;
  role: "worker" | "supervisor";
  label: string;
  createdText: string;
  errorText: string;
};

/** Creates a single-use invite link and shows it with a QR code the invitee can scan from this screen. */
export function InviteButton({ companyId, role, label, createdText, errorText }: Props) {
  const [state, action, pending] = useActionState<InviteState, FormData>(createInviteAction, null);
  return (
    <form action={action}>
      <input type="hidden" name="companyId" value={companyId} />
      <input type="hidden" name="role" value={role} />
      <button type="submit" className="secondary" disabled={pending}>{label}</button>
      {state?.error && <p className="notice error">{errorText}</p>}
      {state?.link && (
        <div className="card">
          <p>{createdText}</p>
          <div className="qr" dangerouslySetInnerHTML={{ __html: state.svg ?? "" }} />
          <code className="link">{state.link}</code>
        </div>
      )}
    </form>
  );
}
