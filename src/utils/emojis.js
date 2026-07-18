export const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🔥', '👏', '🙏'];

// Expanded emoji dataset with searchable keywords.
export const EMOJI_DATA = [
  { e: '😀', keywords: ['grin', 'smile', 'happy'] },
  { e: '😁', keywords: ['grin', 'teeth'] },
  { e: '😂', keywords: ['joy', 'tears', 'lol', 'laugh'] },
  { e: '🤣', keywords: ['rofl', 'laugh'] },
  { e: '😊', keywords: ['smile', 'pleased'] },
  { e: '😍', keywords: ['love', 'heart', 'eyes'] },
  { e: '😘', keywords: ['kiss'] },
  { e: '😎', keywords: ['cool', 'sunglasses'] },
  { e: '🤔', keywords: ['thinking', 'hmm'] },
  { e: '😅', keywords: ['sweat', 'nervous'] },
  { e: '😢', keywords: ['sad', 'cry'] },
  { e: '😭', keywords: ['sob', 'cry'] },
  { e: '😡', keywords: ['angry', 'mad'] },
  { e: '🤯', keywords: ['mind', 'blown'] },
  { e: '🥳', keywords: ['party', 'celebrate'] },
  { e: '😴', keywords: ['sleep', 'zzz'] },
  { e: '🤗', keywords: ['hug'] },
  { e: '🙌', keywords: ['hooray', 'praise'] },
  { e: '👏', keywords: ['clap', 'applause'] },
  { e: '👍', keywords: ['thumbs up', 'ok', 'yes'] },
  { e: '👎', keywords: ['thumbs down', 'no'] },
  { e: '❤️', keywords: ['heart', 'love'] },
  { e: '🧡', keywords: ['heart', 'orange'] },
  { e: '💛', keywords: ['heart', 'yellow'] },
  { e: '💚', keywords: ['heart', 'green'] },
  { e: '💙', keywords: ['heart', 'blue'] },
  { e: '💜', keywords: ['heart', 'purple'] },
  { e: '🖤', keywords: ['heart', 'black'] },
  { e: '💔', keywords: ['broken', 'heart'] },
  { e: '💯', keywords: ['100', 'perfect'] },
  { e: '🔥', keywords: ['fire', 'hot'] },
  { e: '✨', keywords: ['sparkle', 'shine'] },
  { e: '⭐', keywords: ['star'] },
  { e: '🎉', keywords: ['party', 'celebrate'] },
  { e: '🙏', keywords: ['pray', 'please', 'thanks'] },
  { e: '💪', keywords: ['strong', 'flex'] },
  { e: '🤝', keywords: ['handshake', 'agree'] },
  { e: '👀', keywords: ['eyes', 'look'] },
  { e: '💬', keywords: ['speech', 'chat'] },
  { e: '✅', keywords: ['check', 'done'] },
  { e: '❌', keywords: ['x', 'wrong'] },
  { e: '🌸', keywords: ['flower', 'blossom'] },
  { e: '🍕', keywords: ['pizza', 'food'] },
  { e: '☕', keywords: ['coffee', 'drink'] },
  { e: '🎵', keywords: ['music', 'note'] },
  { e: '📌', keywords: ['pin', 'important'] },
  { e: '🚀', keywords: ['rocket', 'launch'] },
  { e: '🌙', keywords: ['moon', 'night'] },
  { e: '☀️', keywords: ['sun', 'day'] },
  { e: '🌈', keywords: ['rainbow', 'pride'] },
  { e: '🎂', keywords: ['cake', 'birthday'] },
  { e: '💡', keywords: ['idea', 'light'] },
  { e: '🎯', keywords: ['target', 'goal'] },
  { e: '🔒', keywords: ['lock', 'secure'] },
  { e: '📷', keywords: ['camera', 'photo'] },
  { e: '📝', keywords: ['note', 'edit'] },
  { e: '📎', keywords: ['attach', 'paperclip'] },
  { e: '🕒', keywords: ['time', 'clock'] },
  { e: '🌟', keywords: ['star', 'favorite'] },
  { e: '🍀', keywords: ['luck', 'clover'] },
  { e: '🍩', keywords: ['donut', 'snack'] },
  { e: '🎁', keywords: ['gift', 'present'] },
  { e: '🍺', keywords: ['beer', 'drink'] },
  { e: '🏆', keywords: ['trophy', 'win'] },
];

export const COMPOSER_EMOJIS = EMOJI_DATA.map((d) => d.e);

export function searchEmojis(query, limit = 128) {
  if (!query || typeof query !== 'string') return COMPOSER_EMOJIS.slice(0, limit);
  const q = query.trim().toLowerCase();
  if (!q) return COMPOSER_EMOJIS.slice(0, limit);
  const results = [];
  for (const item of EMOJI_DATA) {
    if (results.length >= limit) break;
    if (item.e.includes(q)) {
      results.push(item.e);
      continue;
    }
    for (const k of item.keywords) {
      if (k.includes(q) || q.includes(k)) {
        results.push(item.e);
        break;
      }
    }
  }
  // fallback: include emojis whose keywords contain q as substring
  if (!results.length) {
    for (const item of EMOJI_DATA) {
      if (results.length >= limit) break;
      if (item.keywords.some((k) => k.indexOf(q) !== -1)) results.push(item.e);
    }
  }
  return results;
}
