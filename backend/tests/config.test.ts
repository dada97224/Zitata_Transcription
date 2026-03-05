import { describe, it, expect } from "vitest";

describe("Configuration", () => {
  it("devrait charger les valeurs par défaut", async () => {
    const { config } = await import("../src/config");
    expect(config.port).toBe(3001);
    expect(config.databaseUrl).toContain("postgres://");
    expect(config.redisUrl).toContain("redis://");
    expect(config.asrUrl).toContain("http://");
  });

  it("devrait avoir un port valide", async () => {
    const { config } = await import("../src/config");
    expect(config.port).toBeGreaterThan(0);
    expect(config.port).toBeLessThan(65536);
  });
});
