"use client";

import { useEffect, useRef, useState } from "react";

// Sanitized HTML is rendered in a sandboxed iframe with scripts disabled (no allow-scripts),
// plus a restrictive CSP, so even a sanitizer bypass cannot execute code in the dashboard.
export function EmailFrame({ html }: { html: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(120);

  const doc = `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: http: data: 'self'; style-src 'unsafe-inline'; font-src https: data:;">
<base target="_blank">
<style>html{background:#fff;color-scheme:light}body{margin:0;padding:12px;font:14px/1.55 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#16181d;word-wrap:break-word;overflow-wrap:anywhere}img{max-width:100%;height:auto}table{max-width:100%}blockquote{margin:0 0 0 .8ex;border-left:2px solid #ddd;padding-left:1ex;color:#555}</style>
</head><body>${html}</body></html>`;

  useEffect(() => {
    const frame = ref.current;
    if (!frame) return;
    const measure = () => {
      const body = frame.contentDocument?.body;
      if (body) setHeight(Math.min(Math.max(body.scrollHeight + 8, 60), 4000));
    };
    frame.addEventListener("load", measure);
    const t = setInterval(measure, 800);
    setTimeout(() => clearInterval(t), 5000);
    return () => {
      frame.removeEventListener("load", measure);
      clearInterval(t);
    };
  }, [html]);

  return (
    <iframe
      ref={ref}
      title="Email content"
      sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      srcDoc={doc}
      className="w-full rounded-lg border-0"
      style={{ height }}
    />
  );
}
