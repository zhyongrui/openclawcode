import { describe, expect, it } from "vitest";
import { connectOk, installGatewayTestHooks, rpcReq } from "./test-helpers.js";
import { withServer } from "./test-with-server.js";

installGatewayTestHooks({ scope: "suite" });

describe("gateway tools.diff", () => {
  it("returns a structured tool diff against another agent", async () => {
    await withServer(async (ws) => {
      await connectOk(ws, { token: "secret", scopes: ["operator.read", "operator.write"] });
      const created = await rpcReq<{ key?: string }>(ws, "sessions.create", {
        label: "Tools Diff Test",
      });
      expect(created.ok).toBe(true);
      const sessionKey = created.payload?.key;
      expect(sessionKey).toBeTruthy();

      const res = await rpcReq<{
        baseSessionKey?: string;
        compareAgentId?: string;
        base?: { agentId?: string };
        target?: { agentId?: string };
        diff?: {
          sharedCount?: number;
          addedCounts?: { total?: number };
          removedCounts?: { total?: number };
        };
      }>(ws, "tools.diff", { sessionKey, compareAgentId: "main" });

      expect(res.ok).toBe(true);
      expect(res.payload?.baseSessionKey).toBe(sessionKey);
      expect(res.payload?.compareAgentId).toBe("main");
      expect(res.payload?.base?.agentId).toBeTruthy();
      expect(res.payload?.target?.agentId).toBe("main");
      expect(typeof res.payload?.diff?.sharedCount).toBe("number");
      expect(typeof res.payload?.diff?.addedCounts?.total).toBe("number");
      expect(typeof res.payload?.diff?.removedCounts?.total).toBe("number");
    });
  });
});
