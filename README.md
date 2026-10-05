# bento.cat

A cat-inspired personal page for links, photos, notes, and more, built with SvelteKit, Convex, and Clerk.

## Development

Requires Bun 1.4.2, Node.js 24.21.0, a Convex deployment, and a Clerk application.

```sh
bun install --frozen-lockfile
cp .env.example .env.local
bun run convex
```

Keep Convex running; it generates the backend API and sets the deployment URL in `.env.local`.

In Clerk, enable email codes and Google sign-in and create the `convex` JWT template. Set `VITE_CLERK_PUBLISHABLE_KEY` in `.env.local`, then configure the Convex issuer:

```sh
bunx convex env set CLERK_JWT_ISSUER_DOMAIN https://YOUR_CLERK_FRONTEND_API
```

See [.env.example](.env.example) for other settings, including account deletion credentials, the Clerk webhook, and the Brevo key that emails owners about new subscribers.

In another terminal:

```sh
bun run dev
```

## Commands

```sh
bun run check   # lint, tests, and production build
bun run format  # format project files
bun run seed    # create demo pages in your configured Convex deployment
```

## Deployment

Pushes to `main` deploy to [bento.cat](https://bento.cat) after CI passes.

For your own deployment, configure production values from [.env.example](.env.example), run `bun run check:production`, `bun run deploy:convex`, and `bun run build`, then start with `bun run start`. Update the operator details in `src/lib/legal.js` for your service.

## SEO

Public profiles and Explore render their content on the server. Canonical URLs and social previews use `https://bento.cat`; change `SITE_ORIGIN` in `src/lib/seo.js` and the sitemap URL in `static/robots.txt` for another domain. `/sitemap.xml` lists pages with public content, excluding blank claims and boxes opted out of discovery. Login, the editor, empty profiles, and error pages use `noindex`. The default share image is `static/og-image.png`, with its source in `design/social-preview.svg`.

## Link previews

Link previews show their saved images immediately. Opening a public page or its
editor refreshes previews older than 24 hours in the background, with failed
requests retried on a later load after an hour. Refreshes keep custom text, images,
cropping and layout, and reuse unchanged stored images. Older widgets keep their
existing titles because they did not record whether the owner had changed them.

## Contributing and license

See [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md).

Source: [AGPL-3.0-only](LICENSE). Cat photos have [separate licenses and attribution](design/cats/CREDITS.md).
