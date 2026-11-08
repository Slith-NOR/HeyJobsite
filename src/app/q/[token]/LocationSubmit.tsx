"use client";

import { useRef, useState } from "react";

type Props = { label: string; workingLabel: string; explain: string };

/**
 * Submit button that asks for location once, at the moment of the visit event.
 * Denial, timeout or no support are recorded as such and never block the check-in.
 */
export function LocationSubmit({ label, workingLabel, explain }: Props) {
  const [working, setWorking] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);

  function setField(form: HTMLFormElement, name: string, value: string) {
    let input = form.querySelector<HTMLInputElement>(`input[name="${name}"]`);
    if (!input) {
      input = document.createElement("input");
      input.type = "hidden";
      input.name = name;
      form.appendChild(input);
    }
    input.value = value;
  }

  function onClick(e: React.MouseEvent<HTMLButtonElement>) {
    const form = ref.current?.form;
    if (!form || working) return;
    if (form.dataset.located === "1") return; // second pass: let the browser submit
    e.preventDefault();
    setWorking(true);
    const finish = (permission: string, pos?: GeolocationPosition) => {
      setField(form, "locPermission", permission);
      if (pos) {
        setField(form, "locLat", String(pos.coords.latitude));
        setField(form, "locLng", String(pos.coords.longitude));
        setField(form, "locAcc", String(pos.coords.accuracy));
        setField(form, "locTs", String(pos.timestamp));
      }
      form.dataset.located = "1";
      form.requestSubmit(ref.current!);
    };
    if (!("geolocation" in navigator)) return finish("unavailable");
    navigator.geolocation.getCurrentPosition(
      (pos) => finish("granted", pos),
      (err) => finish(err.code === err.PERMISSION_DENIED ? "denied" : "unavailable"),
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 30_000 },
    );
  }

  return (
    <>
      <p className="muted">{explain}</p>
      <button ref={ref} className="big" type="submit" onClick={onClick}>
        {working ? workingLabel : label}
      </button>
    </>
  );
}
