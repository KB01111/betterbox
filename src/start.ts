import { createMiddleware, createStart } from "@tanstack/react-start";
import { apiErrorResponse } from "@/lib/api-error";

// Catch at the route boundary, before Start's generic error logger/serializer.
const apiErrors = createMiddleware().server(async ({ next, pathname, handlerType }) => {
  try { return await next(); } catch (error) {
    if (!pathname.startsWith("/api/") && handlerType !== "serverFn") throw error;
    return apiErrorResponse(error);
  }
});

export const startInstance = createStart(() => ({ requestMiddleware: [apiErrors] }));
