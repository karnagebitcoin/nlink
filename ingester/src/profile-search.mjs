const PROFILE_SEARCH_MAX_SHARD_LENGTH = 3;
const PROFILE_SEARCH_MIN_SHARD_LENGTH = 2;

function normalizeWhitespace(value) {
  return value.replace(/\s+/g, " ").trim();
}

export function normalizeSearchText(value) {
  return normalizeWhitespace(
    String(value ?? "")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase(),
  );
}

function extractSearchParts(profile) {
  return [profile.display_name, profile.name, profile.nip05]
    .filter(Boolean)
    .map(normalizeSearchText)
    .filter(Boolean);
}

function extractSearchTokens(value) {
  return normalizeSearchText(value)
    .split(/[\s._:@/+~-]+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

function getSearchShardPrefixes(token) {
  if (!token) {
    return ["_"];
  }

  const prefixes = new Set();
  const maxLength = Math.min(PROFILE_SEARCH_MAX_SHARD_LENGTH, token.length);

  for (let length = maxLength; length >= PROFILE_SEARCH_MIN_SHARD_LENGTH; length -= 1) {
    prefixes.add(token.slice(0, length));
  }

  if (prefixes.size === 0) {
    prefixes.add(token.slice(0, 1));
  }

  return Array.from(prefixes);
}

export function buildProfileSearchText(profile) {
  const parts = new Set();

  for (const value of extractSearchParts(profile)) {
    parts.add(value);

    for (const token of extractSearchTokens(value)) {
      parts.add(token);
    }
  }

  return Array.from(parts).join(" ");
}

export function createProfileSearchEntry(pubkey, profile) {
  const entry = {
    display_name: profile?.display_name,
    name: profile?.name,
    nip05: profile?.nip05,
    picture: profile?.picture,
    pubkey,
  };

  return {
    ...entry,
    searchText: buildProfileSearchText(entry),
  };
}

export function getProfileSearchShardCandidates(query) {
  const [primaryToken = ""] = extractSearchTokens(String(query ?? "").replace(/^@+/, ""));
  const normalized = primaryToken || normalizeSearchText(query).replace(/^@+/, "");

  return getSearchShardPrefixes(normalized);
}

export function getProfileSearchShards(profile) {
  const shards = new Set();

  for (const part of extractSearchParts(profile)) {
    for (const token of extractSearchTokens(part)) {
      for (const prefix of getSearchShardPrefixes(token)) {
        shards.add(prefix);
      }
    }
  }

  return Array.from(shards).filter(Boolean).slice(0, 24);
}

function scoreProfile(profile, query) {
  const normalizedQuery = normalizeSearchText(query).replace(/^@+/, "");
  const displayName = normalizeSearchText(profile.display_name ?? "");
  const name = normalizeSearchText(profile.name ?? "");
  const nip05 = normalizeSearchText(profile.nip05 ?? "");
  const searchText = profile.searchText ?? buildProfileSearchText(profile);
  const tokens = new Set(searchText.split(" ").filter(Boolean));

  if (displayName === normalizedQuery || name === normalizedQuery || nip05 === normalizedQuery) {
    return 500;
  }

  if (tokens.has(normalizedQuery)) {
    return 420;
  }

  if (displayName.startsWith(normalizedQuery) || name.startsWith(normalizedQuery) || nip05.startsWith(normalizedQuery)) {
    return 320;
  }

  if (Array.from(tokens).some((token) => token.startsWith(normalizedQuery))) {
    return 250;
  }

  if (displayName.includes(normalizedQuery) || name.includes(normalizedQuery) || nip05.includes(normalizedQuery)) {
    return 170;
  }

  if (searchText.includes(normalizedQuery)) {
    return 100;
  }

  return 0;
}

export function filterAndRankProfileSearchResults(profiles, query, limit = 10) {
  const normalizedQuery = normalizeSearchText(query).replace(/^@+/, "");
  if (!normalizedQuery) {
    return [];
  }

  const deduped = new Map();
  for (const profile of profiles) {
    if (!profile?.pubkey) {
      continue;
    }

    const searchText = profile.searchText ?? buildProfileSearchText(profile);
    if (!searchText.includes(normalizedQuery)) {
      continue;
    }

    deduped.set(profile.pubkey, {
      ...profile,
      searchText,
    });
  }

  return Array.from(deduped.values())
    .sort((left, right) => {
      const scoreDiff = scoreProfile(right, normalizedQuery) - scoreProfile(left, normalizedQuery);
      if (scoreDiff !== 0) {
        return scoreDiff;
      }

      const leftName = normalizeSearchText(left.display_name || left.name || "");
      const rightName = normalizeSearchText(right.display_name || right.name || "");
      return leftName.localeCompare(rightName);
    })
    .slice(0, limit);
}
