/**
 * post-feedback-button.mjs
 * One-time script: posts the persistent "Share Feedback" embed + button to a Discord channel.
 * The message stays there permanently — anyone can click it anytime to open the survey modal.
 *
 * Usage:
 *   node scripts/post-feedback-button.mjs <CHANNEL_ID>
 *
 * Requires DISCORD_BOT_TOKEN in the environment. Easiest ways:
 *   node --env-file=.env.local scripts/post-feedback-button.mjs 1234567890
 *   DISCORD_BOT_TOKEN=xxx node scripts/post-feedback-button.mjs 1234567890
 *
 * To pin the message after posting, copy the returned message_id and pin it manually
 * in Discord (right-click → Pin Message), or use the pin endpoint:
 *   curl -X PUT https://discord.com/api/v10/channels/CHANNEL_ID/pins/MESSAGE_ID \
 *        -H "Authorization: Bot BOT_TOKEN"
 */

const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const CHANNEL_ID = process.argv[2];

if (!BOT_TOKEN) {
  console.error("Error: DISCORD_BOT_TOKEN not set in environment.");
  process.exit(1);
}
if (!CHANNEL_ID) {
  console.error("Usage: node scripts/post-feedback-button.mjs <CHANNEL_ID>");
  process.exit(1);
}

const res = await fetch(`https://discord.com/api/v10/channels/${CHANNEL_ID}/messages`, {
  method: "POST",
  headers: {
    Authorization: `Bot ${BOT_TOKEN}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    embeds: [{
      title: "FschoolAI Feedback",
      description: "Help us build the best academic AI — takes 30 seconds.",
      color: 0xC49A3C,
    }],
    components: [{
      type: 1,
      components: [{
        type: 2,       // button
        style: 1,      // primary (blurple)
        label: "Share Feedback",
        custom_id: "open_feedback",
      }],
    }],
  }),
});

if (!res.ok) {
  const body = await res.text();
  console.error(`Discord API error ${res.status}:`, body);
  process.exit(1);
}

const msg = await res.json();
console.log("Posted successfully.");
console.log("  Channel ID: ", CHANNEL_ID);
console.log("  Message ID: ", msg.id);
console.log("");
console.log("To pin this message, run:");
console.log(`  curl -X PUT https://discord.com/api/v10/channels/${CHANNEL_ID}/pins/${msg.id} \\`);
console.log(`       -H "Authorization: Bot ${BOT_TOKEN.slice(0, 6)}..."`);
