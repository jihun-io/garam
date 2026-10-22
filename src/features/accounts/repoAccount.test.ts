import { describe, expect, it } from "vitest";

import type { Account } from "../../ipc";
import { emailBelongsTo, parseRemote, suggestAccount } from "./repoAccount";

const account = (id: number, login: string, emails: string[] = []): Account => ({
  key: `github.com/${id}`,
  host: "github.com",
  login,
  name: null,
  avatarUrl: "",
  emails,
  noreplyEmail: `${id}+${login}@users.noreply.github.com`,
});

const personal = account(1, "jihun-io", ["kim@jihun.io"]);
const work = account(2, "cw-jihun-io", ["jh.kim@causeworks.co.kr"]);
const accounts = [work, personal];

describe("parseRemote", () => {
  it("reads HTTPS and SSH remotes", () => {
    expect(parseRemote("https://jihun-io@github.com/jihun-io/garam.git")).toEqual({
      host: "github.com",
      owner: "jihun-io",
      urlUser: "jihun-io",
      https: true,
    });
    expect(parseRemote("https://GitHub.com/Causeworks/app")).toMatchObject({
      host: "github.com",
      owner: "Causeworks",
      urlUser: null,
    });
    expect(parseRemote("git@github.com:jihun-io/garam.git")).toEqual({
      host: "github.com",
      owner: "jihun-io",
      urlUser: null,
      https: false,
    });
    expect(parseRemote("ssh://git@github.com:22/jihun-io/garam.git")).toMatchObject({
      owner: "jihun-io",
      https: false,
    });
    expect(parseRemote("/Users/me/bare.git")).toBeNull();
  });
});

describe("suggestAccount", () => {
  it("prefers the URL user, then the owner, then the author email", () => {
    const remote = parseRemote("https://cw-jihun-io@github.com/jihun-io/garam.git");
    expect(suggestAccount(accounts, remote, null)).toBe(work);

    expect(suggestAccount(accounts, parseRemote("https://github.com/JIHUN-IO/x"), null)).toBe(
      personal,
    );

    const org = parseRemote("https://github.com/causeworks/app.git");
    expect(suggestAccount(accounts, org, "jh.kim@causeworks.co.kr")).toBe(work);
    expect(suggestAccount(accounts, org, "1+jihun-io@users.noreply.github.com")).toBe(personal);
    expect(suggestAccount(accounts, org, "someone@example.com")).toBeNull();
  });

  it("only suggests accounts on the remote's host", () => {
    expect(suggestAccount(accounts, parseRemote("https://gitlab.com/jihun-io/x"), null)).toBeNull();
  });
});

describe("emailBelongsTo", () => {
  it("accepts verified emails and the noreply address, ignoring case", () => {
    expect(emailBelongsTo(personal, "Kim@Jihun.io")).toBe(true);
    expect(emailBelongsTo(personal, "1+jihun-io@users.noreply.github.com")).toBe(true);
    expect(emailBelongsTo(personal, "jh.kim@causeworks.co.kr")).toBe(false);
  });
});
