import { isIP } from "node:net";

export function isBlockedHostname(hostname: string) {
  const normalizedHostname = normalizeHostname(hostname);
  if (
    normalizedHostname === "" ||
    normalizedHostname === "localhost" ||
    normalizedHostname.endsWith(".local")
  ) {
    return true;
  }

  return isPrivateAddress(normalizedHostname);
}

export function normalizeHostname(hostname: string) {
  return hostname.toLowerCase().replace(/^\[/, "").replace(/\]$/, "");
}

export function isPrivateAddress(address: string) {
  const normalizedAddress = normalizeHostname(address);
  const ipVersion = isIP(normalizedAddress);
  if (ipVersion === 4) {
    return isPrivateIpv4(normalizedAddress);
  }

  if (ipVersion === 6) {
    return isPrivateIpv6(normalizedAddress);
  }

  return false;
}

function isPrivateIpv4(address: string) {
  const octets = parseIpv4Octets(address);
  if (!octets) {
    return true;
  }

  const [first, second, third] = octets;
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 0 && (third === 0 || third === 2)) ||
    (first === 192 && second === 88 && third === 99) ||
    (first === 192 && second === 168) ||
    (first === 198 && (second === 18 || second === 19)) ||
    (first === 198 && second === 51 && third === 100) ||
    (first === 203 && second === 0 && third === 113) ||
    first >= 224
  );
}

function isPrivateIpv6(address: string) {
  const words = parseIpv6Words(address);
  if (!words) {
    return true;
  }

  const embeddedIpv4 = ipv4FromMappedIpv6(words);
  if (embeddedIpv4 && isPrivateIpv4(embeddedIpv4)) {
    return true;
  }

  const nat64Ipv4 = ipv4FromNat64WellKnownPrefix(words);
  if (nat64Ipv4) {
    return isPrivateIpv4(nat64Ipv4);
  }

  const first = words[0] ?? 0;
  const second = words[1] ?? 0;
  const third = words[2] ?? 0;
  return (
    words.every((word) => word === 0) ||
    (words.slice(0, 7).every((word) => word === 0) && words[7] === 1) ||
    (first & 0xff00) === 0xff00 ||
    (first & 0xffc0) === 0xfe80 ||
    (first & 0xfe00) === 0xfc00 ||
    (first & 0xe000) !== 0x2000 ||
    isNonGlobalIetfProtocolAssignment(words) ||
    (first === 0x2001 && second === 0x0002 && third === 0x0000) ||
    (first === 0x2001 && (second & 0xfff0) === 0x0010) ||
    (first === 0x2001 && second === 0x0db8) ||
    (first === 0x3fff && (second & 0xf000) === 0x0000) ||
    first === 0x2002
  );
}

function isNonGlobalIetfProtocolAssignment(words: number[]) {
  const first = words[0] ?? 0;
  const second = words[1] ?? 0;
  if (first !== 0x2001 || (second & 0xfe00) !== 0x0000) {
    return false;
  }

  return !isGloballyReachableIetfProtocolAssignment(words);
}

function isGloballyReachableIetfProtocolAssignment(words: number[]) {
  const second = words[1] ?? 0;
  const third = words[2] ?? 0;
  const fourth = words[3] ?? 0;
  const restAfterFourth = words.slice(4);

  return (
    (second === 0x0001 &&
      third === 0 &&
      fourth === 0 &&
      restAfterFourth.slice(0, 3).every((word) => word === 0) &&
      [1, 2, 3].includes(words[7] ?? 0)) ||
    second === 0x0003 ||
    (second === 0x0004 && third === 0x0112) ||
    (second & 0xfff0) === 0x0020 ||
    (second & 0xfff0) === 0x0030
  );
}

function parseIpv4Octets(address: string) {
  const parts = address.split(".");
  if (parts.length !== 4) {
    return null;
  }

  const octets = parts.map((part) => Number.parseInt(part, 10));
  if (
    octets.some(
      (octet, index) =>
        !Number.isInteger(octet) ||
        octet < 0 ||
        octet > 255 ||
        String(octet) !== parts[index],
    )
  ) {
    return null;
  }

  return octets as [number, number, number, number];
}

function parseIpv6Words(address: string) {
  const withoutZone = address.split("%", 1)[0] ?? "";
  const sections = withoutZone.split("::");
  if (sections.length > 2) {
    return null;
  }

  const left = parseIpv6Section(sections[0] ?? "");
  const right = parseIpv6Section(sections[1] ?? "");
  if (!left || !right) {
    return null;
  }

  if (sections.length === 1) {
    return left.length === 8 ? left : null;
  }

  const missing = 8 - left.length - right.length;
  if (missing < 1) {
    return null;
  }

  return [...left, ...Array.from({ length: missing }, () => 0), ...right];
}

function parseIpv6Section(section: string) {
  if (section === "") {
    return [];
  }

  const words: number[] = [];
  const parts = section.split(":");
  for (const part of parts) {
    if (part.includes(".")) {
      const octets = parseIpv4Octets(part);
      if (!octets) {
        return null;
      }

      words.push(octets[0] * 256 + octets[1], octets[2] * 256 + octets[3]);
      continue;
    }

    const word = Number.parseInt(part, 16);
    if (
      part === "" ||
      part.length > 4 ||
      !/^[0-9a-f]+$/i.test(part) ||
      !Number.isInteger(word) ||
      word < 0 ||
      word > 0xffff
    ) {
      return null;
    }

    words.push(word);
  }

  return words;
}

function ipv4FromMappedIpv6(words: number[]) {
  if (
    words.length === 8 &&
    words.slice(0, 5).every((word) => word === 0) &&
    words[5] === 0xffff
  ) {
    const high = words[6] ?? 0;
    const low = words[7] ?? 0;
    return [
      high >> 8,
      high & 0xff,
      low >> 8,
      low & 0xff,
    ].join(".");
  }

  return null;
}

function ipv4FromNat64WellKnownPrefix(words: number[]) {
  if (
    words.length === 8 &&
    words[0] === 0x0064 &&
    words[1] === 0xff9b &&
    words.slice(2, 6).every((word) => word === 0)
  ) {
    const high = words[6] ?? 0;
    const low = words[7] ?? 0;
    return [
      high >> 8,
      high & 0xff,
      low >> 8,
      low & 0xff,
    ].join(".");
  }

  return null;
}
