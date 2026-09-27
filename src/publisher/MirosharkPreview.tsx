import { forwardRef, useEffect, useImperativeHandle, useState } from "react";

type PreviewStatus = {
  enabled?: boolean;
  message?: string;
  serverPayer?: boolean;
  amountUsd?: string;
  affiliate?: { expectedCut?: string; caveat?: string };
};

type PreviewResult = {
  ok?: boolean;
  code?: string;
  message?: string;
  summary?: string;
  paid?: boolean;
  run?: {
    runId?: string | null;
    status?: string | null;
    waitUrl?: string | null;
    shareUrl?: string | null;
    progress?: number | null;
    message?: string | null;
    error?: string | null;
  };
};

function formatResult(result: PreviewResult): string {
  if (!result) return "";
  if (result.summary) return result.summary;
  if (result.run?.status === "completed") {
    return result.run.message || "Simulation finished.";
  }
  if (result.run?.runId) {
    const parts = [
      result.run.status ? `Status: ${result.run.status}` : "",
      result.run.progress != null ? `Progress: ${result.run.progress}%` : "",
      result.run.message || "",
      "Typical wall-clock is 10–25 minutes. Publish is still available.",
    ].filter(Boolean);
    return parts.join("\n");
  }
  return result.message || "Preview did not run. Publish still works.";
}

export type MirosharkPreviewHandle = {
  start: () => Promise<PreviewResult | null>;
};

export const MirosharkPreview = forwardRef<MirosharkPreviewHandle, { title: string; body: string }>(
  function MirosharkPreview({ title, body }, ref) {
  const [info, setInfo] = useState<PreviewStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<PreviewResult | null>(null);
  const [note, setNote] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/miroshark/status")
      .then((r) => r.json())
      .then((json) => {
        if (!cancelled) setInfo(json);
      })
      .catch(() => {
        if (!cancelled) {
          setInfo({
            enabled: false,
            message: "Could not load preview status. Publish still works.",
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function pollRun(runId: string) {
    for (let i = 0; i < 8; i += 1) {
      await new Promise((r) => window.setTimeout(r, 5000));
      try {
        const res = await fetch(`/api/miroshark/runs/${encodeURIComponent(runId)}`);
        const json = (await res.json()) as PreviewResult;
        if (json?.ok && json.run) {
          setResult(json);
          if (json.run.status === "completed" || json.summary) return;
          if (json.run.status === "failed" || json.run.status === "cancelled") return;
        }
      } catch {
        return;
      }
    }
  }

  async function onPreview(): Promise<PreviewResult | null> {
    if (busy) return null;
    setBusy(true);
    setNote("Asking MiroShark…");
    setResult(null);
    try {
      const res = await fetch("/api/miroshark/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, body }),
      });
      const json = (await res.json()) as PreviewResult;
      setResult(json);
      setNote("");
      const destination = json?.run?.waitUrl || json?.run?.shareUrl;
      if (destination) window.location.assign(destination);
      else if (json?.ok && json.run?.runId) void pollRun(json.run.runId);
      return json;
    } catch {
      const failed: PreviewResult = {
        ok: false,
        code: "preview_failed",
        message: "Preview failed. Publish still works.",
      };
      setResult(failed);
      setNote("");
      return failed;
    } finally {
      setBusy(false);
    }
  }

  useImperativeHandle(ref, () => ({ start: onPreview }));

  const enabled = Boolean(info?.enabled);
  const waitUrl = result?.run?.waitUrl;
  const shareUrl = result?.run?.shareUrl;

  return (
    <section
      id="simulate-miroshark"
      className="mon-write__preview"
      aria-label="Simulate how this lands with MiroShark"
    >
      <p className="mon-write__preview-kicker">MiroShark</p>
      <h2 className="mon-write__preview-title">Simulate how this lands with MiroShark</h2>
      <p className="mon-write__preview-copy">
        {enabled
          ? `A 25-agent sim (~$${info?.amountUsd || "1.00"} USDC on Base) models reader reaction. It does not block Publish.${
              info?.serverPayer
                ? " This server can pay the $1 run."
                : " If no server payer is set, you get the x402 challenge instead of a live sim."
            }`
          : info?.message ||
            "Set BASE_BUILDER_CODE on Railway to enable this. Get a code at dashboard.base.org → Settings → Builder Codes. Do not invent a code."}
      </p>
      {enabled ? (
        <button
          type="button"
          className="mon-write__simulate"
          disabled={busy}
          onClick={() => void onPreview()}
        >
          {busy ? "Starting…" : "Simulate how this lands with MiroShark"}
        </button>
      ) : null}
      {note ? <p className="mon-write__preview-note">{note}</p> : null}
      {result ? (
        <div className="mon-write__preview-result">
          <p>{formatResult(result)}</p>
          {waitUrl ? (
            <p>
              <a href={waitUrl} target="_blank" rel="noreferrer">
                Open live sim status
              </a>
            </p>
          ) : null}
          {shareUrl ? (
            <p>
              <a href={shareUrl} target="_blank" rel="noreferrer">
                Open report
              </a>
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
});
