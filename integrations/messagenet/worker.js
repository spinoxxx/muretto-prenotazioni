import "dotenv/config";
import ari from "ari-client";

const {
  ASTERISK_ARI_URL = "http://127.0.0.1:8088/ari",
  ASTERISK_ARI_USER = "muretto_voice",
  ASTERISK_ARI_PASSWORD,
  MURETTO_APP_URL = "https://muretto-prenotazioni.onrender.com",
  MURETTO_VOICE_API_TOKEN
} = process.env;

if (!ASTERISK_ARI_PASSWORD) throw new Error("ASTERISK_ARI_PASSWORD mancante");
if (!MURETTO_VOICE_API_TOKEN) throw new Error("MURETTO_VOICE_API_TOKEN mancante");

function apiUrl(path) {
  return `${MURETTO_APP_URL.replace(/\/+$/, "")}${path}`;
}

async function createCallback({ caller, called, reason }) {
  const response = await fetch(apiUrl("/api/voice/callbacks"), {
    method: "POST",
    headers: {
      "authorization": `Bearer ${MURETTO_VOICE_API_TOKEN}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      requestId: `messagenet-${Date.now()}`,
      guestName: "",
      phone: caller || "",
      reason,
      notes: called ? `Numero chiamato: ${called}` : ""
    })
  });
  if (!response.ok) throw new Error(`Muretto callback HTTP ${response.status}: ${await response.text()}`);
  return response.json();
}

async function main() {
  const client = await ari.connect(ASTERISK_ARI_URL, ASTERISK_ARI_USER, ASTERISK_ARI_PASSWORD);

  client.on("StasisStart", async (event, channel) => {
    const caller = channel.caller?.number || "";
    const called = event.args?.[1] || "";
    try {
      await channel.answer();
      await channel.play({ media: "sound:beep" });
      await createCallback({
        caller,
        called,
        reason: "Chiamata ricevuta da MessageNet. Assistente vocale non ancora attivo sul gateway: richiamare il cliente."
      });
      await channel.play({ media: "sound:vm-goodbye" });
    } catch (error) {
      console.error(error);
    } finally {
      channel.hangup().catch(() => {});
    }
  });

  client.start("muretto-voice");
  console.log("Gateway MessageNet avviato. In attesa di chiamate Asterisk/Stasis muretto-voice.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

