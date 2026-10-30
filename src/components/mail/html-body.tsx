import DOMPurify from "dompurify";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  emailDocument,
  emailImageSource,
  emailCss,
  emailInlineSource,
} from "@/lib/email/html-security";

function sanitizeEmail(html: string, remoteAllowed: boolean): string {
  if (typeof window === "undefined") return "";
  const purifier = DOMPurify(window);
  purifier.addHook("afterSanitizeAttributes", (node) => {
    if (node.tagName === "IMG") {
      const source = emailImageSource(
        node.getAttribute("src") ?? "",
        window.location.origin,
        remoteAllowed,
      );
      if (source) node.setAttribute("src", source);
      else node.removeAttribute("src");
      node.removeAttribute("srcset");
    }
    if (node.tagName === "A" && node.getAttribute("href")) {
      node.setAttribute("target", "_blank");
      node.setAttribute("rel", "noopener noreferrer");
    }
    if (node.tagName === "STYLE" && node.textContent) {
      node.textContent = emailCss(
        node.textContent,
        window.location.origin,
        remoteAllowed,
      );
    }
    const element = node.nodeType === 1 ? (node as Element) : null;
    const style = element?.getAttribute("style");
    if (style && element) {
      element.setAttribute(
        "style",
        emailCss(style, window.location.origin, remoteAllowed),
      );
    }
  });
  return emailDocument(
    purifier.sanitize(html, {
      WHOLE_DOCUMENT: true,
      USE_PROFILES: { html: true },
      ADD_TAGS: ["style"],
      ADD_ATTR: ["target"],
      FORBID_TAGS: [
        "meta",
        "base",
        "link",
        "video",
        "audio",
        "source",
        "picture",
        "track",
        "iframe",
        "object",
        "embed",
        "svg",
        "math",
        "form",
        "input",
        "button",
        "textarea",
        "select",
      ],
      FORBID_ATTR: [
        "srcset",
        "poster",
        "background",
        "action",
        "formaction",
        "ping",
      ],
    }),
    window.location.origin,
    remoteAllowed,
  );
}

/** Sandboxed HTML email body: frameless, no inner scrollbars, auto-sizes to
 *  content height like Gmail. allow-scripts omitted so allow-same-origin is safe. */
export function HtmlBody({
  html,
  accountId,
  messageId,
  inlineAttachments,
}: {
  html: string;
  /** With messageId + inlineAttachments, resolves cid: images to the Gmail
   *  attachment endpoint. Omitted (e.g. demo mail) → cid: left as-is. */
  accountId?: string;
  messageId?: string;
  inlineAttachments?: Record<
    string,
    { attachmentId: string; mimeType: string; data?: string }
  >;
}) {
  const ref = useRef<HTMLIFrameElement>(null);
  const observerRef = useRef<ResizeObserver | null>(null);
  const [doc, setDoc] = useState("");
  const [allowedHtml, setAllowedHtml] = useState<string | null>(null);
  const remoteAllowed = allowedHtml === html;

  useEffect(
    () => setDoc(sanitizeEmail(html, remoteAllowed)),
    [html, remoteAllowed],
  );
  useEffect(() => () => observerRef.current?.disconnect(), []);

  const onLoad = () => {
    const iframe = ref.current;
    const idoc = iframe?.contentDocument;
    if (!iframe || !idoc?.body) return;

    // Resolve cid: images to the Gmail attachment endpoint — real attachments,
    // not URLs, so the image proxy can't reach them.
    if (accountId && messageId && inlineAttachments) {
      idoc.querySelectorAll("img").forEach((img) => {
        const src = img.getAttribute("src") ?? "";
        if (!src.toLowerCase().startsWith("cid:")) return;
        const cid = src.slice(4).replace(/^<|>$/g, "");
        const att = inlineAttachments[cid];
        if (!att) return;
        const source = emailInlineSource(
          att,
          window.location.origin,
          accountId,
          messageId,
        );
        if (source) img.setAttribute("src", source);
        else img.removeAttribute("src");
      });
    }

    const base = idoc.createElement("base");
    base.target = "_blank";
    idoc.head.prepend(base);
    // HTML emails assume a light canvas regardless of the app theme.
    idoc.documentElement.style.colorScheme = "light";
    // Force root to auto height so the email's height:100%/min-height chains don't
    // feed back off the iframe height we set (box grows forever); kill horizontal
    // scroll and keep wide media from overflowing the pane.
    const style = idoc.createElement("style");
    style.textContent =
      // Auto-height + no horizontal scroll (so ResizeObserver sizing works).
      "html,body{height:auto!important;min-height:0!important;margin:0!important;padding:0!important;overflow-x:hidden!important}" +
      // Breathing room inside the email's own background; reads right on white + dark.
      "body{padding:16px 20px!important}" +
      // System font base so web-font emails degrade cleanly (no serif); antialiased.
      'body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale}' +
      // Reset for table-based email layouts (most HTML email is tables).
      "table{border-collapse:collapse}" +
      "img,video,table{max-width:100%!important}" +
      "img,video{height:auto}" +
      "a{word-break:break-all}";
    idoc.head.appendChild(style);

    // Guard against resize-observer feedback loops by skipping identical heights.
    let last = 0;
    const fit = () => {
      const height = Math.ceil(idoc.body.scrollHeight);
      if (height && height !== last) {
        last = height;
        iframe.style.height = `${height}px`;
      }
    };
    observerRef.current?.disconnect();
    observerRef.current = new ResizeObserver(fit);
    observerRef.current.observe(idoc.body);
    fit();

    // A failed image (dead CDN, proxy reject) shows a broken-image icon. No
    // allow-scripts means no inline onerror, so attach the handler from here
    // (allow-same-origin). Alt text → muted italic; decorative images vanish.
    const handleBroken = (img: HTMLImageElement) => {
      const alt = (img.getAttribute("alt") || "").trim();
      if (alt) {
        const span = idoc.createElement("span");
        span.textContent = alt;
        span.style.cssText = "color:#8a817a;font-size:13px;font-style:italic";
        img.replaceWith(span);
      } else {
        img.style.display = "none";
      }
      fit();
    };
    // Remote images can land after first paint and grow the body; re-fit.
    idoc.querySelectorAll("img").forEach((img) => {
      img.addEventListener("load", fit);
      img.addEventListener("error", () => handleBroken(img));
      // Caught a failure that happened before this listener attached.
      if (img.complete && img.naturalWidth === 0 && img.getAttribute("src")) {
        handleBroken(img);
      }
    });
    if (idoc.fonts?.ready) idoc.fonts.ready.then(fit).catch(() => {});

    // iframe swallows wheel events with no inner scroll; forward to the reader pane.
    idoc.addEventListener(
      "wheel",
      (event) => {
        const scroller = scrollParent(iframe);
        if (scroller) scroller.scrollTop += event.deltaY;
      },
      { passive: true },
    );
  };

  return (
    <>
      <div className="mb-2 flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>
          {remoteAllowed
            ? "Trusted external images enabled for this message."
            : "External images blocked."}
        </span>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setAllowedHtml(remoteAllowed ? null : html)}
        >
          {remoteAllowed ? "Block images" : "Load trusted images"}
        </Button>
      </div>
      <iframe
        ref={ref}
        title="Message body"
        scrolling="no"
        sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
        srcDoc={doc}
        referrerPolicy="no-referrer"
        onLoad={onLoad}
        className="block w-full overflow-hidden rounded-lg bg-white"
      />
    </>
  );
}

function scrollParent(el: HTMLElement): HTMLElement | null {
  let node = el.parentElement;
  while (node) {
    const overflowY = getComputedStyle(node).overflowY;
    if (
      (overflowY === "auto" || overflowY === "scroll") &&
      node.scrollHeight > node.clientHeight
    ) {
      return node;
    }
    node = node.parentElement;
  }
  return null;
}
