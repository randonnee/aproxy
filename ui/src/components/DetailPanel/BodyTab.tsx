import type { ResponseEvent } from "../../lib/types";
import { CopyBtn } from "./CopyBtn";

interface Props {
  response?: ResponseEvent;
}

export function BodyTab({ response }: Props) {
  if (!response?.body && !response?.bodyBase64) {
    return <div className="detail-empty">No response body</div>;
  }

  const contentType =
    response.headers?.["content-type"] ??
    response.headers?.["Content-Type"] ??
    "";

  const normalizedType = contentType.toLowerCase();
  const isImage = normalizedType.startsWith("image/");
  const isVideo = normalizedType.startsWith("video/");

  const bodyText = response.body ?? "";
  let formatted = bodyText;
  if (bodyText && normalizedType.includes("json")) {
    try {
      formatted = JSON.stringify(JSON.parse(bodyText), null, 2);
    } catch {
      // use raw body
    }
  }

  const hasBase64 = Boolean(response.bodyBase64 && response.bodyEncoding === "base64");
  const mediaSrc = hasBase64 ? `data:${normalizedType || "application/octet-stream"};base64,${response.bodyBase64}` : undefined;

  return (
    <div className="body-wrap">
      <CopyBtn text={formatted} title="Copy body" className="body-copy-btn" />
      {isImage && mediaSrc ? (
        <div className="body-media">
          <img src={mediaSrc} alt="Response body" className="body-media-img" />
        </div>
      ) : null}
      {isVideo && mediaSrc ? (
        <div className="body-media">
          <video src={mediaSrc} controls className="body-media-video" />
        </div>
      ) : null}
      <pre className="body-viewer">{formatted}</pre>
    </div>
  );
}
