// chatMessages.ts — chat transcript helpers shared by the tutor.

/**
 * Sanitize a transcript before sending it to the LLM API. Failed turns can leave
 * empty assistant rows in history; sending those (or breaking role alternation)
 * makes Anthropic return an empty response. This drops empty/whitespace messages
 * and merges consecutive same-role turns so the conversation is always valid.
 */
export function sanitizeApiMessages(messages) {
  return (messages ?? [])
    .map(({ role, content }) => ({ role, content: typeof content === "string" ? content : "" }))
    .filter(m => m.content.trim().length > 0)
    .reduce((acc, m) => {
      const last = acc[acc.length - 1];
      if (last && last.role === m.role) last.content += "\n\n" + m.content;
      else acc.push({ ...m });
      return acc;
    }, []);
}
