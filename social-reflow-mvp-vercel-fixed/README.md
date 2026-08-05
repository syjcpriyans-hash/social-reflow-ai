# Social Reflow AI — GitHub + Vercel MVP

Social Reflow AI analyses a flattened social-media post with Gemini, creates an editable reconstruction plan, reflows the elements to another platform ratio, and exports an exact-size PNG.

This version is prepared for:

- Source control and file storage on GitHub
- Automatic deployments through Vercel
- A Vercel Function for private Gemini API calls
- Static HTML, CSS, and browser Canvas editing
- No database and no paid frontend libraries

## What the MVP does

- Accepts PNG, JPG, and WebP designs.
- Supports LinkedIn, Facebook, Google Business Profile, and Instagram presets.
- Sends a compressed analysis copy to Gemini.
- Keeps the original full-resolution image inside the browser.
- Detects text, logos, products, photos, icons, shapes, layout hierarchy, and background type.
- Asks Gemini to produce a new structured layout for the selected target dimensions.
- Recreates text and shapes as editable layers.
- Extracts visual elements from the original image.
- Lets you move, resize, edit, hide, or replace layers.
- Downloads the finished design as an exact-size PNG.

## Important limitation

A flattened Canva export does not contain the original editable layers or pixels hidden behind objects. The MVP works best when the design uses:

- A solid background or simple gradient
- A clean logo
- Clear text blocks
- One isolated product or main photograph
- Basic cards, shapes, and icons

Complex photographic backgrounds, overlapping objects, shadows, and integrated compositions may still require the original Canva assets or a future inpainting step.

---

# Part 1 — Put the project on GitHub

## Option A: GitHub website

1. Sign in to GitHub.
2. Click **New repository**.
3. Use a repository name such as:

```text
social-reflow-ai
```

4. Choose **Private** while testing.
5. Do not add a README, `.gitignore`, or licence because those files already exist here.
6. Create the repository.
7. Choose **uploading an existing file**.
8. Upload every file and folder from this project.
9. Commit the files to the `main` branch.

The repository must contain:

```text
api/
  analyze.js
  health.js
.env.example
.gitignore
app.js
index.html
package.json
README.md
START-HERE.txt
styles.css
vercel.json
```

Never upload `.env.local` or your Gemini API key.

## Option B: Git commands

Open a terminal inside this project folder:

```bash
git init
git add .
git commit -m "Initial Social Reflow AI MVP"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/social-reflow-ai.git
git push -u origin main
```

Replace `YOUR-USERNAME` with your GitHub username.

---

# Part 2 — Create a Gemini API key

1. Open Google AI Studio.
2. Sign in.
3. Create an API key.
4. Copy it securely.

Do not paste the key into `app.js`, `index.html`, GitHub, or any other public file.

The server function reads the key from:

```text
GEMINI_API_KEY
```

The default model is:

```text
gemini-3.5-flash
```

---

# Part 3 — Deploy with Vercel

1. Sign in to Vercel using GitHub.
2. Click **Add New** and then **Project**.
3. Import the `social-reflow-ai` repository.
4. Use these settings:

```text
Framework Preset: Other
Root Directory: ./
Build Command: leave blank
Output Directory: leave blank
Install Command: npm install
```

5. Before clicking Deploy, open **Environment Variables**.
6. Add:

```text
Name: GEMINI_API_KEY
Value: YOUR_REAL_GEMINI_API_KEY
```

7. Add:

```text
Name: GEMINI_MODEL
Value: gemini-3.5-flash
```

8. Apply both variables to Production, Preview, and Development.
9. Click **Deploy**.
10. Open the generated Vercel URL.

## Check the API

Open:

```text
https://YOUR-VERCEL-DOMAIN.vercel.app/api/health
```

You should see a response similar to:

```json
{
  "ok": true,
  "model": "gemini-3.5-flash"
}
```

Then open the home page, upload a simple post, select a target format, and click **Analyse and rebuild**.

---

# Part 4 — Automatic deployments

After GitHub is connected to Vercel, your workflow is:

1. Edit files locally or through GitHub.
2. Commit the changes.
3. Push to GitHub.
4. Vercel automatically creates a new deployment.

Example:

```bash
git add .
git commit -m "Improve layout analysis"
git push
```

A pull request or non-production branch can also receive a Vercel Preview Deployment before it is merged.

---

# Part 5 — Run locally

## 1. Install Node.js

Install a current Node.js LTS release and verify it:

```bash
node -v
npm -v
```

## 2. Install the Vercel CLI dependency

Inside the project folder:

```bash
npm install
```

## 3. Create the local environment file

Copy:

```text
.env.example
```

to:

```text
.env.local
```

Edit `.env.local`:

```text
GEMINI_API_KEY=YOUR_REAL_GEMINI_API_KEY
GEMINI_MODEL=gemini-3.5-flash
```

## 4. Sign in and run

```bash
npx vercel login
npm run dev
```

Open the local URL shown by Vercel CLI, normally:

```text
http://localhost:3000
```

---

# Part 6 — Why the image is compressed before analysis

Vercel Functions have a request-body limit. A Base64 image is larger than the original file, so directly sending a large Canva PNG can fail.

The browser now:

1. Keeps the full-resolution source image locally.
2. Produces a smaller JPEG copy only for Gemini analysis.
3. Keeps that API request below the platform limit.
4. Uses the original image for element extraction and final PNG export.

This means analysis transport is smaller without reducing the resolution of your final exported post.

---

# Part 7 — Main project files

## `index.html`

The interface structure.

## `styles.css`

The application design and responsive layout.

## `app.js`

Upload handling, analysis-image compression, platform presets, layer extraction, editing, Canvas rendering, and PNG export.

## `api/analyze.js`

The protected Vercel Function that:

- Reads the Gemini API key from the environment
- Sends the image and reconstruction prompt to Gemini
- Enforces structured JSON output
- Validates and sanitizes the returned plan

## `api/health.js`

A basic deployment and model configuration check.

## `vercel.json`

Function duration and security-header configuration.

---

# Part 8 — Recommended first test

Use a Delmen post with:

- A solid or simple gradient background
- One logo
- One headline
- One product image
- Two to four feature points
- One CTA

Testing procedure:

1. Export the Canva design as PNG.
2. Upload it to Social Reflow AI.
3. Select **LinkedIn landscape**.
4. Run the analysis.
5. Check every word.
6. Check the logo and product extraction.
7. Replace the extracted logo with the official transparent logo when necessary.
8. Correct any AI positioning mistake using the editor.
9. Download the PNG.
10. Compare it with a manually created Canva version.

Test at least 20 varied designs before relying on it for production work.

---

# Part 9 — Troubleshooting

## “GEMINI_API_KEY is missing”

Open the Vercel project:

```text
Settings > Environment Variables
```

Add `GEMINI_API_KEY`, then redeploy the project.

## Function payload is too large

Use a normal Canva PNG or JPG under 12 MB. The app compresses the analysis copy automatically, but extremely detailed source images may still need a smaller Canva export.

## Gemini model not found

Check the currently supported Gemini model IDs and update `GEMINI_MODEL` in Vercel Environment Variables. Redeploy after changing it.

## The page loads but analysis fails

Check:

```text
Vercel project > Logs
```

Then inspect the `/api/analyze` function error.

## Text is not exact

Edit the reconstructed text layer before export. OCR and visual-model extraction are not guaranteed to be perfect.

## Product or logo extraction looks poor

Use the layer replacement control to upload the original transparent logo or product asset.

---

# Privacy and cost notes

- The analysis copy is sent to Gemini.
- Editing, extraction, and final PNG rendering happen in the browser.
- The Gemini key remains in the Vercel Function environment.
- No database is used.
- Free plans and API quotas can change, so unlimited free operation is not guaranteed.


## August 2026 reliability patch

This package uses `gemini-3.5-flash-lite` by default, minimal thinking, a smaller analysis image, a 45-second upstream timeout, and safe parsing of non-JSON Vercel platform errors. In Vercel Environment Variables, set `GEMINI_MODEL` to `gemini-3.5-flash-lite` or remove the variable to use the default.
