export type MessengerAiMention = {
  providerPrompt: string;
  valid: boolean;
};

const handle = "@slateai";

export function parseMessengerAiMention(body: string | null): MessengerAiMention {
  if (!body) return { providerPrompt: "", valid: false };
  const protectedRanges = findCodeRanges(body);
  const matches: Array<{ end: number; start: number }> = [];
  for (let index = 0; index <= body.length - handle.length; index += 1) {
    if (body.slice(index, index + handle.length).toLowerCase() !== handle) continue;
    if (insideRange(index, protectedRanges) || !isBoundary(body[index - 1]) || !isBoundary(body[index + handle.length])) continue;
    matches.push({ end: index + handle.length, start: index });
    index += handle.length - 1;
  }
  if (matches.length === 0) return { providerPrompt: body, valid: false };
  let providerPrompt = "";
  let cursor = 0;
  for (const match of matches) {
    providerPrompt += body.slice(cursor, match.start);
    cursor = match.end;
  }
  providerPrompt += body.slice(cursor);
  return { providerPrompt: providerPrompt.replace(/\s{2,}/gu, " ").trim(), valid: true };
}

function findCodeRanges(value: string) {
  const ranges: Array<{ end: number; start: number }> = [];
  let index = 0;
  while (index < value.length) {
    if (value.startsWith("```", index)) {
      const closing = value.indexOf("```", index + 3);
      const end = closing === -1 ? value.length : closing + 3;
      ranges.push({ end, start: index });
      index = end;
      continue;
    }
    if (value[index] === "`") {
      const closing = value.indexOf("`", index + 1);
      const end = closing === -1 ? value.length : closing + 1;
      ranges.push({ end, start: index });
      index = end;
      continue;
    }
    index += 1;
  }
  return ranges;
}

function insideRange(index: number, ranges: Array<{ end: number; start: number }>) {
  return ranges.some((range) => index >= range.start && index < range.end);
}

function isBoundary(value: string | undefined) {
  return value === undefined || !/[A-Za-z0-9_@]/u.test(value);
}
