import { QueryClient, QueryFunction } from "@tanstack/react-query";

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const contentType = res.headers.get("content-type");
    if (contentType && contentType.includes("application/json")) {
      try {
        const json = await res.json();
        // Handle common error formats
        // 1. { error: "Title", details: "Description" }
        // 2. { message: "Error message" }
        // 3. { error: "Error message" }

        let errorMessage = json.message || json.error || res.statusText;

        // If we have both error and details, format nicely
        if (json.error && json.details) {
          errorMessage = `${json.error}: ${json.details}`;
        } else if (json.details) {
          errorMessage = json.details;
        }

        throw new Error(errorMessage);
      } catch (e) {
        // If JSON parsing fails or extracting message fails, fall back to text
        if (e instanceof Error && e.message !== "Unexpected end of JSON input" && !(e instanceof SyntaxError)) {
          // If it's our parsed error, rethrow it
          throw e;
        }
      }
    }

    // Fallback for non-JSON or parsing failures
    const text = (await res.text()) || res.statusText;
    throw new Error(text);
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
  options?: { timeoutMs?: number },
): Promise<Response> {
  const controller = new AbortController();
  const timeoutMs = options?.timeoutMs ?? 10000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method,
      headers: data ? { "Content-Type": "application/json" } : {},
      body: data ? JSON.stringify(data) : undefined,
      credentials: "include",
      signal: controller.signal,
    });

    await throwIfResNotOk(res);
    return res;
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error("Tempo limite excedido. Verifique sua conexão.");
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/** Evento global disparado quando qualquer chamada de API recebe 401. */
export const UNAUTHORIZED_EVENT = "stoker:unauthorized";

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
    async ({ queryKey }) => {
      // Find the URL in the queryKey (the one starting with /api)
      const urlParts = queryKey.filter((key): key is string =>
        typeof key === "string" && key.startsWith("/api")
      );
      const url = urlParts.length > 0 ? urlParts.join("/") : (queryKey[0] as string);

      const res = await fetch(url, {
        credentials: "include",
      });

      if (res.status === 401) {
        window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT));
        if (unauthorizedBehavior === "returnNull") return null;
      }

      await throwIfResNotOk(res);
      return await res.json();
    };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: 0,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
