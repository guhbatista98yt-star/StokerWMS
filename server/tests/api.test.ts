import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import { app } from "../index";

let authToken: string;

describe("WMS API Integration Tests", () => {
    // Note: The test database is automatically seeded before running this script
    // via the "npm run test:seed" command in package.json

    it("should fail authentication with wrong credentials", async () => {
        const res = await request(app)
            .post("/api/auth/login")
            .send({
                username: "test_admin",
                password: "wrongpassword",
            });

        expect(res.status).toBe(401); // Unauthorized
    });

    it("should authenticate a user and return a token", async () => {
        const res = await request(app)
            .post("/api/auth/login")
            .send({
                username: "test_admin",
                password: "admin123",
            });

        expect(res.status).toBe(200);

        const rawCookies = res.headers["set-cookie"];
        const cookies: string[] = Array.isArray(rawCookies) ? rawCookies : (rawCookies ? [rawCookies as string] : []);
        expect(cookies.length).toBeGreaterThan(0);

        let tokenCookie = cookies.find((c: string) => c.startsWith("authToken="));
        expect(tokenCookie).toBeDefined();

        authToken = tokenCookie!.split(";")[0].split("=")[1];

        expect(res.body.user).toHaveProperty("username", "test_admin");
        expect(res.body.user).toHaveProperty("role", "administrador");
    });

    it("should reject access to protected routes without a token", async () => {
        const res = await request(app).get("/api/work-units");
        expect(res.status).toBe(401);
    });

    it("should allow access to protected routes with a valid token", async () => {
        const res = await request(app)
            .get("/api/work-units")
            .set("Cookie", `authToken=${authToken}`);

        expect(res.status).toBe(200);
        expect(Array.isArray(res.body)).toBe(true);
    });

    it("should fetch routes with valid token", async () => {
        const res = await request(app)
            .get("/api/routes")
            .set("Cookie", `authToken=${authToken}`);

        expect(res.status).toBe(200);
        expect(Array.isArray(res.body)).toBe(true);
        // From seed, we should have at least the test route
        expect(res.body.length).toBeGreaterThan(0);
        expect(res.body[0]).toHaveProperty("code", "RT-01");
    });
});
