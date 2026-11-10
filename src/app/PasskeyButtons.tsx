"use client";

import { browserSupportsWebAuthn, startAuthentication, startRegistration } from "@simplewebauthn/browser";
import { useEffect, useState } from "react";
import {
  beginPasskeyLoginAction,
  beginPasskeyRegistrationAction,
  finishPasskeyLoginAction,
  finishPasskeyRegistrationAction,
} from "./passkey-actions";

type Labels = { button: string; working: string; cancelled: string; failed: string };

/** True once mounted in a browser that can use passkeys (false during server rendering). */
function useWebAuthn() {
  const [supported, setSupported] = useState(false);
  useEffect(() => setSupported(browserSupportsWebAuthn()), []);
  return supported;
}

/** The person closed the prompt, it timed out, or the device has no matching passkey. */
function isCancel(e: unknown) {
  return e instanceof Error && (e.name === "NotAllowedError" || e.name === "AbortError");
}

function describe(e: unknown, labels: Labels) {
  if (isCancel(e)) return labels.cancelled;
  console.error(e);
  return labels.failed;
}

export function PasskeySignIn({ next, labels }: { next: string; labels: Labels }) {
  const supported = useWebAuthn();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  if (!supported) return null;

  async function signIn() {
    setBusy(true);
    setMessage(null);
    try {
      const optionsJSON = await beginPasskeyLoginAction();
      const response = await startAuthentication({ optionsJSON });
      const result = await finishPasskeyLoginAction(response, next);
      if ("error" in result) setMessage(result.error);
      else window.location.assign(result.redirectTo);
    } catch (e) {
      setMessage(describe(e, labels));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <button className="big" type="button" onClick={signIn} disabled={busy}>
        {busy ? labels.working : labels.button}
      </button>
      {message && <p className="notice error" role="alert">{message}</p>}
    </div>
  );
}

/** On success, goes to `doneHref`, whose page shows the confirmation. */
export function PasskeySetup({ labels, doneHref, title, body }: { labels: Labels; doneHref: string; title?: string; body?: string }) {
  const supported = useWebAuthn();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  if (!supported) return null;

  async function setUp() {
    setBusy(true);
    setMessage(null);
    try {
      const optionsJSON = await beginPasskeyRegistrationAction();
      const response = await startRegistration({ optionsJSON });
      const result = await finishPasskeyRegistrationAction(response);
      if ("error" in result) setMessage(result.error);
      else window.location.assign(doneHref);
    } catch (e) {
      setMessage(describe(e, labels));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      {title && <h2>{title}</h2>}
      {body && <p>{body}</p>}
      <button type="button" onClick={setUp} disabled={busy}>{busy ? labels.working : labels.button}</button>
      {message && <p className="notice error" role="alert">{message}</p>}
    </div>
  );
}
