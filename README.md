# Road Trip Bingo

A live, shared bingo card for road trips. One person starts a trip and gets a 4-letter code. Everyone else joins on their phone with that code (or the invite link). The first person to claim a sighting gets it, and the database rejects any second claim on the same square.

Several cars in a convoy can play on the same code. Each new carpool group just starts its own trip.

## Files

| File | What it is |
|---|---|
| `index.html` | The page |
| `styles.css` | Sunset palette and retro poster styling |
| `app.js` | Game logic: trips, claims, scoring, live sync |
| `firebase-config.js` | **You paste your Firebase config here** |
| `firestore.rules` | Database rules: one claim per sighting, only the host can end a trip or remove others' claims |

## One-time setup (about 10 minutes)

1. Go to https://console.firebase.google.com and click **Create a project**. You can switch off Google Analytics.
2. **Build → Authentication → Get started → Sign-in method → Anonymous → Enable → Save.** Players don't need accounts. Each phone gets an anonymous ID.
3. **Build → Firestore Database → Create database.** Choose **production mode**. Pick the location closest to you (`africa-south1` Johannesburg, if it's offered).
4. In Firestore, open the **Rules** tab. Replace everything with the contents of `firestore.rules`, then click **Publish**.
5. **Project settings (gear icon) → General → Your apps → Web (`</>`).** Register an app (no hosting needed) and copy the `firebaseConfig` values into `firebase-config.js`.
6. **Authentication → Settings → Authorized domains → Add domain:** `tkwanm.github.io` (or whichever domain you host on).

## Put it online with GitHub Pages

The simplest option is to add the files to your existing `tkwanm.github.io` repo in a folder named `bingo`:

```
tkwanm.github.io/
  bingo/
    index.html
    styles.css
    app.js
    firebase-config.js
```

Commit and push. The game will be at **https://tkwanm.github.io/bingo/**.

(`firestore.rules` and this README don't need to be online.)

## Try it locally first

ES modules need a web server, so opening the file directly won't work. From this folder, run:

```
python -m http.server 8000
```

Then open http://localhost:8000. `localhost` is already an authorized domain in Firebase.

## How a game runs

1. **The driver (host) taps Start a trip**, then Invite. Share the link to WhatsApp.
2. **Friends open the link**, type their names and tap Join. Each player gets a colour.
3. **Spot something, tap the square.** It locks for everyone with your name and colour. If two people tap at the same moment, only the first claim is saved and the other person sees "X already claimed that one!"
4. **SBS ATM:** tap it to open a panel and claim up to 3 different ATMs, 2 points each.
5. **Wild cards** tab: 8 rare sightings, 4 points each.
6. **Line bonus:** whoever ticks the last square of a full row, column or diagonal gets +5.
7. **Dead heats → rock-paper-scissors duel.** If a second person taps the same sighting within 2 seconds of the first claim, the two of them go into a best-of-3 duel, with 5 seconds per round. Miss the timer and you lose that round. Draws replay. The winner keeps (or takes) the claim, and everyone else sees the duel live on their screen. The 2-second window uses Firebase's server clock and is enforced in `firestore.rules`, so nobody can start a duel late.
8. **Undo:** tap your own claimed square to undo it. The host can remove anyone's claim.
9. **The host taps End trip** (on the Scores tab) at the reserve. Claims lock and the winner is shown.

If someone's phone refreshes or they close the tab, opening the link again puts them straight back into the trip.

## Editing the squares

The squares are in the `GRID` and `WILD` lists at the top of `app.js`. Duel timings are the constants under `ATM_SLOTS` in `app.js` (the 2-second tie window itself is in `firestore.rules`). If you add or rename a square's `id`, also add it to the list of allowed keys in `firestore.rules` and publish the rules again. Otherwise claims on that square will be refused.
