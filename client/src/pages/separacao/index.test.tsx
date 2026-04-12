import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import SeparacaoPage from "./index";
import { useAuth } from "@/lib/auth";
import { apiRequest } from "@/lib/queryClient";

vi.mock("@/lib/auth", () => ({
    useAuth: vi.fn(),
    useSessionQueryKey: (key: any) => key,
}));

vi.mock("@/lib/queryClient", () => ({
    apiRequest: vi.fn(),
    queryClient: { invalidateQueries: vi.fn() },
}));

vi.mock("@/hooks/use-sse", () => ({
    useSSE: vi.fn(),
}));

const queryClientTest = new QueryClient({
    defaultOptions: {
        queries: {
            retry: false,
            staleTime: Infinity,
            queryFn: async ({ queryKey }) => {
                return []; // default mock response
            }
        },
    },
});

const renderWithProviders = (ui: React.ReactElement) => {
    return render(
        <QueryClientProvider client={queryClientTest}>
            {ui}
        </QueryClientProvider>
    );
};

describe("SeparacaoPage", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        (useAuth as any).mockReturnValue({
            user: { id: "user1", role: "separacao", name: "Tester" },
            logout: vi.fn(),
        });

        // Default fetch mocks
        (apiRequest as any).mockResolvedValue({
            ok: true,
            json: async () => [],
        });
    });

    it("should render the Select step by default when no work units are locked", async () => {
        renderWithProviders(<SeparacaoPage />);

        // Check if the empty state text is visible
        expect(await screen.findByText("Nenhum pedido disponível")).toBeInTheDocument();
    });

    it("should render and display the user name from auth context", async () => {
        renderWithProviders(<SeparacaoPage />);

        // Await for loading to finish and the main banner to display the user name
        expect(await screen.findByText(/Tester/i)).toBeInTheDocument();
    });
});
