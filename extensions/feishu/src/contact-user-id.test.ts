import { describe, expect, it } from "vitest";
import { resolveFeishuUserOpenIdByContact } from "./contact-user-id.js";

const baseConfig = {
  channels: {
    feishu: {
      appId: "cli_test",
      appSecret: "secret_test", // pragma: allowlist secret
      domain: "feishu",
    },
  },
} as const;

describe("resolveFeishuUserOpenIdByContact", () => {
  it("resolves an open_id by email", async () => {
    const result = await resolveFeishuUserOpenIdByContact(
      {
        cfg: baseConfig,
        email: "Owner@Example.com",
      },
      {
        createClient: () => ({
          contact: {
            user: {
              batchGetId: async () => ({
                code: 0,
                data: {
                  user_list: [
                    {
                      user_id: "ou_owner",
                      email: "owner@example.com",
                    },
                  ],
                },
              }),
            },
          },
        }),
      },
    );

    expect(result).toEqual({
      openId: "ou_owner",
      matchedBy: "email",
      matchedValue: "owner@example.com",
    });
  });

  it("resolves an open_id by mobile", async () => {
    const result = await resolveFeishuUserOpenIdByContact(
      {
        cfg: baseConfig,
        mobile: "+8613800138000",
      },
      {
        createClient: () => ({
          contact: {
            user: {
              batchGetId: async () => ({
                code: 0,
                data: {
                  user_list: [
                    {
                      user_id: "ou_mobile_owner",
                      mobile: "+8613800138000",
                    },
                  ],
                },
              }),
            },
          },
        }),
      },
    );

    expect(result).toEqual({
      openId: "ou_mobile_owner",
      matchedBy: "mobile",
      matchedValue: "+8613800138000",
    });
  });

  it("throws when no contact match is returned", async () => {
    await expect(
      resolveFeishuUserOpenIdByContact(
        {
          cfg: baseConfig,
          email: "missing@example.com",
        },
        {
          createClient: () => ({
            contact: {
              user: {
                batchGetId: async () => ({
                  code: 0,
                  data: {
                    user_list: [],
                  },
                }),
              },
            },
          }),
        },
      ),
    ).rejects.toThrow("No Feishu user ID found for email missing@example.com.");
  });
});
