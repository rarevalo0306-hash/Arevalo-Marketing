import { lookup } from "dns/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readMedia } from "@/lib/media";

// DNS de mentira: "inside.example.com" apunta a la red interna, todo lo demás a internet.
vi.mock("dns/promises", () => ({
  lookup: vi.fn(async (host: string) => [{ address: host === "inside.example.com" ? "10.0.0.5" : "93.184.215.14", family: 4 }]),
}));

const fetchMock = vi.fn();
const redirect = (location: string) => new Response(null, { status: 302, headers: { location } });

beforeEach(() => {
  vi.mocked(lookup).mockClear();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("reading a stored photo re-checks every redirect", () => {
  it("follows a redirect to another public address, resolved against the current one", async () => {
    fetchMock.mockResolvedValueOnce(redirect("/b.jpg")).mockResolvedValueOnce(new Response("photo"));
    expect((await readMedia("https://cdn.example.com/a/a.jpg")).toString()).toBe("photo");
    expect(fetchMock.mock.calls.map(([url, init]) => [url, init.redirect])).toEqual([
      ["https://cdn.example.com/a/a.jpg", "manual"],
      ["https://cdn.example.com/b.jpg", "manual"],
    ]);
    expect(lookup).toHaveBeenCalledTimes(2);
  });

  it("refuses a redirect to the cloud metadata service or to a name that points inside", async () => {
    for (const location of ["https://169.254.169.254/latest/meta-data", "https://[::ffff:a9fe:a9fe]/", "https://inside.example.com/a.jpg", "http://cdn.example.com/a.jpg"]) {
      fetchMock.mockReset().mockResolvedValueOnce(redirect(location));
      await expect(readMedia("https://cdn.example.com/a.jpg"), location).rejects.toThrow("dirección pública");
      expect(fetchMock, location).toHaveBeenCalledTimes(1);
    }
  });

  it("refuses internal stored addresses without downloading", async () => {
    for (const url of ["https://[::ffff:7f00:1]/a.jpg", "https://inside.example.com/a.jpg"]) await expect(readMedia(url), url).rejects.toThrow("dirección pública");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("gives up after three redirects", async () => {
    fetchMock.mockImplementation(async () => redirect("https://cdn.example.com/again.jpg"));
    await expect(readMedia("https://cdn.example.com/a.jpg")).rejects.toThrow("demasiadas veces");
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});
