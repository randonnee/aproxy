import { parseUrl, formatTime } from "../../lib/helpers";
import type { RequestEvent, ResponseEvent, ErrorEvent } from "../../lib/types";

interface Props {
  request: RequestEvent;
  response?: ResponseEvent;
  error?: ErrorEvent;
}

export function OverviewTab({ request, response, error }: Props) {
  const { host, path } = parseUrl(request.url);

  return (
    <div className="overview-grid">
      <div className="label">Method</div>
      <div className="value">{request.method}</div>

      <div className="label">URL</div>
      <div className="value">{request.url}</div>

      <div className="label">Host</div>
      <div className="value">{host}</div>

      <div className="label">Path</div>
      <div className="value">{path}</div>

      <div className="label">Time</div>
      <div className="value">{formatTime(request.timestamp)}</div>

      {response && (
        <>
          <div className="label">Status</div>
          <div className="value">{response.status}</div>

          <div className="label">Duration</div>
          <div className="value">{response.durationMs}ms</div>

          {response.mocked && (
            <>
              <div className="label">Source</div>
              <div className="value">Mocked</div>
            </>
          )}
        </>
      )}

      {error && (
        <>
          <div className="label">Error</div>
          <div className="value">{error.message}</div>
        </>
      )}
    </div>
  );
}
