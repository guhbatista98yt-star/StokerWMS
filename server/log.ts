export function log(message: string, source = "express") {
    const formattedTime = new Date().toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
        second: "2-digit",
        hour12: true,
    });

    console.log(`${formattedTime} [${source}] ${message}`);
}

export function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

export function getDbError(error: unknown): { message: string; code: string | undefined } {
    const message = error instanceof Error ? error.message : String(error);
    const code = (error != null && typeof error === "object" && "code" in error)
        ? String((error as { code: unknown }).code)
        : undefined;
    return { message, code };
}
