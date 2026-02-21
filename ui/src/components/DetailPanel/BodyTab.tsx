import type { ResponseEvent } from "../../lib/types";

interface Props {
  response?: ResponseEvent;
}

export function BodyTab({ response }: Props) {
  if (!response?.body) {
    return <div className="detail-empty">No response body</div>;
  }

  const contentType =
    response.headers?.["content-type"] ??
    response.headers?.["Content-Type"] ??
    "";

  let formatted = response.body;
  if (contentType.includes("json")) {
    try {
      formatted = JSON.stringify(JSON.parse(response.body), null, 2);
    } catch {
      // use raw body
    }
  }

  return <pre className="body-viewer">{formatted}</pre>;
}
