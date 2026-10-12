import { describe, expect, it } from "vitest";
import { isPrivateIp, isPublicHttpsUrl } from "@/lib/net-guard";

describe("the server only downloads public internet addresses", () => {
  it("knows private, local and reserved IPs", () => {
    for (const ip of ["10.0.0.1", "127.0.0.1", "169.254.169.254", "172.16.5.4", "172.31.255.255", "192.168.1.1", "100.64.0.1", "0.0.0.0", "224.0.0.1", "::1", "::", "fd00::1", "fe80::1", "::ffff:127.0.0.1", "not-an-ip"]) expect(isPrivateIp(ip), ip).toBe(true);
    for (const ip of ["8.8.8.8", "172.32.0.1", "104.18.2.3", "2606:4700::1111", "::ffff:8.8.8.8"]) expect(isPrivateIp(ip), ip).toBe(false);
  });

  it("refuses internal addresses, other schemes, credentials and odd ports without asking DNS", async () => {
    for (const url of [
      "http://example.com/a.png",
      "https://169.254.169.254/latest/meta-data",
      "https://127.0.0.1/a.png",
      "https://[::1]/a.png",
      "https://10.1.2.3/a.png",
      "https://user:pass@example.com/a.png",
      "https://example.com:8443/a.png",
      "https://localhost/a.png",
      "https://metadata.internal/a.png",
      "file:///etc/passwd",
      "not a url",
    ]) expect(await isPublicHttpsUrl(url), url).toBe(false);
    expect(await isPublicHttpsUrl("https://8.8.8.8/a.png")).toBe(true);
  });

  it("sees IPv4 hidden inside IPv6 (mapped, compatible, NAT64, 6to4) and other reserved IPv6", () => {
    for (const ip of ["::ffff:7f00:1", "::ffff:a9fe:a9fe", "::7f00:1", "64:ff9b::a9fe:a9fe", "64:ff9b:1::1", "2002:7f00:1::1", "2001:0:4136:e378::1", "100::1", "2001:db8::1", "ff02::1"]) expect(isPrivateIp(ip), ip).toBe(true);
    for (const ip of ["2606:4700:4700::1111", "2001:4860:4860::8888"]) expect(isPrivateIp(ip), ip).toBe(false);
  });

  it("only blocks the reserved parts of 192.0.0.0/16, so WordPress photos still download", () => {
    for (const ip of ["192.0.0.170", "192.0.2.1", "198.51.100.7", "203.0.113.9"]) expect(isPrivateIp(ip), ip).toBe(true);
    for (const ip of ["192.0.78.17", "192.0.77.2"]) expect(isPrivateIp(ip), ip).toBe(false);
  });

  it("refuses bracketed IPv6 addresses that point inside, as the URL parser rewrites them", async () => {
    for (const url of [
      "https://[::ffff:127.0.0.1]/",
      "https://[::ffff:169.254.169.254]/",
      "https://[64:ff9b::a9fe:a9fe]/",
      "https://[64:ff9b::169.254.169.254]/",
      "https://[::127.0.0.1]/",
      "https://[2002:7f00:1::1]/",
    ]) expect(await isPublicHttpsUrl(url), url).toBe(false);
    expect(await isPublicHttpsUrl("https://[2606:4700:4700::1111]/a.png")).toBe(true);
    expect(await isPublicHttpsUrl("https://192.0.78.17/a.png")).toBe(true);
  });
});
