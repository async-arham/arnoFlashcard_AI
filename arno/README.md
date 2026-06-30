# StudyDeck — Deploy to Vercel

## Folder structure
```
studydeck/
├── index.html        ← the app (served at your domain root)
├── api/
│   └── generate.js   ← serverless function that holds the API key & calls OpenRouter
├── vercel.json        ← extends the function's timeout to 60s
└── package.json
```

## Deploy steps

1. **Push this folder to a GitHub repo** (or drag-and-drop the folder into
   the Vercel dashboard's "Import Project" screen — both work).

2. **Import the repo on vercel.com** → New Project → select the repo.

3. **Before clicking Deploy**, set an environment variable:
   - Go to the project's *Environment Variables* section
   - Name: `OPENROUTER_API_KEY`
   - Value: your OpenRouter key (`sk-or-v1-...`)
   - Apply to: Production, Preview, and Development

   This keeps your key out of the codebase entirely. (A fallback key is
   hardcoded in `api/generate.js` so it still works if you skip this step —
   but you should remove that fallback once you've set the env var, since
   anything committed to a public repo is effectively public.)

4. **Deploy.** Vercel auto-detects `index.html` and the `/api` folder — no
   build configuration needed.

5. Visit your new `*.vercel.app` URL — the app calls `/api/generate`
   automatically (relative path), so it works with zero edits after deploy.

## Local testing (optional)

If you want to test before deploying:
```bash
npm install -g vercel
vercel dev
```
This runs the same serverless function locally at `http://localhost:3000`,
matching production behavior exactly (including the `/api/generate` route).

## What changed from the old version

- No more `server.js` / `npm start` — the proxy is now a Vercel serverless
  function, deployed automatically with the rest of the site.
- The frontend calls `/api/generate` (relative), so it works locally with
  `vercel dev` and in production with no URL changes.
- Generation now **automatically retries up to 3 times** with increasing
  timeouts if the free model is slow or returns malformed output — you
  should rarely see a raw error now.
- The countdown timer **scales with your file size** — bigger documents
  show a longer (more honest) estimate instead of a fixed number.
- The JSON parser is more forgiving (handles smart quotes, trailing commas,
  single-quoted fields) so minor formatting quirks from the model don't
  blow up the whole batch.
