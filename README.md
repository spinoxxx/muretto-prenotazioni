# Muretto Prenotazioni

App locale per gestire le prenotazioni del bistrot Il Muretto con accesso dipendenti tramite PIN.

## Avvio

```bash
npm start
```

Apri poi `http://localhost:4220`.

Per la consultazione separata dell'agenda apri `http://localhost:4220/agenda.html`.

Al primo avvio viene creato un dipendente:

- nome: `Admin`
- PIN: `123456`

L'utente `Admin` puo aggiungere altri dipendenti dalla sezione **Staff**. I nuovi PIN vengono salvati solo come hash, non in chiaro.

Ruoli disponibili:

- `admin`: gestisce prenotazioni e staff.
- `staff`: inserisce e modifica prenotazioni.
- `solo agenda`: consulta la pagina agenda con PIN, senza inserire prenotazioni e senza vedere recapiti o note interne.

Gli admin possono creare, vedere la lista e scaricare i backup dalla sezione **Backup**. L'app crea anche backup automatici nella cartella privata `data/backups/`.

Per scegliere credenziali iniziali diverse:

```bash
MURETTO_ADMIN_NAME="Lucia" MURETTO_ADMIN_PIN="834921" npm start
```

## Privacy e sicurezza

- I PIN non vengono salvati in chiaro: sono protetti con `scrypt` e salt casuale.
- Le sessioni usano cookie `HttpOnly` e `SameSite=Strict`.
- Le modifiche alle prenotazioni richiedono un token anti-CSRF.
- I dati restano sul computer nella cartella `data/`, ignorata da git.
- I backup restano nella cartella privata `data/backups/`, ignorata da git, e conservano gli ultimi 30 file. Di default viene creato un backup automatico ogni 24 ore e uno a ogni avvio del servizio.
- L'app salva solo i dati necessari alla prenotazione: nome, recapito, data, ora, persone, sala, tavolo, stato e note interne.
- La pagina separata `/agenda.html` richiede comunque PIN e mostra solo dati minimizzati.
- Per cancellare dati personali, elimina la prenotazione dall'agenda.
- Per revocare un accesso, un admin puo disattivare il dipendente dalla sezione **Staff**.

Per uso reale su più dispositivi o via internet, mettila dietro HTTPS e imposta un PIN iniziale forte tramite variabile d'ambiente.

## Deploy su Render

Il progetto include `render.yaml`, pronto per un deploy come Web Service Node.

Passi consigliati:

1. Carica questa cartella in un repository GitHub.
2. Su Render crea un nuovo **Blueprint** dal repository.
3. Quando Render chiede `MURETTO_ADMIN_PIN`, inserisci un PIN iniziale forte.
4. Verifica che il servizio abbia il disco persistente `muretto-data` montato su `/var/data`.
5. Dopo il primo accesso, crea gli utenti reali dalla sezione **Staff** e disattiva gli accessi non necessari.

Variabili usate in produzione:

- `HOST=0.0.0.0`: necessario per esporre il servizio su Render.
- `DATA_DIR=/var/data`: salva prenotazioni e dipendenti sul disco persistente.
- `MURETTO_ADMIN_NAME`: nome del primo admin.
- `MURETTO_ADMIN_PIN`: PIN del primo admin, da impostare come segreto.
- `MURETTO_SYNC_ADMIN_PIN=true`: su Render sincronizza l'admin dalle variabili ambiente a ogni avvio.
- `MURETTO_BACKUP_INTERVAL_MS`: frequenza dei backup automatici in millisecondi. Default: 24 ore.
- `MURETTO_BACKUP_RETENTION`: numero massimo di backup da conservare. Default: 30.

Nota importante: su Render i file fuori dal disco persistente non restano garantiti tra deploy e riavvii. Per questo `render.yaml` monta un persistent disk e l'app scrive i dati in `DATA_DIR`.
