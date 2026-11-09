# Lot Locator

A shared app for tracking where every car on the property was last parked: the main lot, service drive, service basement, both roof levels, showroom and detail.

It runs for free on **GitHub Pages** (the website) and **Supabase** (logins and the shared database).

## Files

| File | What it is |
| --- | --- |
| `index.html` | The page |
| `app.js` | The app's code |
| `config.js` | Your Supabase project URL and public key (you fill this in) |
| `supabase/setup.sql` | Creates the database tables and access rules |
| `.nojekyll` | Tells GitHub Pages to serve the files as they are |

## Setup (about 15 minutes)

### 1. Create the database (Supabase)
1. Go to https://supabase.com and sign up for free.
2. Click **New project**. Name it `lot-locator`, choose a database password (save it somewhere), pick the **West US** region, and click **Create**.
3. When it's ready, open **SQL Editor** → **New query**. Paste in everything from `supabase/setup.sql`, then click **Run**. You should see "Success".
4. Open **Authentication** → **Sign In / Providers** → **Email**. Turn **Confirm email** OFF and save. A manager approves every new account anyway, and Supabase's free email only reaches a few addresses.
5. Open **Project Settings** → **API**. Copy the **Project URL** and the **anon public** key.

### 2. Put your keys in `config.js`
Open `config.js` and replace the two placeholder values with the URL and key you copied.

### 3. Put it on GitHub Pages
1. Go to https://github.com, sign up for free, and click **New repository**. Name it `lot-locator`, set it to **Public**, and click **Create repository**.
2. Click **uploading an existing file**. Drag in `index.html`, `app.js`, `config.js`, `.nojekyll` and the `supabase` folder, then click **Commit changes**.
   - On a Mac, `.nojekyll` is hidden. Press Cmd+Shift+. in Finder to show it.
3. Open **Settings** → **Pages**. Under **Branch**, pick `main` and `/ (root)`, then click **Save**.
4. After about a minute, your app is live at `https://YOUR-GITHUB-NAME.github.io/lot-locator/`.

### 4. Finish in Supabase
Go to **Authentication** → **URL Configuration**. Set **Site URL** to your app's address from step 3.4 and save. This makes password-reset links open your app.

### 5. Create your account first
Open the app and tap **Create an account**. **The first account becomes the manager.** After that:
- Coworkers open the same link and create accounts.
- They show up under **Team & approvals** as "Waiting for approval."
- Set them to **Staff** (find, scan, park and add cars) or **Manager** (also import inventory, remove cars and approve people).

## Notes
- The public key in `config.js` is safe to share. The database rules only let approved staff see or change cars.
- Supabase's free plan pauses a project after 7 days with no activity. Daily use keeps it awake. If it ever pauses, click **Restore** in Supabase.
- To change the level names, edit the `AREAS` list at the top of `app.js`.

## Stock photos
Cars without their own photo show a stock photo of the Honda model, labeled "Stock photo". These come from Wikipedia / Wikimedia Commons (free licenses such as CC BY-SA). Each photo links to its Commons page, which credits the photographer and states the license. Each phone looks them up once and remembers them. Taking a real photo of a car replaces its stock photo.
