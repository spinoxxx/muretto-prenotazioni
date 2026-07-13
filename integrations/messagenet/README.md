# Integrazione MessageNet

MessageNet e adatto come fornitore del numero geografico italiano, ma non e un webhook voice provider come Telnyx.
Il flusso corretto per Muretto e:

1. MessageNet assegna il numero e consegna le chiamate via SIP.
2. Un piccolo server Asterisk si registra a `sip.messagenet.it`.
3. Asterisk risponde alla chiamata e la passa al servizio voce/AI.
4. Il servizio voce usa le API gia presenti nella web app:
   - `POST /api/voice/availability`
   - `POST /api/voice/bookings`
   - `POST /api/voice/callbacks`

La web app su Render resta il sistema autorevole: decide disponibilita, limiti sala e salvataggio in agenda.

## Cosa serve

- Account MessageNet con numero geografico.
- Credenziali SIP MessageNet.
- Un piccolo VPS, non Render, per Asterisk.
- Variabile Render gia configurata:

```text
MURETTO_VOICE_API_TOKEN=...
```

## Perche serve Asterisk

La documentazione MessageNet specifica che le chiamate vengono ricevute da un client SIP registrato al servizio e non da un SIP trunk diretto. Per questo serve un apparato/software SIP che faccia registrazione, tipicamente Asterisk o FreePBX.

## File in questa cartella

- `asterisk/pjsip.conf.example`: registrazione SIP MessageNet.
- `asterisk/extensions.conf.example`: dialplan ingresso chiamate.
- `asterisk/ari.conf.example`: abilita ARI per un eventuale worker voce.
- `env.example`: variabili da usare sul gateway.

## Configurazione MessageNet

Nel pannello MessageNet recupera:

- account/utente VoIP, es. `5xxxxxx`
- password SIP
- numero geografico assegnato

Nel VPS Asterisk imposta questi valori copiando i template.

## Collegamento con Muretto

Il gateway dovra chiamare la web app con header:

```http
Authorization: Bearer <MURETTO_VOICE_API_TOKEN>
```

Endpoint produzione:

```text
https://muretto-prenotazioni.onrender.com/api/voice/availability
https://muretto-prenotazioni.onrender.com/api/voice/bookings
https://muretto-prenotazioni.onrender.com/api/voice/callbacks
```

## Stato implementazione

Pronto lato Muretto:

- API protette con token.
- Controllo disponibilita e limiti sale.
- Creazione prenotazione in agenda.
- Richiesta richiamata.
- Notifica email allo staff.
- Backup delle richieste di richiamata.

Da fare sul gateway:

- installare/configurare Asterisk;
- collegare audio della chiamata al servizio AI voce;
- usare le API Muretto per confermare o creare richiesta di richiamata.

