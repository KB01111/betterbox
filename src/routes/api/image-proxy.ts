import { createFileRoute } from "@tanstack/react-router";
import { auth } from "@/lib/auth/auth";
import { getRuntimeConfig } from "@/lib/runtime.server";
import { json } from "@/lib/json-response";
import {
  RASTER_IMAGE_TYPE,
  safeImageTarget,
  secureResponse,
} from "@/lib/request-security";

const MAX_BYTES = 10 * 1024 * 1024;
const MAX_REDIRECTS = 4;
const TIMEOUT_MS = 10_000;

export const Route = createFileRoute("/api/image-proxy")({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) => {
        // Reader srcdoc preserves same-origin cookies via allow-same-origin; keep this endpoint private.
        const session = await auth.api.getSession({ headers: request.headers });
        if (!session) return json({ error: "Not signed in" }, 401);
        const hosts = getRuntimeConfig().imageProxyHosts;
        let target = safeImageTarget(
          new URL(request.url).searchParams.get("url") ?? "",
          hosts,
        );
        if (!target) return json({ error: "Image host is not trusted" }, 400);
        const controller = new AbortController();
        const abort = () => controller.abort();
        const timer = setTimeout(abort, TIMEOUT_MS);
        request.signal.addEventListener("abort", abort, { once: true });
        if (request.signal.aborted) controller.abort();
        const cleanup = () => {
          clearTimeout(timer);
          request.signal.removeEventListener("abort", abort);
        };
        let upstream: Response | undefined;
        try {
          for (let hop = 0; ; hop++) {
            upstream = await fetch(target, {
              headers: {
                accept: "image/avif,image/webp,image/png,image/jpeg,image/gif",
              },
              redirect: "manual",
              signal: controller.signal,
              cache: "no-store",
            });
            const location = upstream.headers.get("location");
            if (upstream.status < 300 || upstream.status >= 400 || !location)
              break;
            await upstream.body?.cancel();
            if (hop >= MAX_REDIRECTS) throw new Error("Redirect limit");
            const next = safeImageTarget(new URL(location, target).href, hosts);
            if (!next) throw new Error("Untrusted redirect");
            target = next;
          }
          const type = (upstream.headers.get("content-type") ?? "")
            .split(";")[0]
            .trim()
            .toLowerCase();
          if (
            !upstream.ok ||
            !upstream.body ||
            !RASTER_IMAGE_TYPE.test(type) ||
            Number(upstream.headers.get("content-length")) > MAX_BYTES
          ) {
            await upstream.body?.cancel();
            cleanup();
            return json({ error: "Image unavailable" }, 502);
          }
          const reader = upstream.body.getReader();
          let total = 0;
          const body = new ReadableStream<Uint8Array>({
            async pull(output) {
              try {
                const { done, value } = await reader.read();
                if (done) {
                  cleanup();
                  output.close();
                  return;
                }
                total += value.byteLength;
                if (total > MAX_BYTES) throw new Error("Image too large");
                output.enqueue(value);
              } catch {
                controller.abort();
                await reader.cancel().catch(() => {});
                cleanup();
                output.error(new Error("Image unavailable"));
              }
            },
            cancel(reason) {
              controller.abort();
              cleanup();
              return reader.cancel(reason).catch(() => {});
            },
          });
          return secureResponse(
            new Response(body, {
              headers: {
                "content-type": type,
                "content-security-policy": "sandbox; default-src 'none'",
                "content-disposition": "inline",
              },
            }),
          );
        } catch {
          controller.abort();
          await upstream?.body?.cancel().catch(() => {});
          cleanup();
          return json({ error: "Image unavailable" }, 502);
        }
      },
    },
  },
});
