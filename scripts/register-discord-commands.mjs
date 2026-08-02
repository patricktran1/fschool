// scripts/register-discord-commands.mjs
// Run ONCE locally to register the /feedback slash command on your server:
//   node scripts/register-discord-commands.mjs
//
// Needs these in your environment (e.g. a local .env you source, or set inline):
//   DISCORD_CLIENT_ID, DISCORD_BOT_TOKEN, DISCORD_GUILD_ID
// Guild-scoped registration is instant (global takes ~1 hour to propagate),
// which is why we register to your specific server.

const { DISCORD_CLIENT_ID, DISCORD_BOT_TOKEN, DISCORD_GUILD_ID } = process.env;

if (!DISCORD_CLIENT_ID || !DISCORD_BOT_TOKEN || !DISCORD_GUILD_ID) {
  console.error("Missing DISCORD_CLIENT_ID, DISCORD_BOT_TOKEN, or DISCORD_GUILD_ID");
  process.exit(1);
}

const commands = [
  {
    name: "feedback",
    description: "Send feedback to the FSchoolAI team and earn points",
    options: [
      {
        name: "message",
        description: "Your feedback",
        type: 3,        // STRING
        required: true,
      },
    ],
  },
];

const url = `https://discord.com/api/v10/applications/${DISCORD_CLIENT_ID}/guilds/${DISCORD_GUILD_ID}/commands`;

const res = await fetch(url, {
  method: "PUT",   // PUT replaces the full guild command set with this array
  headers: {
    Authorization: `Bot ${DISCORD_BOT_TOKEN}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify(commands),
});

const out = await res.text();
if (res.ok) {
  console.log("✓ Registered /feedback on guild", DISCORD_GUILD_ID);
} else {
  console.error("✗ Failed:", res.status, out);
  process.exit(1);
}
